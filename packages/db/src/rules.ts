import {
  type BankRule,
  type CategorizedTransaction,
  formatDecimal,
  MONEY_ACCOUNT_SUBTYPES,
  type PreparedEntry,
  parseDecimal,
  type RuleDirection,
  type RuleSuggestion,
  ruleMatches,
  suggestRules,
} from "@bookalyze/core";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { LedgerError } from "./ledger";
import { accounts, journalEntries, journalLines } from "./schema/accounting";
import { bankRules, ruleApplications, ruleSuggestionDismissals } from "./schema/banking";
import { replaceJournalEntry } from "./transactions";

/**
 * Bank rules: listed and kept in order here, applied to bank lines as they're posted (see
 * banking.ts) and, on request, to uncategorized transactions already in the books.
 */

export type BankRuleRow = typeof bankRules.$inferSelect;
export type RuleInput = {
  matchText: string;
  direction: RuleDirection;
  amountMin: string | null;
  amountMax: string | null;
  accountId: string | null;
  categoryAccountId: string;
  contactId: string | null;
  isActive: boolean;
};

export class RuleError extends Error {}

/** All rules, in the order they're tried, with how many transactions each has categorized. */
export async function listRules(tx: Transaction) {
  const rows = await tx
    .select()
    .from(bankRules)
    .orderBy(asc(bankRules.position), asc(bankRules.createdAt));
  const counts = await tx
    .select({ ruleId: ruleApplications.ruleId, n: sql<number>`count(*)::int` })
    .from(ruleApplications)
    .innerJoin(journalEntries, eq(journalEntries.id, ruleApplications.journalEntryId))
    .where(sql`${journalEntries.reversedByEntryId} is null`)
    .groupBy(ruleApplications.ruleId);
  const byRule = new Map(counts.map((c) => [c.ruleId, Number(c.n)]));
  return rows.map((r) => ({ ...r, applied: byRule.get(r.id) ?? 0 }));
}

/** Rules as the matcher wants them, active ones only, in order. */
export async function activeRules(tx: Transaction): Promise<BankRule[]> {
  return (await listRules(tx)).filter((r) => r.isActive);
}

async function checkAccounts(tx: Transaction, input: RuleInput) {
  const ids = [input.categoryAccountId, ...(input.accountId ? [input.accountId] : [])];
  const found = await tx
    .select({ id: accounts.id, subtype: accounts.subtype, isArchived: accounts.isArchived })
    .from(accounts)
    .where(inArray(accounts.id, ids));
  const money = new Set<string>(MONEY_ACCOUNT_SUBTYPES);
  const category = found.find((a) => a.id === input.categoryAccountId);
  if (!category || category.isArchived || money.has(category.subtype)) {
    throw new RuleError("Pick a category (not a bank or card account).");
  }
  if (input.accountId) {
    const account = found.find((a) => a.id === input.accountId);
    if (!account || !money.has(account.subtype))
      throw new RuleError("Pick a bank or card account.");
  }
}

export async function createRule(
  tx: Transaction,
  input: RuleInput & { orgId: string; userId?: string | null },
): Promise<BankRuleRow> {
  await checkAccounts(tx, input);
  const [last] = await tx
    .select({ max: sql<number>`coalesce(max(${bankRules.position}), 0)::int` })
    .from(bankRules);
  const { orgId, userId, ...values } = input;
  const [row] = await tx
    .insert(bankRules)
    .values({
      ...values,
      organizationId: orgId,
      createdBy: userId ?? null,
      position: Number(last?.max ?? 0) + 1,
    })
    .returning();
  if (!row) throw new Error("Could not save the rule");
  return row;
}

export async function updateRule(
  tx: Transaction,
  ruleId: string,
  input: RuleInput,
): Promise<BankRuleRow> {
  await checkAccounts(tx, input);
  const [row] = await tx.update(bankRules).set(input).where(eq(bankRules.id, ruleId)).returning();
  if (!row) throw new RuleError("This rule no longer exists.");
  return row;
}

/** Deletes a rule. Transactions it categorized keep their category. */
export async function deleteRule(tx: Transaction, ruleId: string) {
  await tx.delete(bankRules).where(eq(bankRules.id, ruleId));
}

/** Moves a rule one place up or down; earlier rules are tried first. */
export async function moveRule(tx: Transaction, ruleId: string, direction: "up" | "down") {
  const rules = await tx
    .select()
    .from(bankRules)
    .orderBy(asc(bankRules.position), asc(bankRules.createdAt));
  const index = rules.findIndex((r) => r.id === ruleId);
  const other = rules[direction === "up" ? index - 1 : index + 1];
  if (index === -1 || !other) return;
  const order = rules.map((r) => r.id);
  order[index] = other.id;
  order[direction === "up" ? index - 1 : index + 1] = ruleId;
  for (const [position, id] of order.entries()) {
    await tx
      .update(bankRules)
      .set({ position: position + 1 })
      .where(eq(bankRules.id, id));
  }
}

export async function recordRuleApplication(
  tx: Transaction,
  input: { orgId: string; entryId: string; ruleId: string },
) {
  await tx
    .insert(ruleApplications)
    .values({ organizationId: input.orgId, journalEntryId: input.entryId, ruleId: input.ruleId })
    .onConflictDoNothing();
}

/** Which rule categorized each of these entries, if any. */
export async function ruleNamesFor(tx: Transaction, entryIds: readonly string[]) {
  if (!entryIds.length) return new Map<string, string>();
  const rows = await tx
    .select({ entryId: ruleApplications.journalEntryId, matchText: bankRules.matchText })
    .from(ruleApplications)
    .innerJoin(bankRules, eq(bankRules.id, ruleApplications.ruleId))
    .where(inArray(ruleApplications.journalEntryId, [...entryIds]));
  return new Map(rows.map((r) => [r.entryId, r.matchText]));
}

type Uncategorized = {
  entryId: string;
  date: string;
  memo: string | null;
  contactId: string | null;
  text: string;
  amount: string;
  accountId: string;
};

/**
 * Current transactions still in Uncategorized income or expense, with one bank or card account:
 * what "apply this rule to what's already there" looks at. Newest first, at most `limit`.
 */
async function uncategorizedTransactions(tx: Transaction, limit = 5000): Promise<Uncategorized[]> {
  const rows = await tx.execute<{
    entry_id: string;
    date: string;
    memo: string | null;
    contact_id: string | null;
    text: string;
    amount: string;
    account_id: string;
  }>(sql`
    select e.id as entry_id, e.date::text as date, e.memo, e.contact_id,
      concat_ws(' ', e.memo, string_agg(coalesce(l.description, ''), ' ')) as text,
      max(m.amount)::text as amount, max(m.account_id::text) as account_id
    from journal_entries e
    join journal_lines l on l.journal_entry_id = e.id
    join (
      select ml.journal_entry_id, ml.account_id, ml.amount from journal_lines ml
      join accounts ma on ma.id = ml.account_id
      where ma.subtype in (${sql.raw(MONEY_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "))})
    ) m on m.journal_entry_id = e.id
    where e.reversed_by_entry_id is null and e.reverses_entry_id is null
      and exists (select 1 from journal_lines u join accounts ua on ua.id = u.account_id
        where u.journal_entry_id = e.id
          and ua.system_key in ('uncategorized_income', 'uncategorized_expense'))
    group by e.id
    having count(distinct m.account_id) = 1
    order by e.date desc, e.entry_number desc
    limit ${limit}`);
  return rows.rows.map((r) => ({
    entryId: r.entry_id,
    date: r.date,
    memo: r.memo,
    contactId: r.contact_id,
    text: r.text,
    amount: r.amount,
    accountId: r.account_id,
  }));
}

/** How many uncategorized transactions a rule (saved or still being written) would categorize. */
export async function countRuleMatches(tx: Transaction, rule: Omit<BankRule, "id">) {
  const candidates = await uncategorizedTransactions(tx);
  const draft = { ...rule, id: "draft", isActive: true };
  return candidates.filter((c) => ruleMatches(draft, c)).length;
}

/**
 * Categorizes the uncategorized transactions a rule matches, each by reposting it with the
 * rule's category in place of Uncategorized (the original is reversed on its own date, like any
 * edit, and keeps its review tick, receipts and bank link). Transactions in a closed period or a
 * completed reconciliation are skipped.
 */
export async function applyRuleToExisting(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; ruleId: string },
): Promise<{ categorized: number; skipped: number }> {
  const [row] = await tx.select().from(bankRules).where(eq(bankRules.id, input.ruleId));
  if (!row) throw new RuleError("This rule no longer exists.");
  const rule = { ...row, isActive: true };
  const matches = (await uncategorizedTransactions(tx)).filter((c) => ruleMatches(rule, c));
  if (!matches.length) return { categorized: 0, skipped: 0 };
  const uncategorized = new Set(
    (
      await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(inArray(accounts.systemKey, ["uncategorized_income", "uncategorized_expense"]))
    ).map((a) => a.id),
  );
  let categorized = 0;
  let skipped = 0;
  for (const match of matches) {
    const [entry] = await tx
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, match.entryId));
    if (!entry) continue;
    const lines = await tx
      .select()
      .from(journalLines)
      .where(eq(journalLines.journalEntryId, entry.id))
      .orderBy(asc(journalLines.lineNo));
    const prepared: PreparedEntry = {
      currency: entry.currency,
      fxRate: entry.fxRate,
      total: formatDecimal(
        lines
          .map((l) => parseDecimal(l.amount))
          .filter((a) => a > 0n)
          .reduce((sum, a) => sum + a, 0n),
      ),
      lines: lines.map((l, index) => ({
        index,
        accountId: uncategorized.has(l.accountId) ? rule.categoryAccountId : l.accountId,
        description: l.description,
        currency: l.currency,
        amount: l.amount,
        baseAmount: l.baseAmount,
        taxRateId: l.taxRateId,
      })),
    };
    try {
      const posted = await tx.transaction(async (sp) => {
        const next = await replaceJournalEntry(sp, {
          orgId: input.orgId,
          userId: input.userId,
          entryId: entry.id,
          date: entry.date,
          reference: entry.reference,
          memo: entry.memo,
          contactId: entry.contactId ?? rule.contactId,
          entry: prepared,
        });
        await recordRuleApplication(sp, { orgId: input.orgId, entryId: next.id, ruleId: rule.id });
        return next;
      });
      if (posted) categorized++;
    } catch (error) {
      if (!(error instanceof LedgerError) && !isRefusedByDatabase(error)) throw error;
      skipped++;
    }
  }
  return { categorized, skipped };
}

/** A database rule (closed period, reconciled transaction) refused the change. */
function isRefusedByDatabase(error: unknown): boolean {
  return (error as { cause?: { code?: string } }).cause?.code === "23514";
}

/**
 * Bank transactions from the last year that someone categorized by hand (not by a rule): one
 * bank, card or cash account and one category that isn't Uncategorized. What rule suggestions
 * learn from. Newest first, at most `limit`.
 */
async function handCategorized(tx: Transaction, limit = 5000): Promise<CategorizedTransaction[]> {
  const money = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "));
  const rows = await tx.execute<{
    text: string;
    amount: string;
    account_id: string;
    category_id: string;
  }>(sql`
    select concat_ws(' ', e.memo, string_agg(coalesce(l.description, ''), ' ')) as text,
      max(case when a.subtype in (${money}) then l.amount end)::text as amount,
      max(case when a.subtype in (${money}) then l.account_id::text end) as account_id,
      max(case when a.subtype not in (${money}) then l.account_id::text end) as category_id
    from journal_entries e
    join journal_lines l on l.journal_entry_id = e.id
    join accounts a on a.id = l.account_id
    where e.reversed_by_entry_id is null and e.reverses_entry_id is null
      and e.date >= current_date - 365
      and not exists (select 1 from rule_applications r where r.journal_entry_id = e.id)
    group by e.id
    having count(*) filter (where a.subtype in (${money})) = 1
      and count(*) filter (where a.subtype not in (${money})) = 1
      and bool_and(a.subtype not in ('uncategorized_income', 'uncategorized_expense'))
    order by max(e.date) desc
    limit ${limit}`);
  return rows.rows.map((r) => ({
    text: r.text,
    amount: r.amount,
    accountId: r.account_id,
    categoryAccountId: r.category_id,
  }));
}

/**
 * Rules worth making: payees categorized the same way several times by hand, not covered by a
 * rule and not turned down. `waiting` is how many uncategorized transactions each would
 * categorize now.
 */
export async function suggestedRules(
  tx: Transaction,
): Promise<(RuleSuggestion & { waiting: number })[]> {
  const [history, rules, dismissed] = await Promise.all([
    handCategorized(tx),
    activeRules(tx),
    tx.select({ matchText: ruleSuggestionDismissals.matchText }).from(ruleSuggestionDismissals),
  ]);
  const suggestions = suggestRules(history, rules, new Set(dismissed.map((d) => d.matchText)));
  if (!suggestions.length) return [];
  const waiting = await uncategorizedTransactions(tx);
  return suggestions.map((s) => {
    const rule = {
      id: "suggestion",
      matchText: s.matchText,
      direction: s.direction,
      amountMin: null,
      amountMax: null,
      accountId: null,
      categoryAccountId: s.categoryAccountId,
      contactId: null,
      isActive: true,
    };
    return { ...s, waiting: waiting.filter((c) => ruleMatches(rule, c)).length };
  });
}

/** "Not this one": the suggestion isn't offered again. */
export async function dismissRuleSuggestion(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; matchText: string },
) {
  await tx
    .insert(ruleSuggestionDismissals)
    .values({
      organizationId: input.orgId,
      matchText: input.matchText,
      dismissedBy: input.userId ?? null,
    })
    .onConflictDoNothing();
}

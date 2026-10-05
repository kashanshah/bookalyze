import {
  describeTransaction,
  divideDecimals,
  formatDecimal,
  MONEY_ACCOUNT_SUBTYPES,
  PLACEHOLDER_ACCOUNT_SUBTYPES,
  type PreparedEntry,
  parseDecimal,
  type TransactionKind,
  type TransactionView,
} from "@bookalyze/core";
import { and, count, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { copyAttachmentLinks, countAttachments } from "./attachments";
import type { Transaction } from "./client";
import { carryEntryLinks } from "./duplicates";
import { LedgerError, postJournalEntry, reverseJournalEntry } from "./ledger";
import { accounts, journalEntries, journalLines, transactionReviews } from "./schema/accounting";
import { reconciliationLines, reconciliations } from "./schema/reconciliation";
import { followTransferEdit } from "./transfers";

/**
 * The Transactions screen's queries and writes. A transaction is any current journal entry
 * (not reversed, not itself a reversal) with a line on a money account, or with an Uncategorized
 * line standing in for one nobody chose (see `describeTransaction` in core).
 */

const moneySubtypes = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "));
const placeholderSubtypes = sql.raw(PLACEHOLDER_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "));

/** True when the entry has a line on an account matching `accountCondition`. */
function hasLine(accountCondition: SQL): SQL {
  return sql`exists (
    select 1 from ${journalLines} l
    join ${accounts} a on a.id = l.account_id
    where l.journal_entry_id = ${journalEntries.id} and ${accountCondition}
  )`;
}

const touchesMoney = hasLine(sql`a.subtype in (${moneySubtypes})`);
const touchesCategory = hasLine(sql`a.subtype not in (${moneySubtypes})`);
/** No money account, but an Uncategorized line standing in for it: the account wasn't chosen. */
const needsAccountSql = sql`(not ${touchesMoney} and ${hasLine(sql`a.subtype in (${placeholderSubtypes})`)})`;

/** Current entries that don't say which bank, card or cash account the money moved through. */
export async function countNeedsAccount(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(journalEntries)
    .where(
      and(
        isNull(journalEntries.reversedByEntryId),
        isNull(journalEntries.reversesEntryId),
        needsAccountSql,
      ),
    );
  return row?.n ?? 0;
}

export type TransactionFilters = {
  /** Only transactions touching this account. */
  accountId?: string | null;
  /** Only transactions with a line in this category (any split counts). */
  categoryId?: string | null;
  /** Only transactions with this customer or vendor. */
  contactId?: string | null;
  kind?: TransactionKind | null;
  reviewed?: boolean | null;
  /** Only transactions flagged as possibly a copy of another (see duplicates.ts). */
  possibleDuplicates?: boolean;
  /** Only transactions whose bank, card or cash account was never chosen. */
  needsAccount?: boolean;
  /** Only these entries (e.g. the ones in a suggested transfer). */
  entryIds?: readonly string[] | null;
  search?: string | null;
  limit: number;
  offset: number;
};

export type TransactionRow = {
  id: string;
  entryNumber: number;
  date: string;
  memo: string | null;
  reference: string | null;
  currency: string;
  fxRate: string;
  source: string;
  contactId: string | null;
  reviewed: boolean;
  /** The statement date it was reconciled to, if it's in a completed reconciliation. */
  reconciledThrough: string | null;
  /** Number of receipts and files attached. */
  attachments: number;
  lines: {
    accountId: string;
    currency: string;
    amount: string;
    baseAmount: string;
    description: string | null;
    taxRateId: string | null;
  }[];
  view: TransactionView;
};

export async function listTransactions(
  tx: Transaction,
  filters: TransactionFilters,
): Promise<{ rows: TransactionRow[]; total: number }> {
  const conditions: SQL[] = [
    isNull(journalEntries.reversedByEntryId),
    isNull(journalEntries.reversesEntryId),
    filters.needsAccount ? needsAccountSql : sql`(${touchesMoney} or ${needsAccountSql})`,
  ];
  for (const accountId of [filters.accountId, filters.categoryId]) {
    if (!accountId) continue;
    conditions.push(
      sql`exists (select 1 from ${journalLines} l where l.journal_entry_id = ${journalEntries.id} and l.account_id = ${accountId})`,
    );
  }
  if (filters.contactId) conditions.push(eq(journalEntries.contactId, filters.contactId));
  if (filters.entryIds) {
    if (!filters.entryIds.length) return { rows: [], total: 0 };
    conditions.push(inArray(journalEntries.id, [...filters.entryIds]));
  }
  if (filters.kind === "transfer") conditions.push(sql`not ${touchesCategory}`);
  if (filters.kind === "deposit" || filters.kind === "withdrawal") {
    conditions.push(touchesCategory);
    const net = sql`(select coalesce(sum(l.amount), 0) from ${journalLines} l
      join ${accounts} a on a.id = l.account_id
      where l.journal_entry_id = ${journalEntries.id} and a.subtype in (${moneySubtypes}))`;
    // Without a money account, the Uncategorized stand-in says which way the money went (all
    // Uncategorized nets to zero, which core reads as money out).
    const standIn = sql`(select coalesce(sum(l.amount), 0) from ${journalLines} l
      join ${accounts} a on a.id = l.account_id
      where l.journal_entry_id = ${journalEntries.id} and a.subtype in (${placeholderSubtypes}))`;
    conditions.push(
      filters.kind === "deposit"
        ? sql`(case when ${touchesMoney} then ${net} >= 0 else ${standIn} > 0 end)`
        : sql`(case when ${touchesMoney} then ${net} < 0 else ${standIn} <= 0 end)`,
    );
  }
  const reviewedSql = sql`exists (select 1 from ${transactionReviews} r where r.journal_entry_id = ${journalEntries.id})`;
  if (filters.reviewed === true) conditions.push(reviewedSql);
  if (filters.reviewed === false) conditions.push(sql`not ${reviewedSql}`);
  if (filters.possibleDuplicates) {
    conditions.push(sql`exists (select 1 from duplicate_suggestions d
      join ${journalEntries} k on k.id = d.duplicate_of_entry_id
      where d.entry_id = ${journalEntries.id} and d.status = 'open'
        and k.reversed_by_entry_id is null and k.reverses_entry_id is null)`);
  }
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`(
      ${journalEntries.memo} ilike ${pattern} or ${journalEntries.reference} ilike ${pattern}
      or exists (select 1 from ${journalLines} l where l.journal_entry_id = ${journalEntries.id} and l.description ilike ${pattern})
    )`);
  }

  const where = and(...conditions);
  const [totalRow] = await tx.select({ n: count() }).from(journalEntries).where(where);
  const entries = await tx
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      date: journalEntries.date,
      memo: journalEntries.memo,
      reference: journalEntries.reference,
      currency: journalEntries.currency,
      fxRate: journalEntries.fxRate,
      source: journalEntries.source,
      contactId: journalEntries.contactId,
      reviewed: sql<boolean>`${reviewedSql}`,
      reconciledThrough: sql<string | null>`(select max(rc.statement_date)::text
        from ${journalLines} l
        join ${reconciliationLines} rl on rl.journal_line_id = l.id
        join ${reconciliations} rc on rc.id = rl.reconciliation_id
        where l.journal_entry_id = "journal_entries"."id" and rc.status = 'completed')`,
    })
    .from(journalEntries)
    .where(where)
    .orderBy(desc(journalEntries.date), desc(journalEntries.entryNumber))
    .limit(filters.limit)
    .offset(filters.offset);
  if (!entries.length) return { rows: [], total: totalRow?.n ?? 0 };

  const lines = await tx
    .select({
      entryId: journalLines.journalEntryId,
      accountId: journalLines.accountId,
      currency: journalLines.currency,
      amount: journalLines.amount,
      baseAmount: journalLines.baseAmount,
      description: journalLines.description,
      taxRateId: journalLines.taxRateId,
      subtype: accounts.subtype,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      inArray(
        journalLines.journalEntryId,
        entries.map((e) => e.id),
      ),
    )
    .orderBy(journalLines.lineNo);
  const idsOf = (subtypes: readonly string[]) =>
    new Set(lines.filter((l) => subtypes.includes(l.subtype)).map((l) => l.accountId));
  const moneyIds = idsOf(MONEY_ACCOUNT_SUBTYPES);
  const placeholderIds = idsOf(PLACEHOLDER_ACCOUNT_SUBTYPES);
  const byEntry = new Map<string, typeof lines>();
  for (const line of lines) byEntry.set(line.entryId, [...(byEntry.get(line.entryId) ?? []), line]);

  const attachmentCounts = await countAttachments(
    tx,
    "journal_entry",
    entries.map((e) => e.id),
  );
  const rows: TransactionRow[] = [];
  for (const entry of entries) {
    const entryLines = (byEntry.get(entry.id) ?? []).map(
      ({ accountId, currency, amount, baseAmount, description, taxRateId }) => ({
        accountId,
        currency,
        amount,
        baseAmount,
        description,
        taxRateId,
      }),
    );
    const view = describeTransaction(
      entryLines,
      (id) => moneyIds.has(id),
      (id) => placeholderIds.has(id),
    );
    if (view) {
      rows.push({
        ...entry,
        ...moneyCurrency(entry, entryLines, view),
        reviewed: Boolean(entry.reviewed),
        attachments: attachmentCounts.get(entry.id) ?? 0,
        lines: entryLines,
        view,
      });
    }
  }
  return { rows, total: totalRow?.n ?? 0 };
}

/**
 * A deposit or withdrawal is in its money account's currency. An entry recorded in the main
 * currency whose money line was later re-recorded in the account's (Correct from Wise) reads in
 * the account's currency, at the rate its two values imply.
 */
function moneyCurrency(
  entry: { currency: string; fxRate: string },
  lines: readonly { accountId: string; currency: string; amount: string; baseAmount: string }[],
  view: TransactionView,
): { currency: string; fxRate: string } {
  if (view.kind === "transfer" || view.moneyAccountIds.length !== 1) return entry;
  const money = lines.filter((l) => l.accountId === view.moneyAccountIds[0]);
  const currency = money[0]?.currency;
  if (!currency || currency === entry.currency || money.some((l) => l.currency !== currency)) {
    return entry;
  }
  const amount = money.reduce((t, l) => t + parseDecimal(l.amount), 0n);
  const base = money.reduce((t, l) => t + parseDecimal(l.baseAmount), 0n);
  if (amount === 0n) return entry;
  return {
    currency,
    fxRate: divideDecimals(
      formatDecimal(base < 0n ? -base : base),
      formatDecimal(amount < 0n ? -amount : amount),
    ),
  };
}

/** Marks a transaction reviewed or not. */
export async function setTransactionReviewed(
  tx: Transaction,
  input: { orgId: string; entryId: string; reviewed: boolean; userId?: string | null },
) {
  if (input.reviewed) {
    await tx
      .insert(transactionReviews)
      .values({
        organizationId: input.orgId,
        journalEntryId: input.entryId,
        reviewedBy: input.userId ?? null,
      })
      .onConflictDoNothing();
  } else {
    await tx.delete(transactionReviews).where(eq(transactionReviews.journalEntryId, input.entryId));
  }
}

/**
 * Replaces a posted entry with a corrected one: reverses the original on its own date (so the
 * period it was in is corrected, not a later one) and posts the new entry. Keeps the review
 * status and attached files. Both writes happen in the caller's transaction.
 */
export async function replaceJournalEntry(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    entryId: string;
    date: string;
    reference?: string | null;
    memo?: string | null;
    contactId?: string | null;
    entry: PreparedEntry;
  },
) {
  const [original] = await tx
    .select({
      date: journalEntries.date,
      source: journalEntries.source,
      sourceId: journalEntries.sourceId,
    })
    .from(journalEntries)
    .where(eq(journalEntries.id, input.entryId));
  if (!original) throw new LedgerError("This transaction no longer exists.");
  const [review] = await tx
    .select({ id: transactionReviews.journalEntryId })
    .from(transactionReviews)
    .where(eq(transactionReviews.journalEntryId, input.entryId));
  await reverseJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: input.entryId,
    date: original.date,
  });
  const posted = await postJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: input.date,
    reference: input.reference,
    memo: input.memo,
    contactId: input.contactId,
    // A bank transaction stays one after it's categorized (its bank line follows, below), and an
    // imported one keeps its ID from the other program, so importing the file again skips it.
    ...(original.source === "bank_import" ? { source: "bank_import" as const } : {}),
    ...(original.source === "import"
      ? { source: "import" as const, sourceId: original.sourceId }
      : {}),
    entry: input.entry,
  });
  // A matched transfer edited into something else gives back the side it no longer covers.
  await followTransferEdit(tx, {
    orgId: input.orgId,
    userId: input.userId,
    from: input.entryId,
    to: posted.id,
  });
  await carryEntryLinks(tx, { from: input.entryId, to: posted.id, userId: input.userId });
  // Receipts stay with the transaction (the original keeps its links too, for history).
  await copyAttachmentLinks(tx, {
    orgId: input.orgId,
    entityType: "journal_entry",
    fromEntityId: input.entryId,
    toEntityId: posted.id,
    userId: input.userId,
  });
  if (review) {
    await setTransactionReviewed(tx, {
      orgId: input.orgId,
      entryId: posted.id,
      reviewed: true,
      userId: input.userId,
    });
  }
  return posted;
}

/** Removes a transaction from the books by reversing it on its own date. */
export async function voidJournalEntry(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; entryId: string },
) {
  const [original] = await tx
    .select({ date: journalEntries.date })
    .from(journalEntries)
    .where(eq(journalEntries.id, input.entryId));
  if (!original) throw new LedgerError("This transaction no longer exists.");
  return reverseJournalEntry(tx, { ...input, date: original.date });
}

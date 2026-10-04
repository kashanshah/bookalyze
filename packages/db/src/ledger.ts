import {
  type AccountBalance,
  DEFAULT_CHART,
  getAccountSubtype,
  type PreparedEntry,
  reversingLines,
} from "@bookalyze/core";
import { and, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { accounts, type JournalSource, journalEntries, journalLines } from "./schema/accounting";
import { organizationProfiles } from "./schema/organization";

/**
 * Ledger writes, shared by the app and future importers (Wave, bank feeds). Call these inside
 * `withOrg()` after validating input with `prepareJournalEntry()` from @bookalyze/core. The
 * database re-checks that every entry balances when the transaction commits.
 */

/** A rule the ledger refuses to break, with a message fit to show the user. */
export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "already_reversed" | "is_reversal" | "period_locked" = "not_found",
    readonly lockedThrough?: string,
  ) {
    super(message);
  }
}

/** The date the organization's books are closed through, or null when nothing is closed. */
export async function booksLockedThrough(tx: Transaction): Promise<string | null> {
  const [row] = await tx
    .select({ date: organizationProfiles.booksLockedThrough })
    .from(organizationProfiles)
    .limit(1);
  return row?.date ?? null;
}

/** Throws a LedgerError if `date` falls in a closed period. */
export async function assertPeriodOpen(tx: Transaction, date: string): Promise<void> {
  const locked = await booksLockedThrough(tx);
  if (locked && date <= locked) {
    throw new LedgerError(`Your books are closed through ${locked}.`, "period_locked", locked);
  }
}

/** Creates the standard chart of accounts. Does nothing if the organization has accounts. */
export async function createDefaultChart(
  tx: Transaction,
  input: { orgId: string; baseCurrency: string; userId?: string | null },
): Promise<number> {
  const [existing] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  if (existing) return 0;
  const rows = DEFAULT_CHART.map((a) => ({
    organizationId: input.orgId,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    description: a.description ?? null,
    systemKey: a.systemKey ?? null,
    // Bank and card accounts hold one currency; the template's start in the base currency.
    currency: getAccountSubtype(a.subtype)?.needsCurrency ? input.baseCurrency : null,
    createdBy: input.userId ?? null,
  }));
  await tx.insert(accounts).values(rows);
  return rows.length;
}

/**
 * Next sequential entry number for the organization. Takes a transaction-scoped advisory lock
 * so two entries posted at the same moment can't get the same number.
 */
export async function nextEntryNumber(tx: Transaction, orgId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`journal:${orgId}`}))`);
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(${journalEntries.entryNumber}), 0) + 1` })
    .from(journalEntries);
  return Number(row?.n ?? 1);
}

export type PostEntryInput = {
  orgId: string;
  userId?: string | null;
  date: string;
  reference?: string | null;
  memo?: string | null;
  source?: JournalSource;
  sourceId?: string | null;
  reversesEntryId?: string | null;
  entry: PreparedEntry;
};

/** Writes a validated entry and its lines. Returns the new entry's id and number. */
export async function postJournalEntry(tx: Transaction, input: PostEntryInput) {
  await assertPeriodOpen(tx, input.date);
  const entryNumber = await nextEntryNumber(tx, input.orgId);
  const [row] = await tx
    .insert(journalEntries)
    .values({
      organizationId: input.orgId,
      entryNumber,
      date: input.date,
      reference: input.reference ?? null,
      memo: input.memo ?? null,
      currency: input.entry.currency,
      fxRate: input.entry.fxRate,
      source: input.source ?? "manual",
      sourceId: input.sourceId ?? null,
      reversesEntryId: input.reversesEntryId ?? null,
      createdBy: input.userId ?? null,
    })
    .returning({ id: journalEntries.id });
  if (!row) throw new Error("Could not create the journal entry");
  await tx.insert(journalLines).values(
    input.entry.lines.map((line, i) => ({
      organizationId: input.orgId,
      journalEntryId: row.id,
      lineNo: i + 1,
      accountId: line.accountId,
      description: line.description,
      amount: line.amount,
      baseAmount: line.baseAmount,
    })),
  );
  return { id: row.id, entryNumber };
}

/**
 * Posts an entry that undoes `entryId` on `date` and links the two. Fails if the entry doesn't
 * exist, is itself a reversal, or was already reversed.
 */
export async function reverseJournalEntry(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; entryId: string; date: string },
) {
  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, input.entryId))
    .for("update");
  if (!original) throw new LedgerError("This entry no longer exists.");
  if (original.reversedByEntryId)
    throw new LedgerError("This entry has already been reversed.", "already_reversed");
  if (original.reversesEntryId) {
    throw new LedgerError(
      "This entry is itself a reversal. Post a new entry instead.",
      "is_reversal",
    );
  }
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.journalEntryId, original.id))
    .orderBy(journalLines.lineNo);
  const reversed = reversingLines(lines);
  const result = await postJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: input.date,
    reference: original.reference,
    memo: `Reversal of JE-${String(original.entryNumber).padStart(4, "0")}${original.memo ? `: ${original.memo}` : ""}`,
    source: "reversal",
    reversesEntryId: original.id,
    entry: {
      currency: original.currency,
      fxRate: original.fxRate,
      total: "0",
      lines: reversed.map((l, index) => ({
        index,
        accountId: l.accountId,
        description: l.description,
        amount: l.amount,
        baseAmount: l.baseAmount,
      })),
    },
  });
  await tx
    .update(journalEntries)
    .set({ reversedByEntryId: result.id })
    .where(eq(journalEntries.id, original.id));
  return { ...result, original };
}

/** "JE-0042" */
export function formatEntryNumber(n: number): string {
  return `JE-${String(n).padStart(4, "0")}`;
}

/**
 * Every account with its balance (sum of base amounts, debits positive) for entries dated
 * within [from, to]. Either bound may be omitted. Accounts without activity have "0.0000".
 */
export async function accountBalances(
  tx: Transaction,
  range: { from?: string | null; to?: string | null } = {},
): Promise<AccountBalance[]> {
  const conditions: SQL[] = [eq(journalLines.journalEntryId, journalEntries.id)];
  if (range.from) conditions.push(gte(journalEntries.date, range.from));
  if (range.to) conditions.push(lte(journalEntries.date, range.to));
  const totals = tx
    .select({
      accountId: journalLines.accountId,
      balance: sql<string>`sum(${journalLines.baseAmount})`.as("balance"),
    })
    .from(journalLines)
    .innerJoin(journalEntries, and(...conditions))
    .groupBy(journalLines.accountId)
    .as("totals");
  const rows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      balance: sql<string>`coalesce(${totals.balance}, 0)::numeric(20,4)::text`,
    })
    .from(accounts)
    .leftJoin(totals, eq(totals.accountId, accounts.id));
  return rows;
}

import type { AccountType, LedgerActivity } from "@bookalyze/core";
import { and, asc, eq, gte, lt, lte, type SQL, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import {
  accounts,
  contacts,
  type JournalSource,
  journalEntries,
  journalLines,
} from "./schema/accounting";

/**
 * Queries behind the general ledger. Call inside `withOrg()`. Amounts are base-currency sums of
 * `base_amount` (debits positive); @bookalyze/core shapes them into report rows.
 */

/** Every account's balance before `from`, and the debits and credits posted in [from, to]. */
export async function ledgerActivity(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<LedgerActivity[]> {
  const inRange = sql`${journalEntries.date} >= ${range.from} and ${journalEntries.date} <= ${range.to}`;
  const totals = tx
    .select({
      accountId: journalLines.accountId,
      opening:
        sql<string>`coalesce(sum(${journalLines.baseAmount}) filter (where ${journalEntries.date} < ${range.from}), 0)`.as(
          "opening",
        ),
      debits:
        sql<string>`coalesce(sum(${journalLines.baseAmount}) filter (where ${inRange} and ${journalLines.baseAmount} > 0), 0)`.as(
          "debits",
        ),
      credits:
        sql<string>`coalesce(-sum(${journalLines.baseAmount}) filter (where ${inRange} and ${journalLines.baseAmount} < 0), 0)`.as(
          "credits",
        ),
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(eq(journalLines.journalEntryId, journalEntries.id), lte(journalEntries.date, range.to)),
    )
    .groupBy(journalLines.accountId)
    .as("totals");
  return tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      opening: sql<string>`coalesce(${totals.opening}, 0)::numeric(20,4)::text`,
      debits: sql<string>`coalesce(${totals.debits}, 0)::numeric(20,4)::text`,
      credits: sql<string>`coalesce(${totals.credits}, 0)::numeric(20,4)::text`,
    })
    .from(accounts)
    .leftJoin(totals, eq(totals.accountId, accounts.id));
}

export type LedgerLineRow = {
  id: string;
  entryId: string;
  entryNumber: number;
  date: string;
  memo: string | null;
  reference: string | null;
  description: string | null;
  contactName: string | null;
  source: JournalSource;
  /** The line in its own currency, when that isn't the main currency. */
  currency: string;
  currencyAmount: string;
  /** Signed base amount: positive = debit. */
  amount: string;
};

export type AccountLedgerData = {
  account: {
    id: string;
    code: string | null;
    name: string;
    type: AccountType;
    subtype: string;
    /** The one currency it holds, or null for accounts that take any. */
    currency: string | null;
  };
  /** Signed balance before `from`. */
  opening: string;
  lines: LedgerLineRow[];
  /** Lines in the period; more than `lines.length` when the list was cut at `limit`. */
  lineCount: number;
  /** Debits and credits over the whole period (both positive), however many lines are listed. */
  debits: string;
  credits: string;
};

/** One account's lines in [from, to], oldest first, with its balance before `from`. */
export async function accountLedgerLines(
  tx: Transaction,
  accountId: string,
  range: { from: string; to: string },
  limit = 1000,
): Promise<AccountLedgerData | null> {
  const [account] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!account) return null;

  const line = and(
    eq(journalLines.journalEntryId, journalEntries.id),
    eq(journalLines.accountId, accountId),
  );
  const period: SQL[] = [gte(journalEntries.date, range.from), lte(journalEntries.date, range.to)];
  const [[opening], [count], lines] = await Promise.all([
    tx
      .select({
        balance: sql<string>`coalesce(sum(${journalLines.baseAmount}), 0)::numeric(20,4)::text`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, and(line, lt(journalEntries.date, range.from))),
    tx
      .select({
        n: sql<number>`count(*)::int`,
        debits: sql<string>`coalesce(sum(${journalLines.baseAmount}) filter (where ${journalLines.baseAmount} > 0), 0)::numeric(20,4)::text`,
        credits: sql<string>`coalesce(-sum(${journalLines.baseAmount}) filter (where ${journalLines.baseAmount} < 0), 0)::numeric(20,4)::text`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, and(line, ...period)),
    tx
      .select({
        id: journalLines.id,
        entryId: journalEntries.id,
        entryNumber: journalEntries.entryNumber,
        date: journalEntries.date,
        memo: journalEntries.memo,
        reference: journalEntries.reference,
        description: journalLines.description,
        contactName: contacts.name,
        source: journalEntries.source,
        currency: journalLines.currency,
        currencyAmount: sql<string>`${journalLines.amount}::text`,
        amount: sql<string>`${journalLines.baseAmount}::text`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, and(line, ...period))
      .leftJoin(contacts, eq(contacts.id, journalEntries.contactId))
      .orderBy(asc(journalEntries.date), asc(journalEntries.entryNumber), asc(journalLines.lineNo))
      .limit(limit),
  ]);
  return {
    account,
    opening: opening?.balance ?? "0.0000",
    lines,
    lineCount: count?.n ?? 0,
    debits: count?.debits ?? "0.0000",
    credits: count?.credits ?? "0.0000",
  };
}

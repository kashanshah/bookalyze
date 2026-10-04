import {
  describeTransaction,
  MONEY_ACCOUNT_SUBTYPES,
  type PreparedEntry,
  type TransactionKind,
  type TransactionView,
} from "@bookalyze/core";
import { and, count, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { copyAttachmentLinks, countAttachments } from "./attachments";
import type { Transaction } from "./client";
import { LedgerError, postJournalEntry, reverseJournalEntry } from "./ledger";
import { accounts, journalEntries, journalLines, transactionReviews } from "./schema/accounting";

/**
 * The Transactions screen's queries and writes. A transaction is any current journal entry
 * (not reversed, not itself a reversal) with a line on a money account.
 */

const moneySubtypes = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "));

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

export type TransactionFilters = {
  /** Only transactions touching this account. */
  accountId?: string | null;
  kind?: TransactionKind | null;
  reviewed?: boolean | null;
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
  reviewed: boolean;
  /** Number of receipts and files attached. */
  attachments: number;
  lines: { accountId: string; amount: string; description: string | null }[];
  view: TransactionView;
};

export async function listTransactions(
  tx: Transaction,
  filters: TransactionFilters,
): Promise<{ rows: TransactionRow[]; total: number }> {
  const conditions: SQL[] = [
    isNull(journalEntries.reversedByEntryId),
    isNull(journalEntries.reversesEntryId),
    touchesMoney,
  ];
  if (filters.accountId) {
    conditions.push(
      sql`exists (select 1 from ${journalLines} l where l.journal_entry_id = ${journalEntries.id} and l.account_id = ${filters.accountId})`,
    );
  }
  if (filters.kind === "transfer") conditions.push(sql`not ${touchesCategory}`);
  if (filters.kind === "deposit" || filters.kind === "withdrawal") {
    conditions.push(touchesCategory);
    const net = sql`(select coalesce(sum(l.amount), 0) from ${journalLines} l
      join ${accounts} a on a.id = l.account_id
      where l.journal_entry_id = ${journalEntries.id} and a.subtype in (${moneySubtypes}))`;
    conditions.push(filters.kind === "deposit" ? sql`${net} >= 0` : sql`${net} < 0`);
  }
  const reviewedSql = sql`exists (select 1 from ${transactionReviews} r where r.journal_entry_id = ${journalEntries.id})`;
  if (filters.reviewed === true) conditions.push(reviewedSql);
  if (filters.reviewed === false) conditions.push(sql`not ${reviewedSql}`);
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
      reviewed: sql<boolean>`${reviewedSql}`,
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
      amount: journalLines.amount,
      description: journalLines.description,
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
  const moneyIds = new Set(
    lines
      .filter((l) => (MONEY_ACCOUNT_SUBTYPES as readonly string[]).includes(l.subtype))
      .map((l) => l.accountId),
  );
  const byEntry = new Map<string, typeof lines>();
  for (const line of lines) byEntry.set(line.entryId, [...(byEntry.get(line.entryId) ?? []), line]);

  const attachmentCounts = await countAttachments(
    tx,
    "journal_entry",
    entries.map((e) => e.id),
  );
  const rows: TransactionRow[] = [];
  for (const entry of entries) {
    const entryLines = (byEntry.get(entry.id) ?? []).map(({ accountId, amount, description }) => ({
      accountId,
      amount,
      description,
    }));
    const view = describeTransaction(entryLines, (id) => moneyIds.has(id));
    if (view) {
      rows.push({
        ...entry,
        reviewed: Boolean(entry.reviewed),
        attachments: attachmentCounts.get(entry.id) ?? 0,
        lines: entryLines,
        view,
      });
    }
  }
  return { rows, total: totalRow?.n ?? 0 };
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
    entry: PreparedEntry;
  },
) {
  const [original] = await tx
    .select({ date: journalEntries.date })
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
    entry: input.entry,
  });
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

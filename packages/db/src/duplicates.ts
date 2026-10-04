import {
  describeTransaction,
  type MergeCandidate,
  MONEY_ACCOUNT_SUBTYPES,
  mergeProblem,
} from "@bookalyze/core";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { copyAttachmentLinks } from "./attachments";
import type { Transaction } from "./client";
import { reverseJournalEntry } from "./ledger";
import { accounts, duplicateSuggestions, journalEntries, journalLines } from "./schema/accounting";
import { bankLines } from "./schema/banking";

/**
 * Possible duplicates, the way Wave does them: everything a bank sends goes into the books,
 * and a transaction that looks like one already there is flagged. Someone then merges the two
 * (one is reversed, the other stands for both) or says they're different. Two transactions can
 * also be merged by hand when they have the same amount, bank account and category.
 */

/** How far apart two dates may be for transactions to look like the same one. */
export const DUPLICATE_WINDOW_DAYS = 5;

export class DuplicateError extends Error {}

/**
 * A transaction already in the books that `entryId` (just brought in from a bank) may be a copy
 * of: a line on the same account for the same amount within a few days, still current, not
 * itself flagged as a copy, and not something the same bank feed sent separately (the bank's
 * own IDs already tell those apart, e.g. two coffees on one day).
 */
export async function findDuplicateOf(
  tx: Transaction,
  input: {
    entryId: string;
    feedId: string;
    accountId: string;
    amount: string;
    date: string;
    /** For a conversion: the received side must match too. */
    other?: { accountId: string; amount: string };
  },
): Promise<string | null> {
  const e = journalEntries;
  const otherSide = input.other
    ? sql`and exists (select 1 from journal_lines o where o.journal_entry_id = ${e.id}
        and o.account_id = ${input.other.accountId} and o.amount = ${input.other.amount}::numeric)`
    : sql``;
  const rows = await tx.execute<{ id: string }>(sql`
    select ${e.id} as id from ${e}
    where ${e.id} <> ${input.entryId}
      and ${e.date} between (${input.date}::date - ${DUPLICATE_WINDOW_DAYS}::int)
        and (${input.date}::date + ${DUPLICATE_WINDOW_DAYS}::int)
      and ${e.reversedByEntryId} is null
      and ${e.reversesEntryId} is null
      and exists (select 1 from journal_lines l where l.journal_entry_id = ${e.id}
        and l.account_id = ${input.accountId} and l.amount = ${input.amount}::numeric)
      ${otherSide}
      and not exists (select 1 from bank_lines b
        where b.journal_entry_id = ${e.id} and b.feed_id = ${input.feedId})
      and not exists (select 1 from duplicate_suggestions d
        where d.entry_id = ${e.id} and d.status = 'open')
    order by
      exists (select 1 from bank_lines b where b.journal_entry_id = ${e.id}),
      abs(${e.date} - ${input.date}::date),
      ${e.entryNumber}
    limit 1`);
  return rows.rows[0]?.id ?? null;
}

/** Flags `entryId` as a possible copy of `duplicateOfEntryId`. A pair is only flagged once. */
export async function suggestDuplicate(
  tx: Transaction,
  input: { orgId: string; entryId: string; duplicateOfEntryId: string },
): Promise<boolean> {
  const rows = await tx
    .insert(duplicateSuggestions)
    .values({
      organizationId: input.orgId,
      entryId: input.entryId,
      duplicateOfEntryId: input.duplicateOfEntryId,
    })
    .onConflictDoNothing()
    .returning({ id: duplicateSuggestions.id });
  return rows.length > 0;
}

export type DuplicateSuggestion = {
  id: string;
  entryId: string;
  duplicateOf: {
    id: string;
    entryNumber: number;
    date: string;
    memo: string | null;
    source: string;
  };
};

const current = (alias: string) =>
  sql.raw(`${alias}.reversed_by_entry_id is null and ${alias}.reverses_entry_id is null`);

/**
 * Open suggestions where both transactions are still current, optionally only those flagging
 * one of `entryIds`.
 */
export async function listDuplicateSuggestions(
  tx: Transaction,
  input: { entryIds?: readonly string[] } = {},
): Promise<DuplicateSuggestion[]> {
  if (input.entryIds && !input.entryIds.length) return [];
  const filter = input.entryIds
    ? sql`and d.entry_id in (${sql.join(
        input.entryIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const rows = await tx.execute<{
    id: string;
    entry_id: string;
    of_id: string;
    of_number: number;
    of_date: string;
    of_memo: string | null;
    of_source: string;
  }>(sql`
    select d.id, d.entry_id, k.id as of_id, k.entry_number as of_number, k.date::text as of_date,
      k.memo as of_memo, k.source as of_source
    from duplicate_suggestions d
    join journal_entries e on e.id = d.entry_id
    join journal_entries k on k.id = d.duplicate_of_entry_id
    where d.status = 'open' and ${current("e")} and ${current("k")} ${filter}
    order by e.date desc, e.entry_number desc`);
  return rows.rows.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    duplicateOf: {
      id: r.of_id,
      entryNumber: Number(r.of_number),
      date: r.of_date,
      memo: r.of_memo,
      source: r.of_source,
    },
  }));
}

/** How many possible duplicates wait for a decision. */
export async function countOpenDuplicates(tx: Transaction): Promise<number> {
  const rows = await tx.execute<{ n: string }>(sql`
    select count(*)::text as n from duplicate_suggestions d
    join journal_entries e on e.id = d.entry_id
    join journal_entries k on k.id = d.duplicate_of_entry_id
    where d.status = 'open' and ${current("e")} and ${current("k")}`);
  return Number(rows.rows[0]?.n ?? 0);
}

/**
 * `from` now stands as `to` (it was edited, which posts a corrected entry, or merged into it):
 * bank lines follow, so the bank's transaction is still recognised, and open suggestions follow
 * too. A suggestion that would pair `to` with itself is settled as merged.
 */
export async function carryEntryLinks(
  tx: Transaction,
  input: { from: string; to: string; userId?: string | null },
) {
  await tx
    .update(bankLines)
    .set({ journalEntryId: input.to })
    .where(eq(bankLines.journalEntryId, input.from));
  const open = await tx
    .select()
    .from(duplicateSuggestions)
    .where(
      and(
        eq(duplicateSuggestions.status, "open"),
        or(
          eq(duplicateSuggestions.entryId, input.from),
          eq(duplicateSuggestions.duplicateOfEntryId, input.from),
        ),
      ),
    );
  for (const s of open) {
    const entryId = s.entryId === input.from ? input.to : s.entryId;
    const duplicateOfEntryId =
      s.duplicateOfEntryId === input.from ? input.to : s.duplicateOfEntryId;
    if (entryId === duplicateOfEntryId) {
      await tx
        .update(duplicateSuggestions)
        .set({ status: "merged", decidedBy: input.userId ?? null, decidedAt: new Date() })
        .where(eq(duplicateSuggestions.id, s.id));
      continue;
    }
    const [taken] = await tx
      .select({ id: duplicateSuggestions.id })
      .from(duplicateSuggestions)
      .where(
        and(
          eq(duplicateSuggestions.entryId, entryId),
          eq(duplicateSuggestions.duplicateOfEntryId, duplicateOfEntryId),
        ),
      );
    if (taken) {
      // That pair was already decided (or is already open): this copy of the question goes.
      await tx.delete(duplicateSuggestions).where(eq(duplicateSuggestions.id, s.id));
    } else {
      await tx
        .update(duplicateSuggestions)
        .set({ entryId, duplicateOfEntryId })
        .where(eq(duplicateSuggestions.id, s.id));
    }
  }
}

async function currentEntry(tx: Transaction, id: string) {
  const [entry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, id));
  if (!entry) throw new DuplicateError("One of these transactions no longer exists.");
  if (entry.reversedByEntryId || entry.reversesEntryId) {
    throw new DuplicateError(
      "One of these transactions has already been changed. Refresh to see the latest.",
    );
  }
  return entry;
}

/**
 * Merges two transactions: `removeId` is reversed on its own date (so the history stays) and
 * `keepId` stands for both, taking over its bank link and receipts.
 */
export async function mergeEntries(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; keepId: string; removeId: string },
): Promise<{ keptId: string; removedId: string }> {
  if (input.keepId === input.removeId) throw new DuplicateError("Pick two different transactions.");
  await currentEntry(tx, input.keepId);
  const remove = await currentEntry(tx, input.removeId);
  await reverseJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: remove.id,
    date: remove.date,
  });
  await copyAttachmentLinks(tx, {
    orgId: input.orgId,
    entityType: "journal_entry",
    fromEntityId: remove.id,
    toEntityId: input.keepId,
    userId: input.userId,
  });
  await carryEntryLinks(tx, { from: remove.id, to: input.keepId, userId: input.userId });
  return { keptId: input.keepId, removedId: remove.id };
}

async function openSuggestion(tx: Transaction, suggestionId: string) {
  const [s] = await tx
    .select()
    .from(duplicateSuggestions)
    .where(eq(duplicateSuggestions.id, suggestionId));
  if (s?.status !== "open") throw new DuplicateError("This has already been dealt with.");
  return s;
}

/** They're the same: keeps the one that was in the books first and removes the copy. */
export async function acceptDuplicate(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; suggestionId: string },
) {
  const s = await openSuggestion(tx, input.suggestionId);
  return mergeEntries(tx, {
    orgId: input.orgId,
    userId: input.userId,
    keepId: s.duplicateOfEntryId,
    removeId: s.entryId,
  });
}

/** They're different: both stay, and the pair isn't flagged again. */
export async function dismissDuplicate(
  tx: Transaction,
  input: { userId?: string | null; suggestionId: string },
) {
  const s = await openSuggestion(tx, input.suggestionId);
  await tx
    .update(duplicateSuggestions)
    .set({ status: "dismissed", decidedBy: input.userId ?? null, decidedAt: new Date() })
    .where(eq(duplicateSuggestions.id, s.id));
}

const moneySubtypes = new Set<string>(MONEY_ACCOUNT_SUBTYPES);

/** Two current entries as `mergeProblem` sees them. */
async function mergeCandidates(tx: Transaction, ids: readonly string[]) {
  const entries = await tx
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      currency: journalEntries.currency,
    })
    .from(journalEntries)
    .where(inArray(journalEntries.id, [...ids]));
  const lines = await tx
    .select({
      entryId: journalLines.journalEntryId,
      accountId: journalLines.accountId,
      currency: journalLines.currency,
      amount: journalLines.amount,
      taxRateId: journalLines.taxRateId,
      subtype: accounts.subtype,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(inArray(journalLines.journalEntryId, [...ids]));
  const money = new Set(lines.filter((l) => moneySubtypes.has(l.subtype)).map((l) => l.accountId));
  return entries.map((entry) => {
    const view = describeTransaction(
      lines.filter((l) => l.entryId === entry.id),
      (id) => money.has(id),
    );
    return { ...entry, view };
  });
}

/**
 * Merges two transactions picked by hand, when they have the same amount, bank account and
 * category. The older one (lower entry number) stays.
 */
export async function mergeSelected(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; entryIds: readonly string[] },
) {
  const ids = [...new Set(input.entryIds)];
  if (ids.length !== 2) throw new DuplicateError("Pick exactly two transactions to merge.");
  for (const id of ids) await currentEntry(tx, id);
  const [a, b] = (await mergeCandidates(tx, ids)).sort((x, y) => x.entryNumber - y.entryNumber);
  if (!a?.view || !b?.view) throw new DuplicateError("Only transactions can be merged.");
  const problem = mergeProblem(
    { ...a.view, currency: a.currency } satisfies MergeCandidate,
    { ...b.view, currency: b.currency } satisfies MergeCandidate,
  );
  if (problem) throw new DuplicateError(problem);
  return mergeEntries(tx, {
    orgId: input.orgId,
    userId: input.userId,
    keepId: a.id,
    removeId: b.id,
  });
}

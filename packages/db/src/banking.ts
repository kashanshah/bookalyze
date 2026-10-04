import {
  type BankTransaction,
  bankMemo,
  bankTransactionInput,
  type LedgerAccount,
  pairConversions,
  prepareJournalEntry,
  prepareTransfer,
  transactionLines,
} from "@bookalyze/core";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { fxRateOn } from "./fx";
import { LedgerError, postJournalEntry } from "./ledger";
import { accounts, journalEntries } from "./schema/accounting";
import { bankFeeds, bankLines, type ConnectionProvider, connections } from "./schema/banking";

/**
 * Connections to banks and the feeds they fill. Call inside `withOrg()`. Credentials are sealed
 * with vault.ts before they get here and opened only where a sync needs them.
 */

export type ConnectionRow = typeof connections.$inferSelect;
export type BankFeedRow = typeof bankFeeds.$inferSelect;

export async function createConnection(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    provider: ConnectionProvider;
    name: string;
    settings: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(connections)
    .values({
      organizationId: input.orgId,
      provider: input.provider,
      name: input.name,
      settings: input.settings,
      createdBy: input.userId ?? null,
    })
    .returning({ id: connections.id });
  if (!row) throw new Error("Could not save the connection");
  return row;
}

/** Stores a sealed secret (vault.ts format). The plain secret never reaches the database. */
export async function setConnectionSecret(tx: Transaction, connectionId: string, sealed: string) {
  await tx.update(connections).set({ secret: sealed }).where(eq(connections.id, connectionId));
}

export async function getConnection(tx: Transaction, connectionId: string) {
  const [row] = await tx.select().from(connections).where(eq(connections.id, connectionId));
  return row ?? null;
}

/** Connections with their feeds and the accounts they fill, newest first. No secrets. */
export async function listConnections(tx: Transaction) {
  const rows = await tx
    .select({
      id: connections.id,
      provider: connections.provider,
      name: connections.name,
      status: connections.status,
      settings: connections.settings,
      lastSyncedAt: connections.lastSyncedAt,
      lastError: connections.lastError,
      createdAt: connections.createdAt,
    })
    .from(connections)
    .orderBy(asc(connections.createdAt));
  const feeds = await tx
    .select({
      id: bankFeeds.id,
      connectionId: bankFeeds.connectionId,
      externalId: bankFeeds.externalId,
      currency: bankFeeds.currency,
      name: bankFeeds.name,
      accountId: bankFeeds.accountId,
      accountName: accounts.name,
      accountCode: accounts.code,
      syncFrom: bankFeeds.syncFrom,
      syncedThrough: bankFeeds.syncedThrough,
      isActive: bankFeeds.isActive,
    })
    .from(bankFeeds)
    .innerJoin(accounts, eq(accounts.id, bankFeeds.accountId))
    .orderBy(asc(bankFeeds.currency));
  return rows.map((c) => ({ ...c, feeds: feeds.filter((f) => f.connectionId === c.id) }));
}

export async function listFeeds(tx: Transaction, connectionId: string): Promise<BankFeedRow[]> {
  return tx
    .select()
    .from(bankFeeds)
    .where(and(eq(bankFeeds.connectionId, connectionId), eq(bankFeeds.isActive, true)))
    .orderBy(asc(bankFeeds.currency));
}

export async function addBankFeed(
  tx: Transaction,
  input: {
    orgId: string;
    connectionId: string;
    externalId: string;
    currency: string;
    name: string;
    accountId: string;
    syncFrom: string;
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(bankFeeds)
    .values({ organizationId: input.orgId, ...input })
    .returning({ id: bankFeeds.id });
  if (!row) throw new Error("Could not save the bank feed");
  return row;
}

export async function markFeedSynced(tx: Transaction, feedId: string, through: Date) {
  await tx.update(bankFeeds).set({ syncedThrough: through }).where(eq(bankFeeds.id, feedId));
}

export async function recordConnectionSync(
  tx: Transaction,
  connectionId: string,
  result: { at: Date; error: string | null },
) {
  await tx
    .update(connections)
    .set({
      lastSyncedAt: result.error ? undefined : result.at,
      lastError: result.error,
      status: result.error ? "error" : "active",
    })
    .where(eq(connections.id, connectionId));
}

/** Forgets the credentials and stops syncing. Imported transactions stay in the books. */
export async function disconnectConnection(tx: Transaction, connectionId: string) {
  await tx
    .update(connections)
    .set({ secret: null, status: "disconnected" })
    .where(eq(connections.id, connectionId));
  await tx
    .update(bankFeeds)
    .set({ isActive: false })
    .where(eq(bankFeeds.connectionId, connectionId));
}

/** Bank transaction IDs already in the books (posted, edited or deleted since). */
export async function existingBankSourceIds(
  tx: Transaction,
  ids: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await tx
      .select({ id: journalEntries.sourceId })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.source, "bank_import"),
          isNotNull(journalEntries.sourceId),
          inArray(journalEntries.sourceId, chunk),
        ),
      );
    for (const r of rows) if (r.id) found.add(r.id);
  }
  return found;
}

export type FeedLine = BankTransaction & { feedId: string };

export type ImportResult = {
  /** New journal entries made. */
  posted: number;
  /** Seen before (an earlier sync or the same file again): left alone. */
  duplicates: number;
  /** Look like transactions already in the books; waiting for someone to merge or keep both. */
  suggested: number;
  /** Couldn't be posted yet, with the reason; they're tried again next time. */
  skipped: { externalId: string; date: string; reason: string }[];
};

const conversionId = (pairKey: string) => `conversion:${pairKey}`;
/** How far apart the bank's date and the books' date may be for a suggested match. */
export const MATCH_WINDOW_DAYS = 5;

type BankLineRow = typeof bankLines.$inferSelect;

/**
 * Brings bank lines into the books. Each line is stored once in `bank_lines` (its external ID is
 * unique), so a re-sync or the same file uploaded again adds nothing. Then each new line either:
 * - waits as a suggested match, when a transaction already in the books looks like it (same
 *   bank account, same amount, within a few days, not itself from the bank), so nothing is
 *   counted twice without someone saying so; or
 * - is posted as a new entry: to Uncategorized (fee split out), or, for a conversion between two
 *   connected balances, as one transfer.
 * Lines that can't be posted yet (no exchange rate, closed period) stay pending and are retried.
 */
export async function importBankLines(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    baseCurrency: string;
    lines: readonly FeedLine[];
  },
): Promise<ImportResult> {
  const result: ImportResult = { posted: 0, duplicates: 0, suggested: 0, skipped: [] };
  if (!input.lines.length) return result;

  // Lines posted by the first version of the sync, before bank_lines existed.
  const ids = input.lines.flatMap((l) => [
    l.externalId,
    ...(l.pairKey ? [conversionId(l.pairKey)] : []),
  ]);
  const posted = await existingBankSourceIds(tx, ids);

  const inserted: BankLineRow[] = [];
  for (let i = 0; i < input.lines.length; i += 200) {
    const chunk = input.lines.slice(i, i + 200);
    const rows = await tx
      .insert(bankLines)
      .values(
        chunk.map((l) => ({
          organizationId: input.orgId,
          feedId: l.feedId,
          externalId: l.externalId,
          pairKey: l.pairKey ?? null,
          date: l.date,
          currency: l.currency,
          amount: l.amount,
          fee: l.fee,
          description: l.description,
          counterparty: l.counterparty,
          reference: l.reference,
          kind: l.kind,
          conversion: l.conversion ?? null,
        })),
      )
      .onConflictDoNothing({ target: [bankLines.organizationId, bankLines.externalId] })
      .returning();
    inserted.push(...rows);
  }
  const insertedIds = new Set(inserted.map((r) => r.externalId));
  // Already known lines still pending (no rate yet, closed period) get another try.
  const retry = await tx
    .select()
    .from(bankLines)
    .where(
      and(
        eq(bankLines.status, "pending"),
        inArray(
          bankLines.externalId,
          input.lines.map((l) => l.externalId).filter((id) => !insertedIds.has(id)),
        ),
      ),
    );
  result.duplicates = input.lines.length - inserted.length - retry.length;

  const work: BankLineRow[] = [];
  for (const row of [...inserted, ...retry]) {
    const already =
      posted.has(row.externalId) || (row.pairKey && posted.has(conversionId(row.pairKey)));
    if (already) {
      const [entry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.source, "bank_import"),
            inArray(journalEntries.sourceId, [
              row.externalId,
              ...(row.pairKey ? [conversionId(row.pairKey)] : []),
            ]),
          ),
        )
        .limit(1);
      if (entry) {
        await tx
          .update(bankLines)
          .set({ status: "posted", journalEntryId: entry.id })
          .where(eq(bankLines.id, row.id));
        result.duplicates++;
        continue;
      }
    }
    work.push(row);
  }
  const done = await processBankLines(tx, { ...input, rows: work });
  result.posted += done.posted;
  result.suggested += done.suggested;
  result.skipped.push(...done.skipped);
  return result;
}

const toLine = (row: BankLineRow): FeedLine => ({
  feedId: row.feedId,
  externalId: row.externalId,
  ...(row.pairKey ? { pairKey: row.pairKey } : {}),
  date: row.date,
  currency: row.currency,
  amount: row.amount,
  fee: row.fee,
  description: row.description,
  counterparty: row.counterparty,
  reference: row.reference,
  kind: row.kind as BankTransaction["kind"],
  ...(row.conversion ? { conversion: row.conversion } : {}),
});

/** A transaction already in the books that looks like this bank movement, if any. */
async function findMatch(
  tx: Transaction,
  input: {
    accountId: string;
    amount: string;
    date: string;
    other?: { accountId: string; amount: string };
  },
): Promise<string | null> {
  const window = sql`${journalEntries.date} between (${input.date}::date - ${MATCH_WINDOW_DAYS}::int) and (${input.date}::date + ${MATCH_WINDOW_DAYS}::int)`;
  const otherSide = input.other
    ? sql`and exists (select 1 from journal_lines o where o.journal_entry_id = ${journalEntries.id}
        and o.account_id = ${input.other.accountId} and o.amount = ${input.other.amount}::numeric)`
    : sql``;
  const rows = await tx.execute<{ id: string }>(sql`
    select ${journalEntries.id} as id from ${journalEntries}
    where ${window}
      and ${journalEntries.reversedByEntryId} is null
      and ${journalEntries.reversesEntryId} is null
      and ${journalEntries.source} <> 'bank_import'
      and exists (select 1 from journal_lines l where l.journal_entry_id = ${journalEntries.id}
        and l.account_id = ${input.accountId} and l.amount = ${input.amount}::numeric)
      ${otherSide}
      and not exists (select 1 from bank_lines b
        where b.journal_entry_id = ${journalEntries.id} or b.suggested_entry_id = ${journalEntries.id})
    order by abs(${journalEntries.date} - ${input.date}::date), ${journalEntries.entryNumber}
    limit 1`);
  return rows.rows[0]?.id ?? null;
}

/** Suggests a match for, or posts, each row; `rows` are bank lines not yet posted or matched. */
async function processBankLines(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    baseCurrency: string;
    rows: readonly BankLineRow[];
  },
): Promise<Omit<ImportResult, "duplicates">> {
  const result = { posted: 0, suggested: 0, skipped: [] as ImportResult["skipped"] };
  if (!input.rows.length) return result;
  const all = await tx.select().from(accounts);
  const ledger = new Map<string, LedgerAccount>(
    all.map((a) => [
      a.id,
      { id: a.id, name: a.name, currency: a.currency, isArchived: a.isArchived },
    ]),
  );
  const income = all.find((a) => a.systemKey === "uncategorized_income");
  const expense = all.find((a) => a.systemKey === "uncategorized_expense");
  if (!income || !expense)
    throw new Error("The chart of accounts is missing its uncategorized accounts.");
  const feedRows = await tx
    .select({ id: bankFeeds.id, accountId: bankFeeds.accountId, settings: connections.settings })
    .from(bankFeeds)
    .innerJoin(connections, eq(connections.id, bankFeeds.connectionId))
    .where(inArray(bankFeeds.id, [...new Set(input.rows.map((r) => r.feedId))]));
  const feeds = new Map(
    feedRows.map((f) => {
      const fee = typeof f.settings.feeAccountId === "string" ? f.settings.feeAccountId : null;
      return [
        f.id,
        { accountId: f.accountId, feeAccountId: fee && ledger.has(fee) ? fee : expense.id },
      ];
    }),
  );
  const byExternal = new Map(input.rows.map((r) => [r.externalId, r]));

  const rateFor = async (currency: string, date: string) => {
    if (currency === input.baseCurrency) return undefined;
    const quote = await fxRateOn(tx, { base: input.baseCurrency, quote: currency, date });
    if (!quote) throw new SkipLine(`No ${currency} exchange rate for ${date} yet.`);
    return quote.rate;
  };

  const mark = (rows: BankLineRow[], set: Partial<typeof bankLines.$inferInsert>) =>
    tx
      .update(bankLines)
      .set(set)
      .where(
        inArray(
          bankLines.id,
          rows.map((r) => r.id),
        ),
      );

  const suggest = async (rows: BankLineRow[], entryId: string | null) => {
    if (!entryId || rows.some((r) => r.matchDeclined)) return false;
    await mark(rows, { status: "suggested", suggestedEntryId: entryId, reason: null });
    result.suggested += rows.length;
    return true;
  };

  const post = async (
    rows: BankLineRow[],
    sourceId: string,
    build: () => Promise<ReturnType<typeof prepareJournalEntry>>,
  ) => {
    const line = rows[0] as BankLineRow;
    try {
      const prepared = await build();
      if (!prepared.ok) {
        throw new SkipLine(
          prepared.errors.form ?? prepared.errors.fxRate ?? "It doesn't add up as an entry.",
        );
      }
      const entry = await tx.transaction((sp) =>
        postJournalEntry(sp, {
          orgId: input.orgId,
          userId: input.userId,
          date: line.date,
          memo: bankMemo(toLine(rows.at(-1) as BankLineRow)),
          reference: line.reference,
          source: "bank_import",
          sourceId,
          entry: prepared.entry,
        }),
      );
      await mark(rows, {
        status: "posted",
        journalEntryId: entry.id,
        suggestedEntryId: null,
        reason: null,
      });
      result.posted++;
    } catch (error) {
      const reason =
        error instanceof SkipLine || error instanceof LedgerError
          ? error.message
          : "It couldn't be saved.";
      await mark(rows, { status: "pending", reason });
      for (const r of rows) result.skipped.push({ externalId: r.externalId, date: r.date, reason });
    }
  };

  const { pairs, singles } = pairConversions(input.rows.map(toLine));
  for (const { from, to } of pairs) {
    const fromFeed = feeds.get(from.feedId);
    const toFeed = feeds.get(to.feedId);
    const rows = [byExternal.get(from.externalId), byExternal.get(to.externalId)] as BankLineRow[];
    if (!fromFeed || !toFeed || !from.pairKey) {
      singles.push(from, to);
      continue;
    }
    const match = await findMatch(tx, {
      accountId: fromFeed.accountId,
      amount: from.amount,
      date: from.date,
      other: { accountId: toFeed.accountId, amount: to.amount },
    });
    if (await suggest(rows, match)) continue;
    await post(rows, conversionId(from.pairKey), async () =>
      prepareTransfer(
        {
          fromAccountId: fromFeed.accountId,
          toAccountId: toFeed.accountId,
          sent: from.amount.replace("-", ""),
          received: to.amount,
          baseCurrency: input.baseCurrency,
          fxRate:
            from.currency !== input.baseCurrency && to.currency !== input.baseCurrency
              ? await rateFor(from.currency, from.date)
              : undefined,
          memo: bankMemo(to),
        },
        ledger,
      ),
    );
  }

  for (const line of singles) {
    const feed = feeds.get(line.feedId);
    const row = byExternal.get(line.externalId);
    if (!feed || !row) continue;
    const match = await findMatch(tx, {
      accountId: feed.accountId,
      amount: line.amount,
      date: line.date,
    });
    if (await suggest([row], match)) continue;
    await post([row], line.externalId, async () =>
      prepareJournalEntry(
        {
          currency: line.currency,
          baseCurrency: input.baseCurrency,
          fxRate: await rateFor(line.currency, line.date),
          lines: transactionLines(
            bankTransactionInput(line, {
              moneyAccountId: feed.accountId,
              uncategorizedIncomeId: income.id,
              uncategorizedExpenseId: expense.id,
              feeAccountId: feed.feeAccountId,
            }),
            null,
          ),
        },
        ledger,
      ),
    );
  }
  return result;
}

class SkipLine extends Error {}

export class BankLineError extends Error {}

/** Bank lines waiting for a decision, each with the transaction already in the books it resembles. */
export async function listSuggestedMatches(tx: Transaction) {
  const rows = await tx
    .select({
      id: bankLines.id,
      pairKey: bankLines.pairKey,
      date: bankLines.date,
      currency: bankLines.currency,
      amount: bankLines.amount,
      description: bankLines.description,
      feedName: bankFeeds.name,
      accountId: bankFeeds.accountId,
      accountName: accounts.name,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.date,
      entryMemo: journalEntries.memo,
      entrySource: journalEntries.source,
    })
    .from(bankLines)
    .innerJoin(bankFeeds, eq(bankFeeds.id, bankLines.feedId))
    .innerJoin(accounts, eq(accounts.id, bankFeeds.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, bankLines.suggestedEntryId))
    .where(eq(bankLines.status, "suggested"))
    .orderBy(asc(bankLines.date), asc(bankLines.externalId));
  // Both sides of a conversion are one decision: show the side the money left from.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.pairKey) return true;
    const key = `${r.pairKey}:${r.entryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function suggestionGroup(tx: Transaction, bankLineId: string): Promise<BankLineRow[]> {
  const [row] = await tx.select().from(bankLines).where(eq(bankLines.id, bankLineId));
  if (row?.status !== "suggested" || !row.suggestedEntryId) {
    throw new BankLineError("This suggestion has already been dealt with.");
  }
  if (!row.pairKey) return [row];
  return tx
    .select()
    .from(bankLines)
    .where(
      and(
        eq(bankLines.pairKey, row.pairKey),
        eq(bankLines.status, "suggested"),
        eq(bankLines.suggestedEntryId, row.suggestedEntryId),
      ),
    );
}

/**
 * They're the same: the bank line is linked to the existing transaction and nothing new is
 * posted. Refused if that transaction was changed or removed since the suggestion.
 */
export async function mergeBankLine(
  tx: Transaction,
  input: { bankLineId: string; userId?: string | null },
): Promise<{ entryId: string }> {
  const rows = await suggestionGroup(tx, input.bankLineId);
  const entryId = rows[0]?.suggestedEntryId as string;
  const [entry] = await tx
    .select({ reversedBy: journalEntries.reversedByEntryId })
    .from(journalEntries)
    .where(eq(journalEntries.id, entryId));
  if (!entry || entry.reversedBy) {
    throw new BankLineError(
      "That transaction was changed or removed since. Keep both, or sync again.",
    );
  }
  await tx
    .update(bankLines)
    .set({
      status: "matched",
      journalEntryId: entryId,
      suggestedEntryId: null,
      decidedBy: input.userId ?? null,
      decidedAt: new Date(),
    })
    .where(
      inArray(
        bankLines.id,
        rows.map((r) => r.id),
      ),
    );
  return { entryId };
}

/** They're different: post the bank line as a new transaction, without looking for a match again. */
export async function keepBankLineSeparate(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; baseCurrency: string; bankLineId: string },
): Promise<Omit<ImportResult, "duplicates">> {
  const rows = await suggestionGroup(tx, input.bankLineId);
  await tx
    .update(bankLines)
    .set({
      status: "pending",
      suggestedEntryId: null,
      matchDeclined: true,
      decidedBy: input.userId ?? null,
      decidedAt: new Date(),
    })
    .where(
      inArray(
        bankLines.id,
        rows.map((r) => r.id),
      ),
    );
  const fresh = await tx
    .select()
    .from(bankLines)
    .where(
      inArray(
        bankLines.id,
        rows.map((r) => r.id),
      ),
    );
  return processBankLines(tx, { ...input, rows: fresh });
}

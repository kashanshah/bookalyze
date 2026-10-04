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
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Transaction } from "./client";
import { fxRateOn } from "./fx";
import { LedgerError, postJournalEntry } from "./ledger";
import { accounts, journalEntries } from "./schema/accounting";
import { bankFeeds, type ConnectionProvider, connections } from "./schema/banking";

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
  posted: number;
  /** Already in the books from an earlier sync. */
  duplicates: number;
  /** Lines that couldn't be posted, with the reason; they're tried again next sync. */
  skipped: { externalId: string; date: string; reason: string }[];
};

const conversionId = (pairKey: string) => `conversion:${pairKey}`;

/**
 * Posts new bank lines as journal entries (source 'bank_import', `source_id` = the line's
 * external ID, so a line is never posted twice). A conversion between two of the company's own
 * feeds becomes one transfer between the two accounts. Each line is posted on its own (a
 * savepoint), so one that can't be (a closed period, no exchange rate yet) doesn't stop the rest.
 */
export async function importBankLines(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    baseCurrency: string;
    /** Where bank fees go; uncategorized expense when not set. */
    feeAccountId?: string | null;
    feeds: ReadonlyMap<string, { accountId: string }>;
    lines: readonly FeedLine[];
  },
): Promise<ImportResult> {
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
  const feeAccountId =
    input.feeAccountId && ledger.has(input.feeAccountId) ? input.feeAccountId : expense.id;

  const ids = input.lines.flatMap((l) => [
    l.externalId,
    ...(l.pairKey ? [conversionId(l.pairKey)] : []),
  ]);
  const existing = await existingBankSourceIds(tx, ids);
  const result: ImportResult = { posted: 0, duplicates: 0, skipped: [] };
  const fresh = input.lines.filter((l) => {
    const seen = existing.has(l.externalId) || (l.pairKey && existing.has(conversionId(l.pairKey)));
    if (seen) result.duplicates++;
    return !seen;
  });

  const rateFor = async (currency: string, date: string) => {
    if (currency === input.baseCurrency) return undefined;
    const quote = await fxRateOn(tx, { base: input.baseCurrency, quote: currency, date });
    if (!quote) throw new SkipLine(`No ${currency} exchange rate for ${date} yet.`);
    return quote.rate;
  };

  const post = async (
    line: FeedLine,
    sourceId: string,
    build: () => Promise<ReturnType<typeof prepareJournalEntry>>,
  ) => {
    try {
      const prepared = await build();
      if (!prepared.ok) {
        const reason =
          prepared.errors.form ?? prepared.errors.fxRate ?? "It doesn't add up as an entry.";
        throw new SkipLine(reason);
      }
      await tx.transaction((sp) =>
        postJournalEntry(sp, {
          orgId: input.orgId,
          userId: input.userId,
          date: line.date,
          memo: bankMemo(line),
          reference: line.reference,
          source: "bank_import",
          sourceId,
          entry: prepared.entry,
        }),
      );
      result.posted++;
    } catch (error) {
      const reason =
        error instanceof SkipLine
          ? error.message
          : error instanceof LedgerError
            ? error.message
            : "It couldn't be saved.";
      result.skipped.push({ externalId: line.externalId, date: line.date, reason });
    }
  };

  const { pairs, singles } = pairConversions(fresh);
  for (const { from, to } of pairs) {
    const fromFeed = input.feeds.get(from.feedId);
    const toFeed = input.feeds.get(to.feedId);
    if (!fromFeed || !toFeed || !from.pairKey) {
      singles.push(from, to);
      continue;
    }
    await post(from, conversionId(from.pairKey), async () =>
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
    const feed = input.feeds.get(line.feedId);
    if (!feed) continue;
    await post(line, line.externalId, async () =>
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
              feeAccountId,
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

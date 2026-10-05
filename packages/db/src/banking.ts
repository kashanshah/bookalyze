import {
  type BankTransaction,
  bankMemo,
  bankTransactionInput,
  firstMatchingRule,
  type LedgerAccount,
  pairConversions,
  prepareJournalEntry,
  prepareTransfer,
  transactionLines,
} from "@bookalyze/core";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { findDuplicateOf, suggestDuplicate } from "./duplicates";
import { fxRateOn } from "./fx";
import { LedgerError, postJournalEntry } from "./ledger";
import { activeRules, recordRuleApplication } from "./rules";
import { accounts } from "./schema/accounting";
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

/** Bank connections with their feeds and the accounts they fill, newest first. No secrets. */
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
    // Marketplace connections live under Commerce.
    .where(ne(connections.provider, "amazon_sp"))
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
      bankBalance: bankFeeds.bankBalance,
      bankBalanceOn: bankFeeds.bankBalanceOn,
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

/** The statement-upload feed for a money account: its connection, feed and remembered columns. */
export async function findStatementFeed(tx: Transaction, accountId: string) {
  const [row] = await tx
    .select({
      connectionId: connections.id,
      feedId: bankFeeds.id,
      currency: bankFeeds.currency,
      settings: connections.settings,
      isActive: bankFeeds.isActive,
    })
    .from(bankFeeds)
    .innerJoin(connections, eq(connections.id, bankFeeds.connectionId))
    .where(and(eq(connections.provider, "csv"), eq(bankFeeds.accountId, accountId)))
    .orderBy(desc(bankFeeds.isActive), desc(bankFeeds.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * The statement-upload feed for a money account, made on its first upload. Uploads are a
 * connection of their own (provider "csv", no credentials), so their lines go through the same
 * bank lines, duplicate check and possible-duplicate flags as a synced bank.
 */
export async function statementFeedFor(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    accountId: string;
    accountName: string;
    currency: string;
    firstDate: string;
  },
) {
  const found = await findStatementFeed(tx, input.accountId);
  if (found) {
    // Uploads stopped earlier start again on the same feed.
    if (!found.isActive) {
      await tx.update(bankFeeds).set({ isActive: true }).where(eq(bankFeeds.id, found.feedId));
    }
    return found;
  }
  const connection = await createConnection(tx, {
    orgId: input.orgId,
    userId: input.userId,
    provider: "csv",
    name: input.accountName,
    settings: {},
  });
  const feed = await addBankFeed(tx, {
    orgId: input.orgId,
    connectionId: connection.id,
    externalId: "statement",
    currency: input.currency,
    name: input.accountName,
    accountId: input.accountId,
    syncFrom: input.firstDate,
  });
  return {
    connectionId: connection.id,
    feedId: feed.id,
    currency: input.currency,
    settings: {} as Record<string, unknown>,
    isActive: true,
  };
}

/** Remembers how an account's statements are written, and when one was last uploaded. */
export async function recordStatementUpload(
  tx: Transaction,
  connectionId: string,
  settings: Record<string, unknown>,
) {
  await tx
    .update(connections)
    .set({ settings, lastSyncedAt: new Date(), lastError: null, status: "active" })
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

export type FeedLine = BankTransaction & { feedId: string };

export type ImportResult = {
  /** New journal entries made. */
  posted: number;
  /** Seen before (an earlier sync or the same file again): left alone. */
  duplicates: number;
  /** Of those posted, how many look like a transaction already in the books (flagged to check). */
  flagged: number;
  /** Of those posted, how many a rule put in a category (instead of Uncategorized). */
  categorized: number;
  /** Couldn't be posted yet, with the reason; they're tried again next time. */
  skipped: { externalId: string; date: string; reason: string }[];
};

const conversionId = (pairKey: string) => `conversion:${pairKey}`;

type BankLineRow = typeof bankLines.$inferSelect;

/**
 * Brings bank lines into the books. Each line is stored once in `bank_lines` (its external ID is
 * unique), so a re-sync or the same file uploaded again adds nothing. Each new line is posted:
 * to Uncategorized (fee split out) or, for a conversion between two connected balances, as one
 * transfer. One that looks like a transaction already in the books is flagged as a possible
 * duplicate for someone to merge or keep (see duplicates.ts); nothing is merged on its own.
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
  const result: ImportResult = {
    posted: 0,
    duplicates: 0,
    flagged: 0,
    categorized: 0,
    skipped: [],
  };
  if (!input.lines.length) return result;

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
  const known = input.lines.map((l) => l.externalId).filter((id) => !insertedIds.has(id));
  const retry = known.length
    ? await tx
        .select()
        .from(bankLines)
        .where(and(eq(bankLines.status, "pending"), inArray(bankLines.externalId, known)))
    : [];
  result.duplicates = input.lines.length - inserted.length - retry.length;

  const done = await postBankLines(tx, { ...input, rows: [...inserted, ...retry] });
  result.posted = done.posted;
  result.flagged = done.flagged;
  result.categorized = done.categorized;
  result.skipped = done.skipped;
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

/** Posts each row (bank lines not yet in the books) and flags possible duplicates. */
async function postBankLines(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    baseCurrency: string;
    rows: readonly BankLineRow[];
  },
): Promise<Omit<ImportResult, "duplicates">> {
  const result = {
    posted: 0,
    flagged: 0,
    categorized: 0,
    skipped: [] as ImportResult["skipped"],
  };
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

  const post = async (
    rows: BankLineRow[],
    sourceId: string,
    build: () => Promise<ReturnType<typeof prepareJournalEntry>>,
    match: Omit<Parameters<typeof findDuplicateOf>[1], "entryId">,
    rule?: { id: string; contactId: string | null } | null,
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
          contactId: rule?.contactId ?? null,
          entry: prepared.entry,
        }),
      );
      await mark(rows, { status: "posted", journalEntryId: entry.id, reason: null });
      result.posted++;
      if (rule) {
        await recordRuleApplication(tx, { orgId: input.orgId, entryId: entry.id, ruleId: rule.id });
        result.categorized++;
      }
      const duplicateOf = await findDuplicateOf(tx, { ...match, entryId: entry.id });
      if (
        duplicateOf &&
        (await suggestDuplicate(tx, {
          orgId: input.orgId,
          entryId: entry.id,
          duplicateOfEntryId: duplicateOf,
        }))
      ) {
        result.flagged++;
      }
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
    await post(
      rows,
      conversionId(from.pairKey),
      async () =>
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
      {
        feedId: from.feedId,
        accountId: fromFeed.accountId,
        amount: from.amount,
        date: from.date,
        other: { accountId: toFeed.accountId, amount: to.amount },
      },
    );
  }

  const rules = await activeRules(tx);
  for (const line of singles) {
    const feed = feeds.get(line.feedId);
    const row = byExternal.get(line.externalId);
    if (!feed || !row) continue;
    // A rule puts it straight into its category; fees still go to the fee account.
    const rule =
      line.kind === "fee"
        ? null
        : firstMatchingRule(rules, {
            text: [line.description, line.counterparty, line.reference].filter(Boolean).join(" "),
            amount: line.amount,
            accountId: feed.accountId,
          });
    await post(
      [row],
      line.externalId,
      async () =>
        prepareJournalEntry(
          {
            currency: line.currency,
            baseCurrency: input.baseCurrency,
            fxRate: await rateFor(line.currency, line.date),
            lines: transactionLines(
              bankTransactionInput(line, {
                moneyAccountId: feed.accountId,
                uncategorizedIncomeId: rule?.categoryAccountId ?? income.id,
                uncategorizedExpenseId: rule?.categoryAccountId ?? expense.id,
                feeAccountId: feed.feeAccountId,
              }),
              null,
            ),
          },
          ledger,
        ),
      { feedId: line.feedId, accountId: feed.accountId, amount: line.amount, date: line.date },
      rule,
    );
  }
  return result;
}

class SkipLine extends Error {}

/**
 * Keeps what the bank says a feed's account holds (Wise's balance, a statement's closing
 * balance). An older figure never replaces a newer one, so uploading last year's statement
 * doesn't hide this month's.
 */
export async function recordFeedBalance(
  tx: Transaction,
  feedId: string,
  balance: { amount: string; on: string },
) {
  await tx
    .update(bankFeeds)
    .set({ bankBalance: balance.amount, bankBalanceOn: balance.on })
    .where(
      and(
        eq(bankFeeds.id, feedId),
        sql`(${bankFeeds.bankBalanceOn} is null or ${bankFeeds.bankBalanceOn} <= ${balance.on}::date)`,
      ),
    );
}

/**
 * Each bank, card and cash account's balance in Bookalyze, in its own currency: everything
 * posted to it, and (for accounts a bank reports on) up to the day of the bank's figure, so the
 * two can be compared. Lines in another currency (imported before the account was switched to
 * it) can't be added in and are counted instead.
 */
export async function moneyAccountBalances(tx: Transaction) {
  const rows = await tx.execute<{
    account_id: string;
    currency: string | null;
    balance: string;
    other_currency: string;
  }>(sql`
    select a.id as account_id, a.currency,
      -- An account without a currency of its own is shown in the main currency.
      coalesce(sum(case when a.currency is null then l.base_amount
        when l.currency = a.currency then l.amount end), 0)::text as balance,
      -- Only current entries: a corrected line and its reversal cancel out.
      count(l.id) filter (where l.currency <> a.currency
        and e.reversed_by_entry_id is null and e.reverses_entry_id is null)::text as other_currency
    from accounts a
    left join journal_lines l on l.account_id = a.id
    left join journal_entries e on e.id = l.journal_entry_id
    where a.subtype in ('cash_bank', 'credit_card', 'money_in_transit') and not a.is_archived
    group by a.id, a.currency`);
  const asOf = await tx.execute<{ feed_id: string; balance: string }>(sql`
    select f.id as feed_id,
      coalesce(sum(l.amount) filter (where e.date <= f.bank_balance_on and l.currency = f.currency), 0)::text as balance
    from bank_feeds f
    left join journal_lines l on l.account_id = f.account_id
    left join journal_entries e on e.id = l.journal_entry_id
    where f.bank_balance_on is not null
    group by f.id`);
  return {
    accounts: rows.rows.map((r) => ({
      accountId: r.account_id,
      currency: r.currency,
      balance: r.balance,
      otherCurrency: Number(r.other_currency),
    })),
    /** By feed: the account's balance on the day of the bank's figure. */
    onBankDay: new Map(asOf.rows.map((r) => [r.feed_id, r.balance])),
  };
}

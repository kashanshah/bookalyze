import {
  buildSettlementEntry,
  type LedgerAccount,
  prepareJournalEntry,
  SETTLEMENT_ACCOUNT_KEYS,
  type Settlement,
  type SettlementAccountKey,
  type SettlementAccounts,
} from "@bookalyze/core";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { formatEntryNumber, LedgerError, postJournalEntry, reverseJournalEntry } from "./ledger";
import { accounts, journalEntries } from "./schema/accounting";
import { connections } from "./schema/banking";
import {
  salesChannels,
  settlementAccounts,
  settlementLines,
  settlementSettings,
  settlements,
} from "./schema/commerce";

/**
 * Amazon settlements as Amazon reports them (one row per settlement, its amounts summed by
 * kind). Brought in from the Reports API or uploaded as the flat file; nothing posts yet.
 */

/** Amazon connections settlements are brought in for (credentials kept, not disconnected). */
export async function settlementConnections(tx: Transaction) {
  return tx
    .select({
      id: connections.id,
      name: connections.name,
      settings: connections.settings,
      secret: connections.secret,
      settlementsSyncedAt: connections.settlementsSyncedAt,
    })
    .from(connections)
    .where(
      and(
        eq(connections.provider, "amazon_sp"),
        isNotNull(connections.secret),
        ne(connections.status, "disconnected"),
      ),
    )
    .orderBy(asc(connections.createdAt));
}

/** Report IDs already in, so they aren't downloaded again. */
export async function knownSettlementReports(tx: Transaction): Promise<Set<string>> {
  const rows = await tx
    .select({ reportId: settlements.reportId })
    .from(settlements)
    .where(isNotNull(settlements.reportId));
  return new Set(rows.map((r) => r.reportId ?? ""));
}

export async function markSettlementsSynced(tx: Transaction, connectionId: string, at: Date) {
  await tx
    .update(connections)
    .set({ settlementsSyncedAt: at })
    .where(eq(connections.id, connectionId));
}

/**
 * The company's channel a settlement is for: the one named like its marketplace (e.g.
 * "Amazon.ca"), else the only channel in its currency (of the connection, when known).
 */
export async function settlementChannel(
  tx: Transaction,
  input: { connectionId: string | null; marketplace: string | null; currency: string },
): Promise<string | null> {
  const channels = await tx.select().from(salesChannels);
  const scoped = input.connectionId
    ? channels.filter((c) => c.connectionId === input.connectionId)
    : channels;
  const named = input.marketplace?.toLowerCase();
  const byName = scoped.find((c) => c.name.toLowerCase() === named);
  if (byName) return byName.id;
  const byCurrency = scoped.filter((c) => c.currency === input.currency);
  return byCurrency.length === 1 ? (byCurrency[0]?.id ?? null) : null;
}

/**
 * Saves a settlement (a new one, or the same settlement again: its amounts are replaced).
 * Returns its ID and whether it was new.
 */
export async function saveSettlement(
  tx: Transaction,
  input: {
    orgId: string;
    connectionId: string | null;
    channelId: string | null;
    reportId: string | null;
    source: "amazon" | "upload";
    settlement: Settlement;
  },
): Promise<{ id: string; created: boolean }> {
  const s = input.settlement;
  const values = {
    connectionId: input.connectionId,
    channelId: input.channelId,
    reportId: input.reportId,
    source: input.source,
    startAt: new Date(s.startAt),
    endAt: new Date(s.endAt),
    depositDate: s.depositDate,
    total: s.total,
    currency: s.currency,
    marketplace: s.marketplace,
    orderCount: s.orderCount,
    balanced: s.balanced,
  };
  const [row] = await tx
    .insert(settlements)
    .values({ organizationId: input.orgId, externalId: s.settlementId, ...values })
    .onConflictDoUpdate({
      target: [settlements.organizationId, settlements.externalId],
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: settlements.id, created: sql<boolean>`(xmax = 0)` });
  if (!row) throw new Error("The settlement couldn't be saved.");
  await tx.delete(settlementLines).where(eq(settlementLines.settlementId, row.id));
  if (s.lines.length) {
    await tx.insert(settlementLines).values(
      s.lines.map((l) => ({
        organizationId: input.orgId,
        settlementId: row.id,
        transactionType: l.transactionType.slice(0, 200),
        amountType: l.amountType.slice(0, 200),
        amountDescription: l.amountDescription.slice(0, 200),
        amount: l.amount,
        count: l.count,
      })),
    );
  }
  return { id: row.id, created: Boolean(row.created) };
}

/** The settlement's entry, while it's in the books (posted and not reversed). */
const postedEntry = and(
  eq(journalEntries.id, settlements.journalEntryId),
  isNull(journalEntries.reversedByEntryId),
);

/** Settlements, newest first, with their marketplace. */
export async function listSettlements(
  tx: Transaction,
  input: { channelId?: string | null; limit: number; offset: number },
) {
  const where = input.channelId ? eq(settlements.channelId, input.channelId) : undefined;
  const rows = await tx
    .select({
      id: settlements.id,
      externalId: settlements.externalId,
      startAt: settlements.startAt,
      endAt: settlements.endAt,
      depositDate: settlements.depositDate,
      total: settlements.total,
      currency: settlements.currency,
      marketplace: settlements.marketplace,
      channelName: salesChannels.name,
      orderCount: settlements.orderCount,
      balanced: settlements.balanced,
      source: settlements.source,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
    })
    .from(settlements)
    .leftJoin(salesChannels, eq(salesChannels.id, settlements.channelId))
    .leftJoin(journalEntries, postedEntry)
    .where(where)
    .orderBy(desc(settlements.endAt), desc(settlements.externalId))
    .limit(input.limit)
    .offset(input.offset);
  const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(settlements).where(where);
  return {
    rows: rows.map((r) => ({ ...r, total: String(r.total) })),
    count: count?.n ?? 0,
  };
}

/** One settlement with its amounts, largest first. */
export async function getSettlement(tx: Transaction, id: string) {
  const [row] = await tx
    .select({
      settlement: settlements,
      channelName: salesChannels.name,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
    })
    .from(settlements)
    .leftJoin(salesChannels, eq(salesChannels.id, settlements.channelId))
    .leftJoin(journalEntries, postedEntry)
    .where(eq(settlements.id, id));
  if (!row) return null;
  const lines = await tx
    .select()
    .from(settlementLines)
    .where(eq(settlementLines.settlementId, id))
    .orderBy(sql`abs(${settlementLines.amount}) desc`, asc(settlementLines.amountDescription));
  return {
    ...row.settlement,
    total: String(row.settlement.total),
    channelName: row.channelName,
    entryId: row.entryId,
    entryNumber: row.entryNumber,
    lines: lines.map((l) => ({ ...l, amount: String(l.amount) })),
  };
}

// --- Posting ------------------------------------------------------------------------------

/** The account chosen for each kind of settlement line. */
export async function getSettlementAccounts(tx: Transaction): Promise<SettlementAccounts> {
  const rows = await tx.select().from(settlementAccounts);
  return Object.fromEntries(
    rows
      .filter((r) => (SETTLEMENT_ACCOUNT_KEYS as string[]).includes(r.key))
      .map((r) => [r.key, r.accountId]),
  ) as SettlementAccounts;
}

export async function getSettlementSettings(tx: Transaction) {
  const [row] = await tx.select().from(settlementSettings).limit(1);
  return { postFrom: row?.postFrom ?? null };
}

/** Saves the accounts (all of them: kinds left out are cleared) and the date posting starts. */
export async function saveSettlementSetup(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    accounts: SettlementAccounts;
    postFrom: string;
  },
) {
  await tx.delete(settlementAccounts);
  const rows = Object.entries(input.accounts).filter(
    (e): e is [SettlementAccountKey, string] => typeof e[1] === "string" && e[1] !== "",
  );
  if (rows.length) {
    await tx
      .insert(settlementAccounts)
      .values(rows.map(([key, accountId]) => ({ organizationId: input.orgId, key, accountId })));
  }
  const values = { postFrom: input.postFrom, updatedBy: input.userId, updatedAt: new Date() };
  await tx
    .insert(settlementSettings)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: settlementSettings.organizationId, set: values });
}

/**
 * Posts a settlement as one journal entry (core `buildSettlementEntry`), dated `date` (the
 * period's last day), and links them. Fails, in plain words, when it's already in the books,
 * isn't in the main currency, or the accounts aren't chosen.
 */
export async function postSettlement(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    settlementId: string;
    baseCurrency: string;
    date: string;
    /** e.g. "Amazon.ca settlement 123 · Jun 5 – Jul 17, 2026". */
    memo: string;
  },
) {
  const [s] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, input.settlementId))
    .for("update");
  if (!s) throw new LedgerError("This settlement no longer exists.");
  if (s.journalEntryId) {
    const [entry] = await tx
      .select({ reversed: journalEntries.reversedByEntryId })
      .from(journalEntries)
      .where(eq(journalEntries.id, s.journalEntryId));
    if (entry && !entry.reversed) throw new LedgerError("This settlement is in the books already.");
  }
  if (s.currency !== input.baseCurrency) {
    throw new LedgerError(
      `This settlement is in ${s.currency}. Posting settlements in another currency than ${input.baseCurrency} comes later.`,
    );
  }
  const lines = await tx
    .select()
    .from(settlementLines)
    .where(eq(settlementLines.settlementId, s.id));
  const built = buildSettlementEntry({
    total: String(s.total),
    lines: lines.map((l) => ({ ...l, amount: String(l.amount) })),
    accounts: await getSettlementAccounts(tx),
  });
  if (!built.ok) throw new LedgerError(built.error);
  const all = await tx.select().from(accounts);
  const ledger = new Map<string, LedgerAccount>(
    all.map((a) => [
      a.id,
      { id: a.id, name: a.name, currency: a.currency, isArchived: a.isArchived },
    ]),
  );
  const prepared = prepareJournalEntry(
    {
      currency: s.currency,
      baseCurrency: input.baseCurrency,
      lines: built.lines.map((l) =>
        l.amount.startsWith("-")
          ? { accountId: l.accountId, description: l.description, credit: l.amount.slice(1) }
          : { accountId: l.accountId, description: l.description, debit: l.amount },
      ),
    },
    ledger,
  );
  if (!prepared.ok) {
    const first =
      prepared.errors.form ??
      Object.values(prepared.errors.lines ?? {})[0] ??
      "It doesn't balance.";
    throw new LedgerError(`The settlement couldn't be posted: ${first}`);
  }
  const entry = await postJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: input.date,
    reference: s.externalId,
    memo: input.memo,
    source: "settlement",
    sourceId: s.id,
    entry: prepared.entry,
  });
  await tx.update(settlements).set({ journalEntryId: entry.id }).where(eq(settlements.id, s.id));
  return { ...entry, label: formatEntryNumber(entry.entryNumber) };
}

/** Takes a settlement out of the books: its entry is reversed (on the same day). */
export async function unpostSettlement(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string },
) {
  const [s] = await tx
    .select({ entryId: settlements.journalEntryId })
    .from(settlements)
    .where(eq(settlements.id, input.settlementId))
    .for("update");
  if (!s?.entryId) throw new LedgerError("This settlement isn't in the books.");
  const [entry] = await tx
    .select({ date: journalEntries.date, reversed: journalEntries.reversedByEntryId })
    .from(journalEntries)
    .where(eq(journalEntries.id, s.entryId));
  if (entry && !entry.reversed) {
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: s.entryId,
      date: entry.date,
    });
  }
  await tx
    .update(settlements)
    .set({ journalEntryId: null })
    .where(eq(settlements.id, input.settlementId));
}

/** Settlements not in the books whose period ends on or after `from`, oldest first. */
export async function settlementsToPost(tx: Transaction, input: { from: string; limit: number }) {
  return tx
    .select({ id: settlements.id })
    .from(settlements)
    .leftJoin(journalEntries, postedEntry)
    .where(
      and(
        isNull(journalEntries.id),
        eq(settlements.balanced, true),
        sql`${settlements.endAt} >= ${input.from}::date`,
      ),
    )
    .orderBy(asc(settlements.endAt))
    .limit(input.limit);
}

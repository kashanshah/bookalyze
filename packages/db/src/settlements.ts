import type { Settlement } from "@bookalyze/core";
import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import { salesChannels, settlementLines, settlements } from "./schema/commerce";

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
    })
    .from(settlements)
    .leftJoin(salesChannels, eq(salesChannels.id, settlements.channelId))
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
    .select({ settlement: settlements, channelName: salesChannels.name })
    .from(settlements)
    .leftJoin(salesChannels, eq(salesChannels.id, settlements.channelId))
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
    lines: lines.map((l) => ({ ...l, amount: String(l.amount) })),
  };
}

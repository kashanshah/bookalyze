import type { MarketplaceParticipation } from "@bookalyze/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { disconnectConnection } from "./banking";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import { salesChannels } from "./schema/commerce";

/**
 * Commerce: marketplace connections (Amazon Seller Central through the SP-API) and the sales
 * channels they feed. Connections share the `connections` table and credential vault with banks.
 */

/** Amazon connections, newest first, with their channels. No secrets. */
export async function listAmazonConnections(tx: Transaction) {
  const rows = await tx
    .select({
      id: connections.id,
      name: connections.name,
      status: connections.status,
      settings: connections.settings,
      lastSyncedAt: connections.lastSyncedAt,
      lastError: connections.lastError,
      createdAt: connections.createdAt,
    })
    .from(connections)
    .where(eq(connections.provider, "amazon_sp"))
    .orderBy(asc(connections.createdAt));
  const channels = await tx.select().from(salesChannels).orderBy(asc(salesChannels.name));
  return rows.map((c) => ({ ...c, channels: channels.filter((ch) => ch.connectionId === c.id) }));
}

/**
 * Records the marketplaces an Amazon account sells in as channels. New ones start switched on
 * when the seller participates there; existing ones keep the choice made before.
 */
export async function saveAmazonChannels(
  tx: Transaction,
  input: { orgId: string; connectionId: string; marketplaces: readonly MarketplaceParticipation[] },
) {
  for (const m of input.marketplaces) {
    await tx
      .insert(salesChannels)
      .values({
        organizationId: input.orgId,
        connectionId: input.connectionId,
        kind: "amazon",
        name: m.name,
        marketplaceId: m.marketplaceId,
        country: m.country || null,
        currency: m.currency,
        isActive: m.participating,
      })
      .onConflictDoUpdate({
        target: [salesChannels.connectionId, salesChannels.marketplaceId],
        set: { name: sql`excluded.name`, currency: sql`excluded.currency` },
      });
  }
}

export async function setChannelActive(tx: Transaction, channelId: string, isActive: boolean) {
  const [row] = await tx
    .update(salesChannels)
    .set({ isActive })
    .where(eq(salesChannels.id, channelId))
    .returning();
  return row ?? null;
}

/** Active channels, for syncing orders. */
export async function activeChannels(tx: Transaction, connectionId: string) {
  return tx
    .select()
    .from(salesChannels)
    .where(and(eq(salesChannels.connectionId, connectionId), eq(salesChannels.isActive, true)));
}

/** The company's Amazon connection for a region, if it ever had one (even disconnected). */
export async function findAmazonConnection(tx: Transaction, region: string) {
  const [row] = await tx
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.provider, "amazon_sp"),
        sql`${connections.settings}->>'region' = ${region}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Forgets the credentials and switches the channels off; their history stays. */
export async function disconnectAmazon(tx: Transaction, connectionId: string) {
  await disconnectConnection(tx, connectionId);
  await tx
    .update(salesChannels)
    .set({ isActive: false })
    .where(eq(salesChannels.connectionId, connectionId));
}

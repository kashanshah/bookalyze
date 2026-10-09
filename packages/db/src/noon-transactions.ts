import { NOON_MARKETPLACES, type NoonTransaction } from "@bookalyze/core";
import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import { noonTransactions, salesChannels } from "./schema/commerce";

/**
 * Noon's item-level transactions (phase 4c, slice 3b). Run inside `withOrg()`. Rows come from
 * Noon's export API or an uploaded file and go to the Noon channel of their currency (added,
 * switched on, when the company doesn't have it yet: Noon says it sells there). The same row
 * again only refreshes its amounts.
 */

/** The company's Noon channel for each currency, adding missing ones Noon's rows call for. */
export async function noonChannelsForCurrencies(
  tx: Transaction,
  input: { orgId: string; currencies: readonly string[]; connectionId: string | null },
): Promise<{ byCurrency: Map<string, string>; added: string[] }> {
  const existing = await tx
    .select({ id: salesChannels.id, currency: salesChannels.currency })
    .from(salesChannels)
    .where(eq(salesChannels.kind, "noon"));
  const byCurrency = new Map(existing.map((c) => [c.currency, c.id]));
  const added: string[] = [];
  for (const currency of new Set(input.currencies)) {
    if (byCurrency.has(currency)) continue;
    const marketplace = NOON_MARKETPLACES.find((m) => m.currency === currency);
    if (!marketplace) continue;
    const [row] = await tx
      .insert(salesChannels)
      .values({
        organizationId: input.orgId,
        connectionId: input.connectionId,
        kind: "noon",
        name: marketplace.name,
        marketplaceId: marketplace.id,
        country: marketplace.country,
        currency: marketplace.currency,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning({ id: salesChannels.id });
    if (row) {
      byCurrency.set(currency, row.id);
      added.push(marketplace.name);
    }
  }
  return { byCurrency, added };
}

export type NoonImportResult = {
  added: number;
  updated: number;
  /** Rows in a currency no Noon country uses. */
  unknownCurrency: number;
  /** Noon countries added because rows came in for them. */
  channelsAdded: string[];
};

/** Saves rows: new ones added, ones already in get their amounts refreshed. */
export async function importNoonTransactions(
  tx: Transaction,
  input: {
    orgId: string;
    rows: readonly NoonTransaction[];
    source: "api" | "upload";
    connectionId: string | null;
  },
): Promise<NoonImportResult> {
  const { byCurrency, added: channelsAdded } = await noonChannelsForCurrencies(tx, {
    orgId: input.orgId,
    currencies: input.rows.map((r) => r.currency),
    connectionId: input.connectionId,
  });
  let added = 0;
  let updated = 0;
  let unknownCurrency = 0;
  const known = input.rows.filter((r) => {
    if (byCurrency.has(r.currency)) return true;
    unknownCurrency++;
    return false;
  });
  for (let i = 0; i < known.length; i += 500) {
    const chunk = known.slice(i, i + 500);
    const saved = await tx
      .insert(noonTransactions)
      .values(
        chunk.map((r) => ({
          organizationId: input.orgId,
          channelId: byCurrency.get(r.currency) ?? "",
          key: r.key,
          contract: r.contract,
          referenceNr: r.referenceNr,
          orderNr: r.orderNr,
          itemNr: r.itemNr,
          orderDate: r.orderDate,
          transactionDate: r.transactionDate,
          title: r.title,
          sku: r.sku,
          partnerSku: r.partnerSku,
          transactionType: r.transactionType,
          currency: r.currency,
          ...r.amounts,
          total: r.total,
          balanced: r.balanced,
          source: input.source,
        })),
      )
      .onConflictDoUpdate({
        target: [noonTransactions.organizationId, noonTransactions.channelId, noonTransactions.key],
        set: {
          netProceeds: sql`excluded.net_proceeds`,
          referralFee: sql`excluded.referral_fee`,
          fulfilmentFee: sql`excluded.fulfilment_fee`,
          shippingCredits: sql`excluded.shipping_credits`,
          otherOrderFees: sql`excluded.other_order_fees`,
          orderSubsidies: sql`excluded.order_subsidies`,
          nonOrderFees: sql`excluded.non_order_fees`,
          nonOrderSubsidies: sql`excluded.non_order_subsidies`,
          others: sql`excluded.others`,
          total: sql`excluded.total`,
          balanced: sql`excluded.balanced`,
          updatedAt: sql`now()`,
        },
      })
      // xmax = 0 only for rows this statement inserted.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const r of saved) {
      if (r.inserted) added++;
      else updated++;
    }
  }
  return { added, updated, unknownCurrency, channelsAdded };
}

/** The transaction types Noon uses, per channel, most frequent first, with their total. */
export async function noonTransactionTypes(tx: Transaction) {
  return tx
    .select({
      channelId: noonTransactions.channelId,
      transactionType: noonTransactions.transactionType,
      rows: sql<number>`count(*)::int`,
      total: sql<string>`sum(${noonTransactions.total})::text`,
    })
    .from(noonTransactions)
    .groupBy(noonTransactions.channelId, noonTransactions.transactionType)
    .orderBy(sql`3 desc`);
}

/** Where bringing in Noon's transactions has got to (kept on the connection; nothing secret). */
export type NoonTransactionsSync = {
  /** Days through this one are in. */
  through: string | null;
  /** An export asked of Noon and not downloaded yet. */
  pending: { exportCode: string; from: string; to: string } | null;
  /** When the last few weeks were last read again (late fees). */
  refreshedAt: string | null;
};

export function noonSyncState(settings: Record<string, unknown>): NoonTransactionsSync {
  const raw = settings.transactions;
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const p =
    s.pending && typeof s.pending === "object" ? (s.pending as Record<string, unknown>) : null;
  return {
    through: typeof s.through === "string" ? s.through : null,
    pending:
      p &&
      typeof p.exportCode === "string" &&
      typeof p.from === "string" &&
      typeof p.to === "string"
        ? { exportCode: p.exportCode, from: p.from, to: p.to }
        : null,
    refreshedAt: typeof s.refreshedAt === "string" ? s.refreshedAt : null,
  };
}

export async function saveNoonSyncState(
  tx: Transaction,
  connectionId: string,
  state: NoonTransactionsSync,
) {
  await tx
    .update(connections)
    .set({
      settings: sql`${connections.settings} || jsonb_build_object('transactions', ${JSON.stringify(state)}::jsonb)`,
    })
    .where(and(eq(connections.id, connectionId), eq(connections.provider, "noon")));
}

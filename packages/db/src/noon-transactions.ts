import { NOON_MARKETPLACES, type NoonTransaction, noonOrders } from "@bookalyze/core";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import { noonTransactions, orderItems, orders, salesChannels } from "./schema/commerce";

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
  // The orders these rows belong to (all of them, the first time).
  const hasOrders = await tx
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(eq(salesChannels.kind, "noon"))
    .limit(1);
  const orderNrs = [...new Set(known.map((r) => r.orderNr).filter((n): n is string => !!n))];
  if (!hasOrders.length || orderNrs.length) {
    await refreshNoonOrders(tx, {
      orgId: input.orgId,
      orderNrs: hasOrders.length ? orderNrs : undefined,
    });
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

/**
 * Where a Noon export sync is, kept on the connection: `transactions` (the transaction view) or
 * `ledger` (the FBN inventory ledger).
 */
export type NoonSyncKey = "transactions" | "ledger";

export function noonSyncState(
  settings: Record<string, unknown>,
  key: NoonSyncKey = "transactions",
): NoonTransactionsSync {
  const raw = settings[key];
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
  key: NoonSyncKey = "transactions",
) {
  await tx
    .update(connections)
    .set({
      settings: sql`${connections.settings} || jsonb_build_object(${key}::text, ${JSON.stringify(state)}::jsonb)`,
    })
    .where(and(eq(connections.id, connectionId), eq(connections.provider, "noon")));
}

/**
 * Makes (or remakes) Noon orders from the transaction rows (core `noonOrders`): an order per
 * order number in its country, an item per item number, returns as the refunded amount. Shipped
 * by Noon unless the country says the seller ships (FBP). Items are in at once, so nothing waits
 * on Amazon for them. `orderNrs` limits it to those orders. Returns how many orders were saved.
 */
export async function refreshNoonOrders(
  tx: Transaction,
  input: { orgId: string; orderNrs?: readonly string[] },
): Promise<number> {
  const channels = await tx
    .select({ id: salesChannels.id, fulfilment: salesChannels.fulfilment })
    .from(salesChannels)
    .where(eq(salesChannels.kind, "noon"));
  const select = (nrs?: readonly string[]) =>
    tx
      .select({
        channelId: noonTransactions.channelId,
        orderNr: noonTransactions.orderNr,
        itemNr: noonTransactions.itemNr,
        orderDate: noonTransactions.orderDate,
        transactionDate: noonTransactions.transactionDate,
        transactionType: noonTransactions.transactionType,
        sku: noonTransactions.sku,
        partnerSku: noonTransactions.partnerSku,
        title: noonTransactions.title,
        currency: noonTransactions.currency,
        netProceeds: sql<string>`${noonTransactions.netProceeds}::text`,
      })
      .from(noonTransactions)
      .where(
        and(
          isNotNull(noonTransactions.orderNr),
          nrs ? inArray(noonTransactions.orderNr, [...nrs]) : undefined,
        ),
      );
  const rows = [];
  if (input.orderNrs) {
    for (let i = 0; i < input.orderNrs.length; i += 1000) {
      rows.push(...(await select(input.orderNrs.slice(i, i + 1000))));
    }
  } else {
    rows.push(...(await select()));
  }
  let saved = 0;
  for (const channel of channels) {
    const built = noonOrders(rows.filter((r) => r.channelId === channel.id));
    for (let i = 0; i < built.length; i += 500) {
      const chunk = built.slice(i, i + 500);
      const now = new Date();
      const ids = await tx
        .insert(orders)
        .values(
          chunk.map((o) => ({
            organizationId: input.orgId,
            channelId: channel.id,
            externalId: o.orderNr,
            // Midday UTC, so the order date stays the same day in any time zone near it.
            purchasedAt: new Date(`${o.purchasedOn}T12:00:00Z`),
            lastUpdatedAt: now,
            status: "Shipped",
            fulfillment:
              channel.fulfilment === "seller" ? ("merchant" as const) : ("amazon" as const),
            currency: o.currency,
            total: o.total,
            itemsShipped: o.items.length,
            itemsUnshipped: 0,
            refunded: o.refunded,
            itemsSyncedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [orders.channelId, orders.externalId],
          set: {
            purchasedAt: sql`excluded.purchased_at`,
            lastUpdatedAt: sql`excluded.last_updated_at`,
            fulfillment: sql`excluded.fulfillment`,
            currency: sql`excluded.currency`,
            total: sql`excluded.total`,
            itemsShipped: sql`excluded.items_shipped`,
            refunded: sql`excluded.refunded`,
            itemsSyncedAt: sql`excluded.items_synced_at`,
          },
        })
        .returning({ id: orders.id, externalId: orders.externalId });
      const idOf = new Map(ids.map((r) => [r.externalId, r.id]));
      await tx.delete(orderItems).where(inArray(orderItems.orderId, [...idOf.values()]));
      const items = chunk.flatMap((o) =>
        o.items.map((item) => ({
          organizationId: input.orgId,
          orderId: idOf.get(o.orderNr) ?? "",
          externalId: item.itemNr,
          sku: item.sku,
          title: item.title,
          quantityOrdered: 1,
          quantityShipped: 1,
          itemPrice: item.price,
        })),
      );
      for (let j = 0; j < items.length; j += 1000) {
        await tx.insert(orderItems).values(items.slice(j, j + 1000));
      }
      saved += ids.length;
    }
  }
  return saved;
}

import {
  type AmazonOrder,
  type AmazonOrderItem,
  type AmazonRefund,
  type BuyerClaim,
  type FulfilmentMode,
  formatDecimal,
  type MarketplaceParticipation,
  type NoonMarketplace,
  parseDecimal,
} from "@bookalyze/core";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { disconnectConnection } from "./banking";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import { orderItems, orderRefunds, orders, salesChannels } from "./schema/commerce";

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
 * when the seller participates there; existing ones keep the choice made before, unless
 * `reset` (reconnecting after a disconnect, which switched them all off).
 */
export async function saveAmazonChannels(
  tx: Transaction,
  input: {
    orgId: string;
    connectionId: string;
    marketplaces: readonly MarketplaceParticipation[];
    reset?: boolean;
  },
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
        set: {
          name: sql`excluded.name`,
          currency: sql`excluded.currency`,
          ...(input.reset ? { isActive: sql`excluded.is_active` } : {}),
        },
      });
  }
}

// --- Noon -------------------------------------------------------------------------------------

/** The company's Noon channels (one per country), by name. */
export async function listNoonChannels(tx: Transaction) {
  return tx
    .select()
    .from(salesChannels)
    .where(eq(salesChannels.kind, "noon"))
    .orderBy(asc(salesChannels.name));
}

/**
 * Adds a Noon country as a channel, switched on. Adding one the company already has switches it
 * back on and keeps its history. Returns the channel and whether it was new.
 */
export async function addNoonChannel(
  tx: Transaction,
  input: {
    orgId: string;
    marketplace: Pick<NoonMarketplace, "id" | "name" | "country" | "currency">;
    fulfilment: FulfilmentMode;
  },
) {
  const [existing] = await tx
    .select({ id: salesChannels.id })
    .from(salesChannels)
    .where(
      and(eq(salesChannels.kind, "noon"), eq(salesChannels.marketplaceId, input.marketplace.id)),
    );
  if (existing) {
    const [row] = await tx
      .update(salesChannels)
      .set({ isActive: true, fulfilment: input.fulfilment })
      .where(eq(salesChannels.id, existing.id))
      .returning();
    if (!row) throw new Error("The Noon channel couldn't be updated.");
    return { channel: row, created: false };
  }
  const live = await getNoonConnection(tx);
  const [row] = await tx
    .insert(salesChannels)
    .values({
      organizationId: input.orgId,
      connectionId: live && live.status !== "disconnected" ? live.id : null,
      kind: "noon",
      name: input.marketplace.name,
      marketplaceId: input.marketplace.id,
      country: input.marketplace.country,
      currency: input.marketplace.currency,
      fulfilment: input.fulfilment,
      isActive: true,
    })
    .returning();
  if (!row) throw new Error("The Noon channel couldn't be added.");
  return { channel: row, created: true };
}

/** The company's Noon connection (the live one first, else the latest), without its secret. */
export async function getNoonConnection(tx: Transaction) {
  const [row] = await tx
    .select({
      id: connections.id,
      name: connections.name,
      status: connections.status,
      settings: connections.settings,
      hasSecret: sql<boolean>`${connections.secret} is not null`,
      lastSyncedAt: connections.lastSyncedAt,
      lastError: connections.lastError,
    })
    .from(connections)
    .where(eq(connections.provider, "noon"))
    .orderBy(sql`${connections.status} = 'disconnected'`, desc(connections.createdAt))
    .limit(1);
  return row ?? null;
}

/** Puts every Noon channel of the company on this connection (one Noon account per company). */
export async function attachNoonChannels(tx: Transaction, connectionId: string) {
  await tx.update(salesChannels).set({ connectionId }).where(eq(salesChannels.kind, "noon"));
}

/**
 * Forgets Noon's key. Its channels come off the connection and stay as they are (switched on,
 * with everything brought in), as if they'd been added by hand.
 */
export async function disconnectNoon(tx: Transaction, connectionId: string) {
  await disconnectConnection(tx, connectionId);
  await tx
    .update(salesChannels)
    .set({ connectionId: null })
    .where(and(eq(salesChannels.kind, "noon"), eq(salesChannels.connectionId, connectionId)));
}

/** Who ships a channel's orders. */
export async function setChannelFulfilment(
  tx: Transaction,
  channelId: string,
  fulfilment: FulfilmentMode,
) {
  const [row] = await tx
    .update(salesChannels)
    .set({ fulfilment })
    .where(eq(salesChannels.id, channelId))
    .returning();
  return row ?? null;
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

/**
 * The company's Amazon connections for a region, connected first, then newest. Each brings the
 * number of its latest order: a new seller account that can see that order is the same account.
 */
export async function amazonConnectionsForRegion(tx: Transaction, region: string) {
  return tx
    .select({
      id: connections.id,
      status: connections.status,
      latestOrderId: sql<
        string | null
      >`(select o.external_id from orders o join sales_channels ch on ch.id = o.channel_id where ch.connection_id = connections.id order by o.purchased_at desc, o.external_id desc limit 1)`,
    })
    .from(connections)
    .where(
      and(
        eq(connections.provider, "amazon_sp"),
        sql`${connections.settings}->>'region' = ${region}`,
      ),
    )
    .orderBy(sql`${connections.status} = 'disconnected'`, desc(connections.createdAt));
}

/** Forgets the credentials and switches the channels off; their history stays. */
export async function disconnectAmazon(tx: Transaction, connectionId: string) {
  await disconnectConnection(tx, connectionId);
  await tx
    .update(salesChannels)
    .set({ isActive: false })
    .where(eq(salesChannels.connectionId, connectionId));
}

// --- orders ----------------------------------------------------------------------------------

/** A channel with its connection (credentials sealed), for syncing. */
export async function getChannelForSync(tx: Transaction, channelId: string) {
  const [row] = await tx
    .select({ channel: salesChannels, connection: connections })
    .from(salesChannels)
    .innerJoin(connections, eq(connections.id, salesChannels.connectionId))
    .where(eq(salesChannels.id, channelId));
  return row ?? null;
}

/**
 * Starts bringing orders in from `from` (YYYY-MM-DD). Moving the date earlier reads everything
 * again from there; moving it later only stops older orders coming in (those already in stay).
 */
export async function startOrderSync(tx: Transaction, channelIds: readonly string[], from: string) {
  if (!channelIds.length) return;
  await tx
    .update(salesChannels)
    .set({
      ordersFrom: from,
      ordersSyncedThrough: sql`case when ${salesChannels.ordersFrom} is null or ${salesChannels.ordersFrom} > ${from}::date then null else ${salesChannels.ordersSyncedThrough} end`,
      ordersNextToken: null,
      ordersWindowEnd: null,
      refundsSyncedThrough: sql`case when ${salesChannels.ordersFrom} is null or ${salesChannels.ordersFrom} > ${from}::date then null else ${salesChannels.refundsSyncedThrough} end`,
      refundsNextToken: null,
      refundsWindowEnd: null,
    })
    .where(inArray(salesChannels.id, [...channelIds]));
}

/** Where the orders query got to: mid-way (a page token) or done up to `syncedThrough`. */
export async function saveOrderCursor(
  tx: Transaction,
  channelId: string,
  cursor: { nextToken: string; windowEnd: Date } | { nextToken: null; syncedThrough: Date | null },
) {
  await tx
    .update(salesChannels)
    .set(
      cursor.nextToken !== null
        ? { ordersNextToken: cursor.nextToken, ordersWindowEnd: cursor.windowEnd }
        : {
            ordersNextToken: null,
            ordersWindowEnd: null,
            ordersSyncedThrough: cursor.syncedThrough,
          },
    )
    .where(eq(salesChannels.id, channelId));
}

/**
 * Saves orders as the marketplace reports them: new ones are added, changed ones updated (an
 * older copy never overwrites a newer one). A change of status or total means the items are
 * fetched again. Orders placed before the channel's start date are left out. Returns how many
 * were added or changed.
 */
export async function upsertOrders(
  tx: Transaction,
  input: { orgId: string; channelId: string; from: string; orders: readonly AmazonOrder[] },
): Promise<number> {
  const start = new Date(`${input.from}T00:00:00Z`).getTime();
  const rows = input.orders.filter((o) => new Date(o.purchasedAt).getTime() >= start);
  if (!rows.length) return 0;
  const saved = await tx
    .insert(orders)
    .values(
      rows.map((o) => ({
        organizationId: input.orgId,
        channelId: input.channelId,
        externalId: o.orderId,
        purchasedAt: new Date(o.purchasedAt),
        lastUpdatedAt: new Date(o.lastUpdatedAt),
        status: o.status,
        fulfillment: o.fulfillment,
        currency: o.currency,
        total: o.total,
        itemsShipped: o.itemsShipped,
        itemsUnshipped: o.itemsUnshipped,
        shipCountry: o.shipCountry,
        shipRegion: o.shipRegion,
        isBusiness: o.isBusiness,
        isPrime: o.isPrime,
        isReplacement: o.isReplacement,
        replacedOrderId: o.replacedOrderId ?? null,
        earliestDelivery: o.earliestDelivery,
        latestDelivery: o.latestDelivery,
      })),
    )
    .onConflictDoUpdate({
      target: [orders.channelId, orders.externalId],
      set: {
        lastUpdatedAt: sql`excluded.last_updated_at`,
        status: sql`excluded.status`,
        fulfillment: sql`excluded.fulfillment`,
        currency: sql`excluded.currency`,
        total: sql`excluded.total`,
        itemsShipped: sql`excluded.items_shipped`,
        itemsUnshipped: sql`excluded.items_unshipped`,
        shipCountry: sql`excluded.ship_country`,
        shipRegion: sql`excluded.ship_region`,
        isBusiness: sql`excluded.is_business`,
        isPrime: sql`excluded.is_prime`,
        isReplacement: sql`excluded.is_replacement`,
        replacedOrderId: sql`excluded.replaced_order_id`,
        earliestDelivery: sql`excluded.earliest_delivery`,
        latestDelivery: sql`excluded.latest_delivery`,
        itemsSyncedAt: sql`case when ${orders.status} is distinct from excluded.status or ${orders.total} is distinct from excluded.total then null else ${orders.itemsSyncedAt} end`,
        updatedAt: sql`now()`,
      },
      // A newer copy, or the same one carrying the replaced order's number (read before it was kept).
      setWhere: sql`${orders.lastUpdatedAt} < excluded.last_updated_at or (${orders.replacedOrderId} is null and excluded.replaced_order_id is not null)`,
    })
    .returning({ id: orders.id });
  return saved.length;
}

/** Where the refunds query got to: mid-way (a page token) or done up to `syncedThrough`. */
export async function saveRefundCursor(
  tx: Transaction,
  channelId: string,
  cursor: { nextToken: string; windowEnd: Date } | { nextToken: null; syncedThrough: Date | null },
) {
  await tx
    .update(salesChannels)
    .set(
      cursor.nextToken !== null
        ? { refundsNextToken: cursor.nextToken, refundsWindowEnd: cursor.windowEnd }
        : {
            refundsNextToken: null,
            refundsWindowEnd: null,
            refundsSyncedThrough: cursor.syncedThrough,
          },
    )
    .where(eq(salesChannels.id, channelId));
}

/**
 * Keeps the refunds of this channel's orders (others, and orders from before the start date, are
 * left out) and updates each order's refunded total. Reading the same events again changes
 * nothing. Returns how many refunds were new.
 */
export async function saveRefunds(
  tx: Transaction,
  input: { orgId: string; channelId: string; refunds: readonly AmazonRefund[] },
): Promise<number> {
  if (!input.refunds.length) return 0;
  const ids = [...new Set(input.refunds.map((r) => r.orderId))];
  const found = await tx
    .select({ id: orders.id, externalId: orders.externalId })
    .from(orders)
    .where(and(eq(orders.channelId, input.channelId), inArray(orders.externalId, ids)));
  const byExternal = new Map(found.map((o) => [o.externalId, o.id]));
  const rows = input.refunds.flatMap((r) => {
    const orderId = byExternal.get(r.orderId);
    return orderId
      ? [
          {
            organizationId: input.orgId,
            orderId,
            externalId: r.adjustmentId,
            postedAt: new Date(r.postedAt),
            sku: r.sku,
            quantity: r.quantity,
            amount: r.amount,
            currency: r.currency?.slice(0, 3) ?? null,
          },
        ]
      : [];
  });
  if (!rows.length) return 0;
  const added = await tx
    .insert(orderRefunds)
    .values(rows)
    .onConflictDoNothing({ target: [orderRefunds.orderId, orderRefunds.externalId] })
    .returning({ id: orderRefunds.id });
  const touched = [...new Set(rows.map((r) => r.orderId))];
  await tx
    .update(orders)
    .set({
      refunded: sql`(select sum(r.amount) from ${orderRefunds} r where r.order_id = ${orders.id})`,
      lastRefundAt: sql`(select max(r.posted_at) from ${orderRefunds} r where r.order_id = ${orders.id})`,
    })
    .where(inArray(orders.id, touched));
  return added.length;
}

/**
 * Keeps what one order's own financial events say (read when it's looked at, or before a review
 * request): its refunds (as `saveRefunds`) and any A-to-z claim or chargeback.
 */
export async function saveOrderFinance(
  tx: Transaction,
  input: {
    orgId: string;
    channelId: string;
    orderId: string;
    refunds: readonly AmazonRefund[];
    claim: BuyerClaim | null;
  },
) {
  await saveRefunds(tx, { orgId: input.orgId, channelId: input.channelId, refunds: input.refunds });
  await tx
    .update(orders)
    .set({ buyerClaim: input.claim, financeCheckedAt: new Date() })
    .where(eq(orders.id, input.orderId));
}

const pricedFilter = sql`${orders.status} not in ('Pending', 'PendingAvailability')`;

/** Orders whose items haven't been fetched (priced orders only), oldest first. */
export async function ordersNeedingItems(tx: Transaction, channelId: string, limit: number) {
  return tx
    .select({ id: orders.id, externalId: orders.externalId })
    .from(orders)
    .where(and(eq(orders.channelId, channelId), isNull(orders.itemsSyncedAt), pricedFilter))
    .orderBy(asc(orders.purchasedAt))
    .limit(limit);
}

export async function countOrdersNeedingItems(tx: Transaction, channelIds?: readonly string[]) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        isNull(orders.itemsSyncedAt),
        pricedFilter,
        channelIds ? inArray(orders.channelId, [...channelIds]) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** Replaces an order's items with what the marketplace reports now. */
export async function saveOrderItems(
  tx: Transaction,
  input: { orgId: string; orderId: string; items: readonly AmazonOrderItem[] },
) {
  // The background job and "Bring in new orders" can save the same order at once: the row lock
  // makes the second wait, so its delete sees the first one's items.
  await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId)).for("update");
  await tx.delete(orderItems).where(eq(orderItems.orderId, input.orderId));
  if (input.items.length) {
    await tx.insert(orderItems).values(
      input.items.map((i) => ({
        organizationId: input.orgId,
        orderId: input.orderId,
        externalId: i.itemId,
        asin: i.asin || null,
        sku: i.sku,
        title: i.title,
        quantityOrdered: i.quantityOrdered,
        quantityShipped: i.quantityShipped,
        itemPrice: i.itemPrice,
        itemTax: i.itemTax,
        shippingPrice: i.shippingPrice,
        shippingTax: i.shippingTax,
        promotionDiscount: i.promotionDiscount,
      })),
    );
  }
  await tx.update(orders).set({ itemsSyncedAt: new Date() }).where(eq(orders.id, input.orderId));
}

export type OrderFilters = {
  channelId?: string | null;
  statuses?: readonly string[] | null;
  /** Only orders with money given back. */
  refunded?: boolean;
  /** Order number, SKU, ASIN or product title. */
  search?: string | null;
  /** Purchase dates (YYYY-MM-DD) in the company's timezone. */
  from?: string | null;
  to?: string | null;
  timezone: string;
};

/**
 * Orders of marketplaces still connected. A disconnected account's orders (or a different seller
 * account's, after new credentials were saved for the region) stay in but aren't shown. Channels
 * without a connection (Noon, brought in by upload) always show.
 */
const connectedOrder = sql`exists (select 1 from sales_channels ch left join connections c on c.id = ch.connection_id where ch.id = orders.channel_id and (ch.connection_id is null or c.status <> 'disconnected'))`;

function orderWhere(f: OrderFilters) {
  const day = sql`(${orders.purchasedAt} at time zone ${f.timezone})::date`;
  const like = f.search ? `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return and(
    connectedOrder,
    f.channelId ? eq(orders.channelId, f.channelId) : undefined,
    f.statuses?.length ? inArray(orders.status, [...f.statuses]) : undefined,
    f.refunded ? sql`${orders.refunded} > 0` : undefined,
    f.from ? sql`${day} >= ${f.from}::date` : undefined,
    f.to ? sql`${day} <= ${f.to}::date` : undefined,
    like
      ? or(
          ilike(orders.externalId, like),
          sql`exists (select 1 from ${orderItems} i where i.order_id = ${orders.id} and (i.sku ilike ${like} or i.asin ilike ${like} or i.title ilike ${like}))`,
        )
      : undefined,
  );
}

/** Orders, newest first, with their channel and a summary of what was bought. */
export async function listOrders(
  tx: Transaction,
  filters: OrderFilters & { limit: number; offset: number },
) {
  const where = orderWhere(filters);
  const rows = await tx
    .select({
      id: orders.id,
      externalId: orders.externalId,
      channelName: salesChannels.name,
      channelKind: salesChannels.kind,
      purchasedAt: orders.purchasedAt,
      status: orders.status,
      fulfillment: orders.fulfillment,
      currency: sql<string>`coalesce(${orders.currency}, ${salesChannels.currency})`,
      total: orders.total,
      refunded: orders.refunded,
      reviewEligible: orders.reviewEligible,
      buyerClaim: orders.buyerClaim,
      isReplacement: orders.isReplacement,
      /** Another order (a replacement) was sent for this one. */
      replaced: sql<boolean>`exists (select 1 from ${orders} r where r.channel_id = ${orders.channelId} and r.replaced_order_id = ${orders.externalId})`,
      reviewStatus: sql<
        string | null
      >`(select r.status from review_requests r where r.order_id = ${orders.id})`,
      units: sql<number>`(${orders.itemsShipped} + ${orders.itemsUnshipped})::int`,
      itemsSynced: sql<boolean>`${orders.itemsSyncedAt} is not null`,
      firstTitle: sql<
        string | null
      >`(select coalesce(i.title, i.sku) from ${orderItems} i where i.order_id = ${orders.id} order by i.item_price desc nulls last, i.external_id limit 1)`,
      lines: sql<number>`(select count(*)::int from ${orderItems} i where i.order_id = ${orders.id})`,
    })
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(where)
    .orderBy(desc(orders.purchasedAt), desc(orders.externalId))
    .limit(filters.limit)
    .offset(filters.offset);
  // Per marketplace (and currency, should a marketplace ever mix them), biggest first.
  const totals = await tx
    .select({
      channelId: salesChannels.id,
      channelName: salesChannels.name,
      currency: sql<string>`coalesce(${orders.currency}, ${salesChannels.currency})`,
      orders: sql<number>`count(*)::int`,
      sold: sql<number>`(count(*) filter (where ${orders.status} not in ('Canceled', 'Unfulfillable')))::int`,
      units: sql<number>`coalesce(sum(${orders.itemsShipped} + ${orders.itemsUnshipped}) filter (where ${orders.status} not in ('Canceled', 'Unfulfillable')), 0)::int`,
      sales: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} not in ('Canceled', 'Unfulfillable')), 0)::text`,
      refunded: sql<string>`coalesce(sum(${orders.refunded}), 0)::text`,
    })
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(where)
    .groupBy(salesChannels.id, salesChannels.name, sql`3`)
    .orderBy(sql`4 desc`, salesChannels.name);
  return {
    rows: rows.map((r) => ({
      ...r,
      total: r.total === null ? null : String(r.total),
      refunded: r.refunded === null ? null : String(r.refunded),
    })),
    count: totals.reduce((n, t) => n + t.orders, 0),
    totals,
  };
}

/** One order with its channel and items (null when its marketplace isn't connected). */
export async function getOrder(tx: Transaction, orderId: string) {
  const [row] = await tx
    .select({ order: orders, channel: salesChannels })
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(and(eq(orders.id, orderId), connectedOrder));
  if (!row) return null;
  const items = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(desc(orderItems.itemPrice), asc(orderItems.externalId));
  const refunds = await tx
    .select()
    .from(orderRefunds)
    .where(eq(orderRefunds.orderId, orderId))
    .orderBy(asc(orderRefunds.postedAt), asc(orderRefunds.externalId));
  // Replacements both ways: the order this one replaces, and replacements sent for it.
  const replaces = row.order.replacedOrderId
    ? ((
        await tx
          .select({ id: orders.id, externalId: orders.externalId })
          .from(orders)
          .where(
            and(
              eq(orders.channelId, row.order.channelId),
              eq(orders.externalId, row.order.replacedOrderId),
            ),
          )
      )[0] ?? { id: null, externalId: row.order.replacedOrderId })
    : null;
  const replacedBy = await tx
    .select({ id: orders.id, externalId: orders.externalId })
    .from(orders)
    .where(
      and(
        eq(orders.channelId, row.order.channelId),
        eq(orders.replacedOrderId, row.order.externalId),
      ),
    )
    .orderBy(asc(orders.purchasedAt));
  return { ...row, items, refunds, replaces, replacedBy };
}

/**
 * Orders placed each day, per currency, for the home page. Canceled orders are left out, matching
 * the Orders screen. A pending order still counts, even when Amazon hasn't priced it yet.
 */
export async function orderGlance(
  tx: Transaction,
  input: { timezone: string; from: string; to: string },
) {
  const day = sql`(${orders.purchasedAt} at time zone ${input.timezone})::date`;
  const placed = sql`${orders.status} not in ('Canceled', 'Unfulfillable')`;
  const rows = await tx
    .select({
      date: sql<string>`${day}::text`,
      currency: sql<string>`coalesce(${orders.currency}, ${salesChannels.currency})`,
      orders: sql<number>`count(*)::int`,
      units: sql<number>`coalesce(sum(${orders.itemsShipped} + ${orders.itemsUnshipped}), 0)::int`,
      sales: sql<string>`coalesce(sum(${orders.total}), 0)::text`,
    })
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(
      and(
        connectedOrder,
        placed,
        sql`${day} >= ${input.from}::date`,
        sql`${day} <= ${input.to}::date`,
      ),
    )
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`);
  return rows.map((row) => ({ ...row, sales: formatDecimal(parseDecimal(String(row.sales))) }));
}

/** Whether the company has any orders from connected marketplaces (for the empty state). */
export async function hasOrders(tx: Transaction) {
  const [row] = await tx.select({ id: orders.id }).from(orders).where(connectedOrder).limit(1);
  return Boolean(row);
}

/** Channels orders are being brought in for (switched on, started, connection has credentials). */
export async function orderSyncChannels(tx: Transaction) {
  return tx
    .select({
      id: salesChannels.id,
      name: salesChannels.name,
      ordersFrom: salesChannels.ordersFrom,
      ordersSyncedThrough: salesChannels.ordersSyncedThrough,
    })
    .from(salesChannels)
    .innerJoin(connections, eq(connections.id, salesChannels.connectionId))
    .where(
      and(
        eq(salesChannels.isActive, true),
        isNotNull(salesChannels.ordersFrom),
        isNotNull(connections.secret),
        ne(connections.status, "disconnected"),
      ),
    )
    .orderBy(asc(salesChannels.name));
}

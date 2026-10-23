import type { AmazonListing } from "@bookalyze/core";
import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import {
  listingPrices,
  type PriceChangeStatus,
  priceChanges,
  salesChannels,
} from "./schema/commerce";

/**
 * Prices of the company's Amazon listings (Inventory → Prices): the price Amazon last reported for
 * each linked SKU, and the changes sent from here. Amazon holds the price; these rows are what we
 * last saw and what we asked for.
 */

export type PricedSku = {
  channelId: string;
  channelName: string;
  marketplaceId: string;
  connectionId: string;
  /** The marketplace's currency (a listing's own, once Amazon reports it). */
  currency: string;
  sku: string;
  /** What one listing holds: each product and how many of it (a pack or a bundle). */
  components: { productId: string; productName: string; units: number }[];
  price: string | null;
  priceCurrency: string | null;
  status: string[];
  problems: string[];
  found: boolean | null;
  checkedAt: Date | null;
  lastChange: {
    id: string;
    newPrice: string;
    status: PriceChangeStatus;
    message: string | null;
    createdAt: Date;
  } | null;
};

/** Linked SKUs on Amazon marketplaces that are switched on and still connected, by name. */
export async function pricedSkus(tx: Transaction): Promise<PricedSku[]> {
  const rows = await tx.execute<{
    channel_id: string;
    channel_name: string;
    marketplace_id: string;
    connection_id: string;
    currency: string;
    sku: string;
    components: { productId: string; productName: string; units: number }[];
    price: string | null;
    price_currency: string | null;
    status: string[] | null;
    problems: string[] | null;
    found: boolean | null;
    checked_at: string | null;
    change_id: string | null;
    change_price: string | null;
    change_status: PriceChangeStatus | null;
    change_message: string | null;
    change_at: string | null;
  }>(sql`
    select sc.id as channel_id, sc.name as channel_name, sc.marketplace_id, sc.connection_id,
      sc.currency, ps.sku,
      json_agg(json_build_object('productId', p.id, 'productName', p.name, 'units', ps.units)
        order by p.name) as components,
      lp.price::text as price, lp.currency as price_currency, lp.status, lp.problems, lp.found,
      lp.checked_at, pc.id as change_id, pc.new_price::text as change_price,
      pc.status as change_status, pc.message as change_message, pc.created_at as change_at
    from product_skus ps
    join products p on p.id = ps.product_id
    join sales_channels sc on sc.id = ps.channel_id
    join connections c on c.id = sc.connection_id
    left join listing_prices lp on lp.channel_id = sc.id and lp.sku = ps.sku
    left join lateral (
      select * from price_changes x where x.channel_id = sc.id and x.sku = ps.sku
      order by x.created_at desc limit 1
    ) pc on true
    where sc.kind = 'amazon' and sc.is_active and sc.marketplace_id is not null
      and c.provider = 'amazon_sp' and c.status <> 'disconnected'
    group by sc.id, sc.name, sc.marketplace_id, sc.connection_id, sc.currency, ps.sku,
      lp.id, pc.id, pc.new_price, pc.status, pc.message, pc.created_at
    order by sc.name, min(lower(p.name)), ps.sku`);
  return rows.rows.map((r) => ({
    channelId: r.channel_id,
    channelName: r.channel_name,
    marketplaceId: r.marketplace_id,
    connectionId: r.connection_id,
    currency: r.price_currency ?? r.currency,
    sku: r.sku,
    components: r.components.map((c) => ({ ...c, units: Number(c.units) })),
    price: r.price,
    priceCurrency: r.price_currency,
    status: r.status ?? [],
    problems: r.problems ?? [],
    found: r.found,
    checkedAt: r.checked_at ? new Date(r.checked_at) : null,
    lastChange:
      r.change_id && r.change_price && r.change_status && r.change_at
        ? {
            id: r.change_id,
            newPrice: r.change_price,
            status: r.change_status,
            message: r.change_message,
            createdAt: new Date(r.change_at),
          }
        : null,
  }));
}

/** Keeps what Amazon reported for a SKU (or that it didn't know it). */
export async function saveListingPrice(
  tx: Transaction,
  input: { orgId: string; channelId: string; sku: string; listing: AmazonListing | null },
) {
  const l = input.listing;
  const values = {
    price: l?.price ?? null,
    currency: l?.currency ?? null,
    productType: l?.productType ?? null,
    status: l?.status ?? [],
    offer: l?.offer ?? null,
    problems: (l?.issues ?? []).filter((i) => i.severity === "ERROR").map((i) => i.message),
    found: Boolean(l),
    checkedAt: new Date(),
  };
  await tx
    .insert(listingPrices)
    .values({ organizationId: input.orgId, channelId: input.channelId, sku: input.sku, ...values })
    .onConflictDoUpdate({
      target: [listingPrices.organizationId, listingPrices.channelId, listingPrices.sku],
      set: values,
    });
}

/**
 * Keeps Amazon's fee estimate for a listing at a price (its referral fee and the whole), on the
 * listing's price row: what Profit by product estimates a product's fees from when too few of its
 * orders are settled.
 */
export async function saveFeeEstimate(
  tx: Transaction,
  input: { channelId: string; sku: string; price: string; referral: string; total: string },
) {
  await tx
    .update(listingPrices)
    .set({
      feesPrice: input.price,
      feesReferral: input.referral,
      feesTotal: input.total,
      feesCheckedAt: new Date(),
    })
    .where(and(eq(listingPrices.channelId, input.channelId), eq(listingPrices.sku, input.sku)));
}

/** Amazon's last fee estimate for each listing that has one, in the listing's currency. */
export async function listingFeeEstimates(tx: Transaction) {
  const rows = await tx
    .select({
      channelId: listingPrices.channelId,
      sku: listingPrices.sku,
      currency: listingPrices.currency,
      price: listingPrices.feesPrice,
      referral: listingPrices.feesReferral,
      total: listingPrices.feesTotal,
      checkedAt: listingPrices.feesCheckedAt,
    })
    .from(listingPrices)
    .where(and(isNotNull(listingPrices.feesTotal), isNotNull(listingPrices.feesPrice)));
  return rows.map((r) => ({
    channelId: r.channelId,
    sku: r.sku,
    currency: r.currency,
    price: String(r.price),
    referral: String(r.referral ?? "0"),
    total: String(r.total),
    checkedAt: r.checkedAt,
  }));
}

/** Records a change sent to Amazon. */
export async function recordPriceChange(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    channelId: string;
    sku: string;
    currency: string;
    oldPrice: string | null;
    newPrice: string;
    status: PriceChangeStatus;
    submissionId: string | null;
    message: string | null;
  },
) {
  const [row] = await tx
    .insert(priceChanges)
    .values({
      organizationId: input.orgId,
      channelId: input.channelId,
      sku: input.sku,
      currency: input.currency,
      oldPrice: input.oldPrice,
      newPrice: input.newPrice,
      status: input.status,
      submissionId: input.submissionId,
      message: input.message,
      createdBy: input.userId,
    })
    .returning();
  if (!row) throw new Error("The price change wasn't saved.");
  return row;
}

/** Changes Amazon accepted that aren't seen on the listing yet, last read before `before`. */
export async function pendingPriceChanges(tx: Transaction, before: Date) {
  return tx
    .select({
      id: priceChanges.id,
      channelId: priceChanges.channelId,
      sku: priceChanges.sku,
      newPrice: priceChanges.newPrice,
      createdAt: priceChanges.createdAt,
      marketplaceId: salesChannels.marketplaceId,
      connectionId: salesChannels.connectionId,
    })
    .from(priceChanges)
    .innerJoin(salesChannels, eq(salesChannels.id, priceChanges.channelId))
    .where(
      and(
        eq(priceChanges.status, "sent"),
        sql`coalesce(${priceChanges.checkedAt}, ${priceChanges.createdAt}) < ${before.toISOString()}`,
      ),
    )
    .orderBy(priceChanges.createdAt)
    .limit(50);
}

/** Marks a change applied, or notes when its listing was last read. */
export async function markPriceChange(
  tx: Transaction,
  id: string,
  status: PriceChangeStatus,
  message: string | null = null,
) {
  await tx
    .update(priceChanges)
    .set({ status, message, checkedAt: new Date() })
    .where(eq(priceChanges.id, id));
}

/** Changes still "sent" a day later: Amazon took them, but the listing never showed the price. */
export async function expireStalePriceChanges(tx: Transaction, before: Date) {
  await tx
    .update(priceChanges)
    .set({
      status: "refused",
      message:
        "Amazon accepted the change but the listing still shows another price. Check it in Seller Central.",
      checkedAt: new Date(),
    })
    .where(and(eq(priceChanges.status, "sent"), lt(priceChanges.createdAt, before)));
}

/** A connection's Amazon seller ID, once known (needed to read and change listings). */
export async function amazonSellerId(tx: Transaction, connectionId: string) {
  const [row] = await tx
    .select({ settings: connections.settings })
    .from(connections)
    .where(eq(connections.id, connectionId));
  const id = row?.settings.sellerId;
  return typeof id === "string" && id ? id : null;
}

export async function saveAmazonSellerId(tx: Transaction, connectionId: string, sellerId: string) {
  await tx
    .update(connections)
    .set({ settings: sql`${connections.settings} || ${JSON.stringify({ sellerId })}::jsonb` })
    .where(eq(connections.id, connectionId));
}

export type UnitCost = {
  /** Cost of one, in `currency` (the company's main currency). */
  cost: string;
  currency: string;
  /** "stock": the oldest lot with units left (the next to sell, FIFO); "last": none left, so the latest lot. */
  source: "stock" | "last";
};

/** What the next unit of each product costs: its oldest lot with stock left, else its latest. */
export async function nextUnitCosts(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, UnitCost>> {
  if (!productIds.length) return new Map();
  const rows = await tx.execute<{
    product_id: string;
    cost: string;
    currency: string;
    has_stock: boolean;
  }>(sql`
    select distinct on (l.product_id) l.product_id,
      round((l.product_cost + l.landed_cost) / l.quantity, 4)::text as cost, l.currency,
      (l.quantity > coalesce((select sum(c.quantity) from lot_consumptions c where c.lot_id = l.id), 0)) as has_stock
    from inventory_lots l
    where l.product_id in ${[...productIds]}
      and l.quantity > 0
    order by l.product_id,
      (l.quantity > coalesce((select sum(c.quantity) from lot_consumptions c where c.lot_id = l.id), 0)) desc,
      case when l.quantity > coalesce((select sum(c.quantity) from lot_consumptions c where c.lot_id = l.id), 0)
        then l.received_on end asc,
      l.received_on desc, l.created_at desc`);
  return new Map(
    rows.rows.map((r) => [
      r.product_id,
      { cost: r.cost, currency: r.currency, source: r.has_stock ? "stock" : "last" },
    ]),
  );
}

/** Recent changes for one SKU, newest first. */
export async function priceChangeHistory(tx: Transaction, channelId: string, sku: string) {
  return tx
    .select()
    .from(priceChanges)
    .where(and(eq(priceChanges.channelId, channelId), eq(priceChanges.sku, sku)))
    .orderBy(desc(priceChanges.createdAt))
    .limit(10);
}

import {
  type AdMetricRow,
  type AdType,
  convertUnits,
  formatDecimal,
  mergeAdRows,
  minorUnits,
  ORDER_STATUS_GROUPS,
  parseDecimal,
} from "@bookalyze/core";
import { and, between, desc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import {
  type AD_SOURCES,
  adMetrics,
  adReportRequests,
  channelSkus,
  salesChannels,
} from "./schema/commerce";

/**
 * Ad metrics per channel, day, campaign and SKU (docs/ADS.md), from any marketplace's ads
 * reports. Analytics only: nothing here posts. Run inside `withOrg()`.
 */

const cancelled = sql.raw(ORDER_STATUS_GROUPS.cancelled.map((s) => `'${s}'`).join(", "));

/**
 * Replaces a channel's rows of one source and ad type for the days `from`–`to` with `rows` (a
 * report's late changes and removed campaigns win). A row with an ASIN and no SKU takes the SKU
 * from the marketplace's own list. `rates` (day → main-currency units per unit) fills the
 * main-currency spend where a rate is known. Returns how many rows it kept.
 */
export async function replaceAdMetrics(
  tx: Transaction,
  input: {
    orgId: string;
    channelId: string;
    connectionId: string | null;
    source: (typeof AD_SOURCES)[number];
    accountRef: string;
    country: string | null;
    currency: string;
    adType: AdType;
    from: string;
    to: string;
    rows: readonly AdMetricRow[];
    baseCurrency: string;
    rates?: ReadonlyMap<string, string>;
  },
): Promise<number> {
  await tx
    .delete(adMetrics)
    .where(
      and(
        eq(adMetrics.channelId, input.channelId),
        eq(adMetrics.source, input.source),
        eq(adMetrics.adType, input.adType),
        between(adMetrics.date, input.from, input.to),
      ),
    );
  const rows = mergeAdRows(
    input.rows.filter(
      (r) => r.adType === input.adType && r.date >= input.from && r.date <= input.to,
    ),
  );
  if (!rows.length) return 0;

  const asins = [
    ...new Set(rows.filter((r) => !r.sku && r.listingRef).map((r) => r.listingRef as string)),
  ];
  const skuOf = new Map<string, string>();
  if (asins.length && input.adType !== "sponsored_brands") {
    const found = await tx
      .select({ sku: channelSkus.sku, asin: channelSkus.asin })
      .from(channelSkus)
      .where(and(eq(channelSkus.channelId, input.channelId), inArray(channelSkus.asin, asins)));
    for (const f of found) if (f.asin && !skuOf.has(f.asin)) skuOf.set(f.asin, f.sku);
  }

  const decimals = minorUnits(input.baseCurrency);
  const values = mergeAdRows(
    rows.map((r) => ({
      ...r,
      sku:
        r.sku ??
        (r.listingRef && input.adType !== "sponsored_brands"
          ? (skuOf.get(r.listingRef) ?? null)
          : null),
    })),
  ).map((r) => {
    const rate = input.currency === input.baseCurrency ? "1" : (input.rates?.get(r.date) ?? null);
    return {
      organizationId: input.orgId,
      channelId: input.channelId,
      connectionId: input.connectionId,
      source: input.source,
      accountRef: input.accountRef,
      country: input.country,
      date: r.date,
      adType: r.adType,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      sku: r.sku,
      listingRef: r.listingRef,
      currency: input.currency,
      spend: r.spend,
      fxRate: rate,
      spendBase: rate ? formatDecimal(convertUnits(parseDecimal(r.spend), rate, decimals)) : null,
      impressions: r.impressions,
      clicks: r.clicks,
      attributedSales: r.attributedSales,
      attributedOrders: r.attributedOrders,
      attributedUnits: r.attributedUnits,
      attributionWindow: r.attributionWindow,
    };
  });
  for (let i = 0; i < values.length; i += 500) {
    await tx.insert(adMetrics).values(values.slice(i, i + 500));
  }
  return values.length;
}

/** The company's Amazon Ads connections (one per Ads region), newest first. No secrets. */
export async function listAmazonAdsConnections(tx: Transaction) {
  return tx
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
    .where(eq(connections.provider, "amazon_ads"))
    .orderBy(desc(connections.createdAt));
}

/** The company's Walmart Connect advertisers (one per Walmart channel), newest first. */
export async function listWalmartAdsConnections(tx: Transaction) {
  return tx
    .select({
      id: connections.id,
      name: connections.name,
      status: connections.status,
      settings: connections.settings,
      lastSyncedAt: connections.lastSyncedAt,
      lastError: connections.lastError,
    })
    .from(connections)
    .where(eq(connections.provider, "walmart_ads"))
    .orderBy(desc(connections.createdAt));
}

/**
 * Which of a channel's listing IDs (Walmart's item IDs, Amazon's ASINs) already have a SKU in the
 * marketplace's list.
 */
export async function knownListingRefs(
  tx: Transaction,
  channelId: string,
  refs: readonly string[],
): Promise<Set<string>> {
  if (!refs.length) return new Set();
  const rows = await tx
    .select({ asin: channelSkus.asin })
    .from(channelSkus)
    .where(and(eq(channelSkus.channelId, channelId), inArray(channelSkus.asin, [...refs])));
  return new Set(rows.map((r) => r.asin ?? ""));
}

/**
 * Keeps a SKU's listing ID (Walmart's item ID) on the channel's list, adding the SKU when it isn't
 * there yet, so ads reports that only name the listing find the SKU.
 */
export async function saveChannelSkuListingRef(
  tx: Transaction,
  input: { orgId: string; channelId: string; sku: string; listingRef: string },
) {
  await tx
    .insert(channelSkus)
    .values({
      organizationId: input.orgId,
      channelId: input.channelId,
      sku: input.sku,
      asin: input.listingRef,
    })
    .onConflictDoUpdate({
      target: [channelSkus.channelId, channelSkus.sku],
      set: { asin: input.listingRef },
    });
}

/** Where one channel's ads of one type stand: the latest finished report, and one pending. */
export async function adReportState(tx: Transaction, channelId: string, adType: AdType) {
  const [done] = await tx
    .select({ dateTo: adReportRequests.dateTo, finishedAt: adReportRequests.finishedAt })
    .from(adReportRequests)
    .where(
      and(
        eq(adReportRequests.channelId, channelId),
        eq(adReportRequests.adType, adType),
        eq(adReportRequests.status, "done"),
      ),
    )
    .orderBy(desc(adReportRequests.dateTo), desc(adReportRequests.finishedAt))
    .limit(1);
  const pending = await tx
    .select()
    .from(adReportRequests)
    .where(
      and(
        eq(adReportRequests.channelId, channelId),
        eq(adReportRequests.adType, adType),
        eq(adReportRequests.status, "pending"),
      ),
    )
    .orderBy(adReportRequests.requestedAt);
  return { done: done ?? null, pending };
}

export async function recordAdReportRequest(
  tx: Transaction,
  input: {
    orgId: string;
    connectionId: string;
    channelId: string;
    accountRef: string;
    adType: AdType;
    from: string;
    to: string;
    reportId: string;
  },
) {
  const [row] = await tx
    .insert(adReportRequests)
    .values({
      organizationId: input.orgId,
      connectionId: input.connectionId,
      channelId: input.channelId,
      accountRef: input.accountRef,
      adType: input.adType,
      dateFrom: input.from,
      dateTo: input.to,
      reportId: input.reportId,
    })
    .returning();
  if (!row) throw new Error("Could not save the report request");
  return row;
}

export async function finishAdReportRequest(
  tx: Transaction,
  id: string,
  result: { status: "done" | "failed"; rows?: number; error?: string | null },
) {
  await tx
    .update(adReportRequests)
    .set({
      status: result.status,
      rows: result.rows ?? null,
      error: result.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(adReportRequests.id, id));
}

/** Each channel's ads brought in through (its latest finished report, of any ad type). */
export async function adsBroughtInThrough(tx: Transaction) {
  const rows = await tx
    .select({
      channelId: adReportRequests.channelId,
      through: sql<string>`max(${adReportRequests.dateTo})::text`,
      pending: sql<number>`count(*) filter (where ${adReportRequests.status} = 'pending')::int`,
      lastError: sql<
        string | null
      >`(array_agg(${adReportRequests.error} order by ${adReportRequests.requestedAt} desc) filter (where ${adReportRequests.status} = 'failed'))[1]`,
    })
    .from(adReportRequests)
    .where(sql`${adReportRequests.status} in ('done', 'pending', 'failed')`)
    .groupBy(adReportRequests.channelId);
  return new Map(rows.map((r) => [r.channelId, r]));
}

export type AdSums = {
  spend: string;
  /** Main-currency spend of the rows with a stored rate. */
  spendBase: string;
  /** Spend still without a main-currency value, by day (converted when read). */
  unconverted: { date: string; spend: string }[];
  sales: string;
  orders: number;
  units: number;
  clicks: number;
  impressions: number;
};

const emptySums = (): AdSums => ({
  spend: "0.0000",
  spendBase: "0.0000",
  unconverted: [],
  sales: "0.0000",
  orders: 0,
  units: 0,
  clicks: 0,
  impressions: 0,
});

/**
 * Ad metrics for a period (days as the ads account reports them), per channel: per SKU, the
 * spend tied to no SKU (Sponsored Brands), and the whole channel by ad type.
 */
export async function adMetricsForProfit(tx: Transaction, input: { from: string; to: string }) {
  const rows = await tx
    .select({
      channelId: adMetrics.channelId,
      currency: adMetrics.currency,
      sku: adMetrics.sku,
      adType: adMetrics.adType,
      date: sql<string>`${adMetrics.date}::text`,
      spend: sql<string>`sum(${adMetrics.spend})::text`,
      spendBase: sql<string>`coalesce(sum(${adMetrics.spendBase}), 0)::text`,
      unconverted: sql<string>`coalesce(sum(${adMetrics.spend}) filter (where ${adMetrics.spendBase} is null), 0)::text`,
      sales: sql<string>`sum(${adMetrics.attributedSales})::text`,
      orders: sql<number>`sum(${adMetrics.attributedOrders})::int`,
      units: sql<number>`sum(${adMetrics.attributedUnits})::int`,
      clicks: sql<number>`sum(${adMetrics.clicks})::int`,
      impressions: sql<number>`sum(${adMetrics.impressions})::int`,
    })
    .from(adMetrics)
    .where(between(adMetrics.date, input.from, input.to))
    .groupBy(
      adMetrics.channelId,
      adMetrics.currency,
      adMetrics.sku,
      adMetrics.adType,
      adMetrics.date,
    );

  const add = (sums: AdSums, r: (typeof rows)[number]) => {
    const plus = (a: string, b: string) => formatDecimal(parseDecimal(a) + parseDecimal(b));
    sums.spend = plus(sums.spend, r.spend);
    sums.spendBase = plus(sums.spendBase, r.spendBase);
    if (parseDecimal(r.unconverted) !== 0n) {
      const day = sums.unconverted.find((u) => u.date === r.date);
      if (day) day.spend = plus(day.spend, r.unconverted);
      else
        sums.unconverted.push({ date: r.date, spend: formatDecimal(parseDecimal(r.unconverted)) });
    }
    sums.sales = plus(sums.sales, r.sales);
    sums.orders += r.orders;
    sums.units += r.units;
    sums.clicks += r.clicks;
    sums.impressions += r.impressions;
  };

  const channels = new Map<
    string,
    {
      channelId: string;
      currency: string;
      total: AdSums;
      bySku: Map<string, AdSums>;
      unallocated: AdSums;
      byType: Map<AdType, AdSums>;
      days: Set<string>;
    }
  >();
  for (const r of rows) {
    const key = `${r.channelId}:${r.currency}`;
    let c = channels.get(key);
    if (!c) {
      c = {
        channelId: r.channelId,
        currency: r.currency,
        total: emptySums(),
        bySku: new Map(),
        unallocated: emptySums(),
        byType: new Map(),
        days: new Set(),
      };
      channels.set(key, c);
    }
    add(c.total, r);
    c.days.add(r.date);
    if (r.sku) {
      const s = c.bySku.get(r.sku) ?? emptySums();
      add(s, r);
      c.bySku.set(r.sku, s);
    } else add(c.unallocated, r);
    const t = c.byType.get(r.adType) ?? emptySums();
    add(t, r);
    c.byType.set(r.adType, t);
  }
  return [...channels.values()];
}

/**
 * What each SKU sold in the period on each channel: units, orders and sales (item price less
 * promotions) of order lines purchased in it (company time zone), cancelled orders left out;
 * with the products it's linked to (name and units per listing, for its cost).
 */
export async function skuSalesForProfit(
  tx: Transaction,
  input: { from: string; to: string; timezone: string; channelIds?: readonly string[] },
) {
  const channelFilter = input.channelIds?.length
    ? sql`and o.channel_id in ${[...input.channelIds]}`
    : sql``;
  const sales = await tx.execute<{
    channel_id: string;
    sku: string;
    title: string | null;
    asin: string | null;
    units: number;
    orders: number;
    sales: string;
  }>(sql`
    select o.channel_id, oi.sku, max(oi.title) as title, max(oi.asin) as asin,
      sum(oi.quantity_ordered)::int as units, count(distinct o.id)::int as orders,
      coalesce(sum(coalesce(oi.item_price, 0) - coalesce(oi.promotion_discount, 0)), 0)::text as sales
    from order_items oi
    join orders o on o.id = oi.order_id
    where oi.sku is not null and o.status not in (${cancelled})
      and (o.purchased_at at time zone ${input.timezone})::date between ${input.from}::date and ${input.to}::date
      ${channelFilter}
    group by o.channel_id, oi.sku`);
  const links = await tx.execute<{
    channel_id: string;
    sku: string;
    product_id: string;
    product_name: string;
    units: number;
  }>(sql`
    select ps.channel_id, ps.sku, ps.product_id, p.name as product_name, ps.units
    from product_skus ps join products p on p.id = ps.product_id`);
  const titles = await tx
    .select({ channelId: channelSkus.channelId, sku: channelSkus.sku, title: channelSkus.title })
    .from(channelSkus);
  const channelInfo = await tx
    .select({
      id: salesChannels.id,
      name: salesChannels.name,
      kind: salesChannels.kind,
      currency: salesChannels.currency,
      isActive: salesChannels.isActive,
    })
    .from(salesChannels);
  return {
    sales: sales.rows,
    links: links.rows,
    titles: new Map(titles.map((t) => [`${t.channelId}|${t.sku}`, t.title])),
    channels: channelInfo,
  };
}

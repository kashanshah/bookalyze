import "server-only";
import {
  type AccountCosts,
  type AdType,
  accountCosts,
  addDaysIso,
  type ChannelAdSummary,
  channelAdSummary,
  convertUnits,
  formatDecimal,
  type IsoDate,
  type KeepRateSource,
  listingCost,
  minorUnits,
  orderKeepRate,
  parseDecimal,
  type SkuPeriodInput,
  type SkuProfit,
  skuKeepRates,
  skuProfit,
  sortSkuProfits,
} from "@bookalyze/core";
import {
  adMetricsForProfit,
  adsBroughtInThrough,
  getSettlementAccounts,
  nextUnitCosts,
  salesAfter,
  schema,
  settledSkuLinesForProfit,
  skuSalesForProfit,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { inOrg } from "./accounting";
import { type ChannelTotals, channelTotals } from "./channel-totals";
import type { CommerceContext } from "./commerce";
import { suggestRate } from "./fx";

/**
 * Profit by product, after ads (docs/ADS.md §3 and §6): for each channel, each SKU's sales from its
 * orders, its share of what the marketplace leaves on its orders before ads (the keep rate: the
 * SKU's own settled orders', else the channel's), its product cost, and its ad spend from the ads
 * reports; plus the spend tied to no product and the account's own costs (storage, the selling
 * plan), each its own line. In each channel's own currency, with a summary of all of them in the
 * main currency.
 */

/** When a channel has no money in the period (a new channel), its keep rate comes from these days. */
const FALLBACK_DAYS = 90;

export type ChannelProductProfit = {
  channelId: string;
  name: string;
  kind: string;
  currency: string;
  isActive: boolean;
  /** The channel's rate on its orders. Null: no sales to learn the marketplace's fees from. */
  keepRate: string | null;
  /** "period", or "trailing" when it came from the 90 days before the period's end. */
  keepRateFrom: Exclude<KeepRateSource, "sku"> | null;
  /** Products with a rate of their own (enough settled units). */
  ownRates: number;
  rows: SkuProfit[];
  unallocated: { spend: string; sales: string };
  /** Storage, the selling plan and other costs on no order, in the period's settlements. */
  accountCosts: AccountCosts;
  /** The last day the period's settlements cover (Amazon), and the sales bought after it. */
  settledThrough: string | null;
  unsettledSales: string;
  summary: ChannelAdSummary;
  /** The books' advertising for the channel in the period (positive: a cost). */
  booksAdvertising: string;
  /** Ad spend by ad type, from the reports. */
  byType: { adType: AdType; spend: string; sales: string }[];
  /** The last day of ads brought in, and whether reports are being made. */
  adsThrough: string | null;
  adsPending: number;
  hasAds: boolean;
};

export type ProductProfit = {
  channels: ChannelProductProfit[];
  /** Every channel together, in the main currency (at the period's last day's rates). */
  all: {
    currency: string;
    sales: string;
    adSpend: string;
    profitAfterAds: string | null;
    lost: string;
    wasted: string;
    losing: number;
    costMissing: number;
    tacos: number | null;
    /** Channels left out of the totals: no exchange rate for the day. */
    unconverted: string[];
  };
};

export async function productProfit(
  ctx: CommerceContext,
  input: { from: string; to: string; channelId?: string | null },
): Promise<ProductProfit> {
  const { timezone, baseCurrency } = ctx.profile;
  const trailingFrom = addDaysIso(input.to as IsoDate, -(FALLBACK_DAYS - 1));
  const data = await inOrg(ctx, async (tx) => {
    const feeTax = (await getSettlementAccounts(tx)).feeTax;
    const [account] = feeTax
      ? await tx
          .select({ type: schema.accounts.type })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, feeTax))
      : [];
    const range = { from: input.from, to: input.to, timezone };
    const skus = await skuSalesForProfit(tx, range);
    const productIds = [...new Set(skus.links.map((l) => l.product_id))];
    return {
      feeTaxRecoverable: account?.type === "asset" || account?.type === "liability",
      totals: await channelTotals(tx, range),
      settled: await settledSkuLinesForProfit(tx, range),
      ads: await adMetricsForProfit(tx, { from: input.from, to: input.to }),
      through: await adsBroughtInThrough(tx),
      skus,
      unitCosts: await nextUnitCosts(tx, productIds),
    };
  });
  let trailing: Map<string, ChannelTotals> | null = null;
  const keepOf = async (channelId: string, promotionsInSales: boolean) => {
    const rateOf = (t: ChannelTotals | undefined) =>
      t
        ? orderKeepRate(t.orderTotals, {
            feeTaxRecoverable: data.feeTaxRecoverable,
            promotionsInSales,
          })
        : null;
    const now = rateOf(data.totals.get(channelId));
    if (now !== null) return { rate: now, from: "period" as const };
    trailing ??= await inOrg(ctx, (tx) =>
      channelTotals(tx, { from: trailingFrom, to: input.to, timezone }),
    );
    const before = rateOf(trailing.get(channelId));
    return before === null
      ? { rate: null, from: null }
      : { rate: before, from: "trailing" as const };
  };

  const channelIds = new Set<string>([
    ...data.skus.sales.map((s) => s.channel_id),
    ...data.ads.map((a) => a.channelId),
  ]);
  const rates = new Map<string, string | null>();
  const rateTo = async (currency: string) => {
    if (currency === baseCurrency) return "1";
    if (!rates.has(currency)) {
      rates.set(currency, (await suggestRate(baseCurrency, currency, input.to))?.rate ?? null);
    }
    return rates.get(currency) ?? null;
  };

  const channels: ChannelProductProfit[] = [];
  for (const channelId of channelIds) {
    if (input.channelId && channelId !== input.channelId) continue;
    const info = data.skus.channels.find((c) => c.id === channelId);
    if (!info) continue;
    const ads = data.ads.find((a) => a.channelId === channelId && a.currency === info.currency);
    // Order lines that take their promotions off (Amazon's, eBay's): the rates must too.
    const promotionsInSales = data.skus.sales.some(
      (s) => s.channel_id === channelId && parseDecimal(s.promotions) > 0n,
    );
    const keep = await keepOf(channelId, promotionsInSales);
    const own = skuKeepRates(
      data.settled.filter((l) => l.channelId === channelId),
      { feeTaxRecoverable: data.feeTaxRecoverable, promotionsInSales },
    );
    // Lots are in the main currency: the rate turns them into the channel's.
    const costRate = await rateTo(info.currency);

    const skus = new Map<string, SkuPeriodInput>();
    const blank = (sku: string): SkuPeriodInput => {
      const links = data.skus.links.filter((l) => l.channel_id === channelId && l.sku === sku);
      const cost = links.length
        ? listingCost({
            components: links.map((l) => ({
              productId: l.product_id,
              productName: l.product_name,
              units: l.units,
            })),
            unitCosts: data.unitCosts,
            currency: info.currency,
            rate: costRate,
          }).cost
        : null;
      return {
        sku,
        label: links.length
          ? links
              .map((l) => (l.units > 1 ? `${l.product_name} × ${l.units}` : l.product_name))
              .join(" + ")
          : (data.skus.titles.get(`${channelId}|${sku}`) ?? null),
        linked: links.length > 0,
        units: 0,
        orders: 0,
        sales: "0",
        unitCost: cost,
        adSpend: "0",
        adSales: "0",
        adOrders: 0,
        adUnits: 0,
        clicks: 0,
        impressions: 0,
      };
    };
    for (const s of data.skus.sales.filter((x) => x.channel_id === channelId)) {
      const row = skus.get(s.sku) ?? blank(s.sku);
      row.units += s.units;
      row.orders += s.orders;
      row.sales = s.sales;
      row.label ??= s.title;
      skus.set(s.sku, row);
    }
    for (const [sku, a] of ads?.bySku ?? []) {
      const row = skus.get(sku) ?? blank(sku);
      row.adSpend = a.spend;
      row.adSales = a.sales;
      row.adOrders = a.orders;
      row.adUnits = a.units;
      row.clicks = a.clicks;
      row.impressions = a.impressions;
      skus.set(sku, row);
    }
    const rows = sortSkuProfits(
      [...skus.values()].map((s) => {
        const mine = own.get(s.sku);
        return skuProfit(s, {
          keepRate: mine?.rate ?? keep.rate,
          keepRateSource: mine ? "sku" : keep.from,
          currency: info.currency,
        });
      }),
    ).filter((r) => r.verdict !== "no_activity");
    const channel = data.totals.get(channelId);
    const totals = channel?.totals;
    const account = accountCosts(channel?.accountLines ?? [], {
      feeTaxRecoverable: data.feeTaxRecoverable,
    });
    const settledThrough = channel?.settledThrough ?? null;
    const unsettledSales =
      settledThrough && settledThrough < input.to
        ? await inOrg(ctx, (tx) =>
            salesAfter(tx, { channelId, after: settledThrough, to: input.to, timezone }),
          )
        : "0";
    const through = data.through.get(channelId);
    const hasAds = Boolean(ads) || Boolean(through);
    const booksAdvertising = -(totals?.advertising ?? 0n);
    // Without ads reports, the books' advertising is the channel's ads, not split by product, so
    // the keep rate (which leaves it out) doesn't overstate the channel's profit.
    const unallocated = hasAds
      ? { spend: ads?.unallocated.spend ?? "0", sales: ads?.unallocated.sales ?? "0" }
      : { spend: formatDecimal(booksAdvertising > 0n ? booksAdvertising : 0n), sales: "0" };
    channels.push({
      channelId,
      name: info.name,
      kind: info.kind,
      currency: info.currency,
      isActive: info.isActive,
      keepRate: keep.rate,
      keepRateFrom: keep.from,
      ownRates: rows.filter((r) => r.keepRateSource === "sku").length,
      rows,
      unallocated,
      accountCosts: account,
      settledThrough,
      unsettledSales,
      summary: channelAdSummary(rows, unallocated, account.amount),
      booksAdvertising: formatDecimal(booksAdvertising),
      byType: [...(ads?.byType ?? [])].map(([adType, s]) => ({
        adType,
        spend: s.spend,
        sales: s.sales,
      })),
      adsThrough: through?.through ?? null,
      adsPending: through?.pending ?? 0,
      hasAds,
    });
  }
  channels.sort((a, b) => a.name.localeCompare(b.name));

  // Every channel in the main currency, at the period's last day's rate.
  const decimals = minorUnits(baseCurrency);
  const all = {
    currency: baseCurrency,
    sales: 0n,
    adSpend: 0n,
    profitAfterAds: null as bigint | null,
    lost: 0n,
    wasted: 0n,
    losing: 0,
    costMissing: 0,
    unconverted: [] as string[],
  };
  for (const c of channels) {
    all.losing += c.summary.losing;
    all.costMissing += c.summary.costMissing;
    const rate = await rateTo(c.currency);
    if (!rate) {
      all.unconverted.push(c.name);
      continue;
    }
    const base = (v: string) =>
      c.currency === baseCurrency ? parseDecimal(v) : convertUnits(parseDecimal(v), rate, decimals);
    all.sales += base(c.summary.sales);
    all.adSpend += base(c.summary.adSpend);
    all.lost += base(c.summary.lost);
    all.wasted += base(c.summary.wasted);
    if (c.summary.profitAfterAds !== null) {
      all.profitAfterAds = (all.profitAfterAds ?? 0n) + base(c.summary.profitAfterAds);
    }
  }
  return {
    channels,
    all: {
      currency: baseCurrency,
      sales: formatDecimal(all.sales),
      adSpend: formatDecimal(all.adSpend),
      profitAfterAds: all.profitAfterAds === null ? null : formatDecimal(all.profitAfterAds),
      lost: formatDecimal(all.lost),
      wasted: formatDecimal(all.wasted),
      losing: all.losing,
      costMissing: all.costMissing,
      tacos: all.sales > 0n ? Math.round(Number((all.adSpend * 10_000n) / all.sales)) / 100 : null,
      unconverted: all.unconverted,
    },
  };
}

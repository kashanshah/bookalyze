import "server-only";
import {
  addDaysIso,
  type ChannelPnl,
  channelProfit,
  channelSkuPnl,
  convertUnits,
  divRound,
  formatDecimal,
  type GroupTotals,
  type IsoDate,
  keepRate,
  minorUnits,
  parseDecimal,
  roundUnits,
  type SkuCostInput,
  type SkuPnl,
  type SkuPnlCounts,
  type SkuPnlEntry,
  summarizeSkuPnl,
  totalSkuPnl,
} from "@bookalyze/core";
import {
  adSpendByDay,
  adsBroughtInThrough,
  amazonSkuRows,
  type ChannelMoneyRow,
  ebaySkuMoneyRows,
  getSettlementAccounts,
  nextUnitCosts,
  noonSkuMoneyRows,
  postedUnitCosts,
  schema,
  settlementsWithoutSkuDetail,
  skuOrderLines,
  skuSalesForProfit,
  walmartSkuMoneyRows,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { nowIn } from "@/lib/dates";
import { inOrg } from "./accounting";
import { channelTotals } from "./channel-totals";
import type { CommerceContext } from "./commerce";
import { dayRates } from "./fx";

/**
 * Each SKU's exact profit and loss for a period (docs/ADS.md §6b; core `channelSkuPnl`): per
 * channel in its own currency, and every channel together in the main currency, each amount at
 * its own day's exchange rate.
 */

/** A channel with no money in the period estimates by its keep rate over these days. */
const FALLBACK_DAYS = 90;

export type ChannelSkuPnl = {
  channelId: string;
  name: string;
  kind: string;
  currency: string;
  isActive: boolean;
  mode: ChannelPnl["mode"];
  /** Nothing settled by product and no keep rate: its fees aren't known. */
  feesUnknown: boolean;
  rows: SkuPnl[];
  total: SkuPnl;
  /** Ads reports exist for it (else ad cost is "not connected yet"). */
  hasAds: boolean;
  adsThrough: string | null;
  /** Its settlements in the period whose amounts aren't kept by SKU yet. */
  missingDetail: number;
  /** Lines of a SKU left out: no exchange rate for their day (cost of goods, in another currency). */
  unconverted: number;
};

export type SkuProfitAndLoss = {
  currency: string;
  channels: ChannelSkuPnl[];
  /** Every channel (or the ones chosen), by SKU, in the main currency. */
  summary: { rows: SkuPnl[]; total: SkuPnl };
  /** Amounts left out of the summary: no exchange rate for their day. */
  unconverted: number;
  allocateBrands: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The channels chosen in the address: `?channel=<id>,<id>` (one or several; nothing: all). */
export function readChannelIds(value: string | string[] | null | undefined): string[] {
  const parts = (Array.isArray(value) ? value : [value ?? ""]).flatMap((v) => v.split(","));
  return [...new Set(parts.map((p) => p.trim()).filter((p) => UUID.test(p)))];
}

export async function skuProfitAndLoss(
  ctx: CommerceContext,
  input: {
    from: string;
    to: string;
    allocateBrands: boolean;
    /** The channels the summary adds up; empty or left out: every channel. */
    channelIds?: readonly string[];
  },
): Promise<SkuProfitAndLoss> {
  const inSummary = (channelId: string) =>
    !input.channelIds?.length || input.channelIds.includes(channelId);
  const { timezone, baseCurrency } = ctx.profile;
  const range = { from: input.from, to: input.to, timezone };
  const fromMonth = input.from.slice(0, 7);
  const toMonth = input.to.slice(0, 7);
  const data = await inOrg(ctx, async (tx) => {
    const feeTax = (await getSettlementAccounts(tx)).feeTax;
    const [account] = feeTax
      ? await tx
          .select({ type: schema.accounts.type })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, feeTax))
      : [];
    const info = await skuSalesForProfit(tx, range);
    const productIds = [...new Set(info.links.map((l) => l.product_id))];
    const rows: ChannelMoneyRow[] = [
      ...(await amazonSkuRows(tx, range)),
      ...(await noonSkuMoneyRows(tx, range)),
      ...(await ebaySkuMoneyRows(tx, range)),
      ...(await walmartSkuMoneyRows(tx, range)),
    ];
    return {
      feeTaxRecoverable: account?.type === "asset" || account?.type === "liability",
      lines: await skuOrderLines(tx, range),
      rows,
      info,
      totals: await channelTotals(tx, range),
      ads: await adSpendByDay(tx, input),
      through: await adsBroughtInThrough(tx),
      posted: await postedUnitCosts(tx, { fromMonth, toMonth }),
      nextCosts: await nextUnitCosts(tx, productIds),
      missing: await settlementsWithoutSkuDetail(tx, range),
    };
  });

  // Each day's rate for every currency needed, read once (Bank of Canada fetched when missing).
  const rateCache = new Map<string, Map<string, string>>();
  const ratesFor = async (quote: string) => {
    let rates = rateCache.get(quote);
    if (!rates) {
      rates = await dayRates(baseCurrency, quote, input.from, input.to);
      rateCache.set(quote, rates);
    }
    return rates;
  };
  const currencies = new Set<string>([
    ...data.info.channels.map((c) => c.currency),
    ...data.ads.map((a) => a.currency),
  ]);
  for (const c of currencies) await ratesFor(c);
  const rateOn = (quote: string, date: string) =>
    quote === baseCurrency ? "1" : (rateCache.get(quote)?.get(date) ?? null);
  /** `units` in `from` as `to`, at `date`'s rates (through the main currency), rounded once. */
  const convert = (units: bigint, from: string, to: string, date: string): bigint | null => {
    if (from === to) return units;
    let base = units;
    if (from !== baseCurrency) {
      const rate = rateOn(from, date);
      if (!rate) return null;
      base = convertUnits(units, rate, to === baseCurrency ? minorUnits(baseCurrency) : 4);
    }
    if (to === baseCurrency) return base;
    const rate = rateOn(to, date);
    if (!rate || parseDecimal(rate, 10) <= 0n) return null;
    return roundUnits(divRound(base * 10n ** 10n, parseDecimal(rate, 10)), minorUnits(to));
  };

  // Keep rates, for channels with nothing settled by product. Unlike Profit by product's, these
  // keep the account's own fees in: with nothing settled by product there are no rows to share
  // them from. Promotions come off the sales when the order lines take them off (Amazon's, eBay's).
  let trailing: Map<string, { currency: string; totals: GroupTotals }> | null = null;
  const rateOf = (t: { totals: GroupTotals } | undefined, promotionsInSales: boolean) => {
    if (!t) return null;
    const p = channelProfit(t.totals, { feeTaxRecoverable: data.feeTaxRecoverable });
    return keepRate({
      sales: formatDecimal(t.totals.sales),
      promotions: promotionsInSales ? p.groups.promotions : undefined,
      net: p.net,
      advertising: p.groups.advertising,
    });
  };
  const keepOf = async (channelId: string) => {
    const promotionsInSales = data.lines.some(
      (l) => l.channelId === channelId && parseDecimal(l.promotions) > 0n,
    );
    const now = rateOf(data.totals.get(channelId), promotionsInSales);
    if (now !== null) return now;
    trailing ??= await inOrg(ctx, (tx) =>
      channelTotals(tx, {
        from: addDaysIso(input.to as IsoDate, -(FALLBACK_DAYS - 1)),
        to: input.to,
        timezone,
      }),
    );
    return rateOf(trailing.get(channelId), promotionsInSales);
  };

  const linksOf = (channelId: string) => {
    const map = new Map<string, SkuCostInput>();
    for (const l of data.info.links) {
      if (l.channel_id !== channelId) continue;
      const found = map.get(l.sku) ?? { components: [] };
      found.components.push({ productId: l.product_id, units: l.units });
      map.set(l.sku, found);
    }
    return map;
  };
  const labelsOf = (channelId: string) => {
    const out = new Map<string, { label: string | null; linked: boolean }>();
    for (const l of data.info.links) {
      if (l.channel_id !== channelId) continue;
      const name = l.units > 1 ? `${l.product_name} × ${l.units}` : l.product_name;
      const found = out.get(l.sku);
      out.set(l.sku, { label: found?.label ? `${found.label} + ${name}` : name, linked: true });
    }
    for (const line of data.lines) {
      if (line.channelId !== channelId || out.has(line.sku)) continue;
      out.set(line.sku, {
        label: line.title ?? data.info.titles.get(`${channelId}|${line.sku}`) ?? null,
        linked: false,
      });
    }
    return out;
  };
  const today = nowIn(timezone).date;
  const nextCosts = new Map([...data.nextCosts].map(([id, c]) => [id, c.cost]));

  const channelIds = new Set<string>([
    ...data.lines.map((l) => l.channelId),
    ...data.rows.map((r) => r.channelId),
    ...data.ads.map((a) => a.channelId),
  ]);
  const channels: ChannelSkuPnl[] = [];
  const allEntries: SkuPnlEntry[] = [];
  const allCounts = new Map<string, SkuPnlCounts>();
  const allLabels = new Map<string, { label: string | null; linked: boolean }>();
  const allMissing = new Set<string>();
  const allUnknown = new Set<string>();
  for (const channelId of channelIds) {
    const info = data.info.channels.find((c) => c.id === channelId);
    if (!info) continue;
    const ads = data.ads.filter((a) => a.channelId === channelId && a.currency === info.currency);
    const through = data.through.get(channelId);
    const hasAds = ads.length > 0 || Boolean(through);
    const pnl = channelSkuPnl({
      currency: info.currency,
      costCurrency: baseCurrency,
      lines: data.lines.filter((l) => l.channelId === channelId),
      rows: data.rows.filter((r) => r.channelId === channelId),
      keepRate: await keepOf(channelId),
      feeTaxRecoverable: data.feeTaxRecoverable,
      hasAdsReports: hasAds,
      ads,
      allocateBrands: input.allocateBrands,
      links: linksOf(channelId),
      postedCosts: data.posted.get(channelId) ?? new Map(),
      nextCosts,
      today,
    });
    const labels = labelsOf(channelId);
    const unknown = pnl.feesUnknown ? new Set(pnl.counts.keys()) : new Set<string>();
    const rows = summarizeSkuPnl({
      entries: pnl.entries,
      counts: pnl.counts,
      currency: info.currency,
      convert: (e) => convert(parseDecimal(e.amount), e.currency, info.currency, e.date),
      labels,
      costMissing: pnl.costMissing,
      feesUnknown: unknown,
    }).filter(
      (r) => r.sku === "" || r.unitsSold || r.profit === null || parseDecimal(r.profit) !== 0n,
    );
    channels.push({
      channelId,
      name: info.name,
      kind: info.kind,
      currency: info.currency,
      isActive: info.isActive,
      mode: pnl.mode,
      feesUnknown: pnl.feesUnknown,
      rows,
      total: totalSkuPnl(rows, info.currency),
      hasAds,
      adsThrough: through?.through ?? null,
      missingDetail: data.missing.filter((m) => m.channelId === channelId).length,
      unconverted: rows.reduce((t, r) => t + r.unconverted, 0),
    });
    if (!inSummary(channelId)) continue;
    allEntries.push(...pnl.entries);
    for (const [sku, c] of pnl.counts) {
      const found = allCounts.get(sku) ?? {
        unitsSold: 0,
        unitsReturned: 0,
        orders: 0,
        settledUnits: 0,
      };
      found.unitsSold += c.unitsSold;
      found.unitsReturned += c.unitsReturned;
      found.orders += c.orders;
      found.settledUnits += c.settledUnits;
      allCounts.set(sku, found);
    }
    for (const [sku, l] of labels) if (!allLabels.get(sku)?.linked) allLabels.set(sku, l);
    for (const sku of pnl.costMissing) allMissing.add(sku);
    for (const sku of unknown) allUnknown.add(sku);
  }
  channels.sort((a, b) => a.name.localeCompare(b.name));

  const summaryRows = summarizeSkuPnl({
    entries: allEntries,
    counts: allCounts,
    currency: baseCurrency,
    convert: (e) => convert(parseDecimal(e.amount), e.currency, baseCurrency, e.date),
    labels: allLabels,
    costMissing: allMissing,
    feesUnknown: allUnknown,
  }).filter(
    (r) => r.sku === "" || r.unitsSold || r.profit === null || parseDecimal(r.profit) !== 0n,
  );
  return {
    currency: baseCurrency,
    channels,
    summary: { rows: summaryRows, total: totalSkuPnl(summaryRows, baseCurrency) },
    unconverted: summaryRows.reduce((t, r) => t + r.unconverted, 0),
    allocateBrands: input.allocateBrands,
  };
}

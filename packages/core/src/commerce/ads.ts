import { minorUnits } from "../currency";
import { divRound, formatDecimal, parseDecimal, roundUnits } from "../money";

/**
 * Advertising in profit, for any marketplace (docs/ADS.md): a channel's ad metrics per SKU next
 * to what the SKU sold, cost and left after the marketplace's fees, so each product's profit
 * after ads, its ACOS, TACOS and break-even ACOS can be read, and the products losing money found.
 * Analytics only: the books keep their own advertising lines.
 */

export const AD_TYPES = [
  "sponsored_products",
  "sponsored_brands",
  "sponsored_display",
  "promoted_listings",
  "other",
] as const;
export type AdType = (typeof AD_TYPES)[number];

export const AD_TYPE_LABELS: Record<AdType, string> = {
  sponsored_products: "Sponsored Products",
  sponsored_brands: "Sponsored Brands",
  sponsored_display: "Sponsored Display",
  promoted_listings: "Promoted Listings",
  other: "Other ads",
};

/** One row of ad metrics, as a source reports it (amounts as exact decimal strings). */
export type AdMetricRow = {
  date: string;
  adType: AdType;
  campaignId: string;
  campaignName: string | null;
  /** Null when the ad type has no per-SKU spend (Sponsored Brands). */
  sku: string | null;
  listingRef: string | null;
  spend: string;
  impressions: number;
  clicks: number;
  attributedSales: string;
  attributedOrders: number;
  attributedUnits: number;
  attributionWindow: string;
};

/**
 * Adds rows with the same day, ad type, campaign and SKU together (a SKU can be in several ad
 * groups of one campaign), so each key is stored once.
 */
export function mergeAdRows(rows: readonly AdMetricRow[]): AdMetricRow[] {
  const merged = new Map<string, AdMetricRow>();
  for (const r of rows) {
    const key = [r.date, r.adType, r.campaignId, r.sku ?? "\u0000"].join("|");
    const found = merged.get(key);
    if (!found) {
      merged.set(key, { ...r });
      continue;
    }
    found.spend = formatDecimal(parseDecimal(found.spend) + parseDecimal(r.spend));
    found.attributedSales = formatDecimal(
      parseDecimal(found.attributedSales) + parseDecimal(r.attributedSales),
    );
    found.impressions += r.impressions;
    found.clicks += r.clicks;
    found.attributedOrders += r.attributedOrders;
    found.attributedUnits += r.attributedUnits;
    found.listingRef ??= r.listingRef;
    found.campaignName ??= r.campaignName;
  }
  return [...merged.values()];
}

// --- Profit after ads --------------------------------------------------------------------------

/** What a SKU did in the period on one channel, in the channel's currency. */
export type SkuPeriodInput = {
  sku: string;
  /** The product's name (or names, for a bundle) when the SKU is linked. */
  label: string | null;
  linked: boolean;
  units: number;
  orders: number;
  /** Sales: item price less promotions. */
  sales: string;
  /** One listing unit's cost, or null when it isn't known (not linked, or no cost yet). */
  unitCost: string | null;
  adSpend: string;
  adSales: string;
  adOrders: number;
  adUnits: number;
  clicks: number;
  impressions: number;
};

export const AD_VERDICTS = [
  "losing",
  "ads_eat_profit",
  "ads_above_break_even",
  "ads_no_sales",
  "cost_missing",
  "healthy",
  "no_activity",
] as const;
export type AdVerdict = (typeof AD_VERDICTS)[number];

export const AD_VERDICT_LABELS: Record<AdVerdict, { label: string; hint: string }> = {
  losing: {
    label: "Losing money",
    hint: "It loses money before ads: its price doesn't cover the marketplace's fees and what it costs. Ads only make it worse.",
  },
  ads_eat_profit: {
    label: "Ads eat the profit",
    hint: "It makes money on its own, but its ad spend is more than that profit.",
  },
  ads_above_break_even: {
    label: "Ads cost more than they earn",
    hint: "Still profitable overall, but its ACOS is above its break-even ACOS: each sale from ads loses money, and its organic sales pay for it.",
  },
  ads_no_sales: {
    label: "Ads with no sales",
    hint: "Money spent on ads with no sales from them in the period.",
  },
  cost_missing: {
    label: "Cost missing",
    hint: "Link the SKU to a product with a cost (Products, and a purchase order or opening stock) to see its profit.",
  },
  healthy: {
    label: "Healthy",
    hint: "Profitable after its ads, and its ACOS is under its break-even ACOS.",
  },
  no_activity: { label: "No sales", hint: "No sales and no ad spend in the period." },
};

/** A ratio in percent with one decimal (e.g. 23.4), or null when the base is zero. */
function percent(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  return Number(divRound(numerator * 1000n, denominator)) / 10;
}

export type SkuProfit = {
  sku: string;
  label: string | null;
  linked: boolean;
  units: number;
  orders: number;
  sales: string;
  /** Sales ÷ units. */
  averagePrice: string | null;
  /** Sales × the channel's keep rate: what the marketplace leaves before ads. Null without one. */
  netBeforeAds: string | null;
  /** Units × unit cost; null when the cost isn't known. */
  productCost: string | null;
  profitBeforeAds: string | null;
  profitBeforeAdsPerUnit: string | null;
  adSpend: string;
  adSales: string;
  adOrders: number;
  adUnits: number;
  clicks: number;
  impressions: number;
  /** Ad spend ÷ ad sales. */
  acos: number | null;
  /** Ad spend ÷ all sales. */
  tacos: number | null;
  /** Ad sales ÷ ad spend. */
  roas: number | null;
  /** Profit before ads ÷ sales: the highest ACOS before its ad sales lose money. */
  breakEvenAcos: number | null;
  /** Sales not from ads, as a share of sales (at least 0). */
  organicShare: number | null;
  /** Ad spend ÷ clicks. */
  cpc: string | null;
  /** Ad orders ÷ clicks. */
  conversion: number | null;
  /** The most a click can cost before its sales lose money: profit per unit × conversion. */
  breakEvenCpc: string | null;
  profitAfterAds: string | null;
  profitAfterAdsPerUnit: string | null;
  /** Profit after ads ÷ sales. */
  marginAfterAds: number | null;
  verdict: AdVerdict;
};

/**
 * The channel's keep rate: what it leaves per unit of gross sales after fees, refunds,
 * promotions, reimbursements and other lines, but before advertising (the books' advertising is
 * added back, because ads are counted per SKU from the ads reports instead). As a decimal string
 * with 10 places, or null without sales.
 */
export function keepRate(input: { sales: string; net: string; advertising: string }) {
  const sales = parseDecimal(input.sales);
  if (sales <= 0n) return null;
  // Advertising is negative (a cost) in the totals; adding it back means subtracting it.
  const beforeAds = parseDecimal(input.net) - parseDecimal(input.advertising);
  return formatDecimal(divRound(beforeAds * 10n ** 10n, sales), 10);
}

/** One SKU's profit after ads, in the channel's currency (`currency` rounds the results). */
export function skuProfit(
  input: SkuPeriodInput,
  options: { keepRate: string | null; currency: string },
): SkuProfit {
  const decimals = minorUnits(options.currency);
  const round = (units: bigint) => formatDecimal(roundUnits(units, decimals));
  const sales = parseDecimal(input.sales);
  const spend = parseDecimal(input.adSpend);
  const adSales = parseDecimal(input.adSales);
  const units = BigInt(input.units);

  // Rounded to the currency first, so before ads, spend and after ads always add up.
  const net =
    options.keepRate === null
      ? null
      : roundUnits(divRound(sales * parseDecimal(options.keepRate, 10), 10n ** 10n), decimals);
  const cost =
    input.unitCost === null ? null : roundUnits(parseDecimal(input.unitCost) * units, decimals);
  const before = net === null || cost === null ? null : net - cost;
  const after = before === null ? null : before - spend;
  const perUnit = (v: bigint | null) =>
    v === null || units === 0n ? null : round(divRound(v, units));
  const conversion = input.clicks ? input.adOrders / input.clicks : null;
  const beforePerUnit = before === null || units === 0n ? null : divRound(before, units);

  const breakEvenAcos = before === null ? null : percent(before, sales);
  const acos = percent(spend, adSales);
  let verdict: AdVerdict;
  if (sales === 0n && spend === 0n) verdict = "no_activity";
  else if (before === null)
    verdict = spend > 0n && adSales === 0n ? "ads_no_sales" : "cost_missing";
  else if (before < 0n) verdict = "losing";
  else if (after !== null && after < 0n)
    verdict = spend > 0n && adSales === 0n ? "ads_no_sales" : "ads_eat_profit";
  else if (spend > 0n && adSales === 0n) verdict = "ads_no_sales";
  else if (acos !== null && breakEvenAcos !== null && acos > breakEvenAcos) {
    verdict = "ads_above_break_even";
  } else verdict = "healthy";

  return {
    sku: input.sku,
    label: input.label,
    linked: input.linked,
    units: input.units,
    orders: input.orders,
    sales: round(sales),
    averagePrice: units ? round(divRound(sales, units)) : null,
    netBeforeAds: net === null ? null : round(net),
    productCost: cost === null ? null : round(cost),
    profitBeforeAds: before === null ? null : round(before),
    profitBeforeAdsPerUnit: perUnit(before),
    adSpend: round(spend),
    adSales: round(adSales),
    adOrders: input.adOrders,
    adUnits: input.adUnits,
    clicks: input.clicks,
    impressions: input.impressions,
    acos,
    tacos: percent(spend, sales),
    roas: spend > 0n ? Number(divRound(adSales * 100n, spend)) / 100 : null,
    breakEvenAcos,
    organicShare: sales > 0n ? percent(sales > adSales ? sales - adSales : 0n, sales) : null,
    cpc: input.clicks ? round(divRound(spend, BigInt(input.clicks))) : null,
    conversion: conversion === null ? null : Math.round(conversion * 1000) / 10,
    breakEvenCpc:
      beforePerUnit === null || !input.clicks
        ? null
        : round(
            beforePerUnit > 0n
              ? divRound(beforePerUnit * BigInt(input.adOrders), BigInt(input.clicks))
              : 0n,
          ),
    profitAfterAds: after === null ? null : round(after),
    profitAfterAdsPerUnit: perUnit(after),
    marginAfterAds: after === null ? null : percent(after, sales),
    verdict,
  };
}

/** Worst first: losses, then ad problems, then missing costs, then the healthy by profit. */
const VERDICT_ORDER: Record<AdVerdict, number> = {
  losing: 0,
  ads_eat_profit: 1,
  ads_no_sales: 2,
  ads_above_break_even: 3,
  cost_missing: 4,
  healthy: 5,
  no_activity: 6,
};

export function sortSkuProfits(rows: readonly SkuProfit[]): SkuProfit[] {
  const value = (r: SkuProfit) => (r.profitAfterAds === null ? 0n : parseDecimal(r.profitAfterAds));
  return [...rows].sort((a, b) => {
    const byVerdict = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    if (byVerdict) return byVerdict;
    const diff = value(a) - value(b);
    if (diff) return diff < 0n ? -1 : 1;
    return parseDecimal(b.adSpend) - parseDecimal(a.adSpend) > 0n ? 1 : -1;
  });
}

/** A channel's totals across its SKUs, plus the ad spend not tied to one (Sponsored Brands). */
export type ChannelAdSummary = {
  sales: string;
  units: number;
  /** All ad spend: per-SKU plus not tied to one. */
  adSpend: string;
  /** Ad spend not tied to a SKU. */
  unallocatedSpend: string;
  adSales: string;
  acos: number | null;
  tacos: number | null;
  /** Profit before ads of the SKUs with a cost. */
  profitBeforeAds: string | null;
  /** Profit before ads less all ad spend (null when no SKU has a cost). */
  profitAfterAds: string | null;
  losing: number;
  /** What the SKUs losing money (after ads) lost, as a positive amount. */
  lost: string;
  /** Ad spend on SKUs with no ad sales. */
  wasted: string;
  costMissing: number;
};

export function channelAdSummary(
  rows: readonly SkuProfit[],
  unallocated: { spend: string; sales: string },
): ChannelAdSummary {
  let sales = 0n;
  let spend = parseDecimal(unallocated.spend);
  let adSales = parseDecimal(unallocated.sales);
  let before: bigint | null = null;
  let lost = 0n;
  let wasted = 0n;
  let losing = 0;
  let costMissing = 0;
  let units = 0;
  for (const r of rows) {
    sales += parseDecimal(r.sales);
    spend += parseDecimal(r.adSpend);
    adSales += parseDecimal(r.adSales);
    units += r.units;
    if (r.profitBeforeAds !== null) before = (before ?? 0n) + parseDecimal(r.profitBeforeAds);
    if (r.profitAfterAds !== null && parseDecimal(r.profitAfterAds) < 0n) {
      losing++;
      lost -= parseDecimal(r.profitAfterAds);
    }
    if (r.verdict === "cost_missing") costMissing++;
    if (parseDecimal(r.adSpend) > 0n && parseDecimal(r.adSales) === 0n) {
      wasted += parseDecimal(r.adSpend);
    }
  }
  return {
    sales: formatDecimal(sales),
    units,
    adSpend: formatDecimal(spend),
    unallocatedSpend: formatDecimal(parseDecimal(unallocated.spend)),
    adSales: formatDecimal(adSales),
    acos: percent(spend, adSales),
    tacos: percent(spend, sales),
    profitBeforeAds: before === null ? null : formatDecimal(before),
    // Each SKU with a cost takes its own spend; the channel also takes the spend tied to no SKU.
    profitAfterAds:
      before === null
        ? null
        : formatDecimal(
            before -
              rows.reduce(
                (t, r) => t + (r.profitBeforeAds === null ? 0n : parseDecimal(r.adSpend)),
                0n,
              ) -
              parseDecimal(unallocated.spend),
          ),
    losing,
    lost: formatDecimal(lost),
    wasted: formatDecimal(wasted),
    costMissing,
  };
}

export const PRODUCT_PROFIT_COLUMNS = [
  "Channel",
  "Currency",
  "SKU",
  "Product",
  "Verdict",
  "Units",
  "Orders",
  "Sales",
  "Average price",
  "Net before ads",
  "Product cost",
  "Profit before ads",
  "Profit before ads per unit",
  "Ad spend",
  "Ad sales",
  "Ad orders",
  "Clicks",
  "Impressions",
  "ACOS %",
  "TACOS %",
  "Break-even ACOS %",
  "ROAS",
  "Cost per click",
  "Break-even cost per click",
  "Conversion %",
  "Organic share %",
  "Profit after ads",
  "Profit after ads per unit",
  "Margin after ads %",
] as const;

/**
 * Profit by product as CSV rows (without the file's header lines): one row per SKU, then each
 * channel's ad spend tied to no product. Amounts in the channel's currency.
 */
export function productProfitCsvRows(
  channels: readonly {
    name: string;
    currency: string;
    rows: readonly SkuProfit[];
    unallocated: { spend: string; sales: string };
  }[],
  amount: (value: string | null, currency: string) => string,
): string[][] {
  const pct = (v: number | null) => (v === null ? "" : v.toFixed(1));
  const out: string[][] = [];
  for (const c of channels) {
    for (const r of c.rows) {
      out.push([
        c.name,
        c.currency,
        r.sku,
        r.label ?? "",
        AD_VERDICT_LABELS[r.verdict].label,
        String(r.units),
        String(r.orders),
        amount(r.sales, c.currency),
        amount(r.averagePrice, c.currency),
        amount(r.netBeforeAds, c.currency),
        amount(r.productCost, c.currency),
        amount(r.profitBeforeAds, c.currency),
        amount(r.profitBeforeAdsPerUnit, c.currency),
        amount(r.adSpend, c.currency),
        amount(r.adSales, c.currency),
        String(r.adOrders),
        String(r.clicks),
        String(r.impressions),
        pct(r.acos),
        pct(r.tacos),
        pct(r.breakEvenAcos),
        r.roas === null ? "" : r.roas.toFixed(2),
        amount(r.cpc, c.currency),
        amount(r.breakEvenCpc, c.currency),
        pct(r.conversion),
        pct(r.organicShare),
        amount(r.profitAfterAds, c.currency),
        amount(r.profitAfterAdsPerUnit, c.currency),
        pct(r.marginAfterAds),
      ]);
    }
    if (parseDecimal(c.unallocated.spend) !== 0n) {
      const row = PRODUCT_PROFIT_COLUMNS.map(() => "");
      row[0] = c.name;
      row[1] = c.currency;
      row[3] = "Sponsored Brands and other ads not tied to one product";
      row[13] = amount(c.unallocated.spend, c.currency);
      row[14] = amount(c.unallocated.sales, c.currency);
      row[26] = amount(formatDecimal(-parseDecimal(c.unallocated.spend)), c.currency);
      out.push(row);
    }
  }
  return out;
}

import { minorUnits } from "../currency";
import { divRound, formatDecimal, parseDecimal, roundUnits } from "../money";
import {
  addSettlementLines,
  channelProfit,
  emptyGroupTotals,
  type GroupTotals,
  PROFIT_GROUPS,
  type SettlementLine,
  settlementGroup,
  settlementLineLabel,
  settlementLineOnOrder,
} from "./settlements";

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
  /** The share of sales the marketplace leaves before ads (10 places), and where it's from. */
  keepRate: string | null;
  keepRateSource: KeepRateSource | null;
  /** Sales × the keep rate: what the marketplace leaves before ads. Null without one. */
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
 * The channel's keep rate: what it leaves per unit of sales after fees, refunds, promotions,
 * reimbursements and other lines, but before advertising (the books' advertising is added back,
 * because ads are counted per SKU from the ads reports instead). `promotions` (negative), when
 * given, comes off the sales the rate is a share of: for a channel whose order lines already take
 * their promotions off, so they aren't taken off twice. As a decimal string with 10 places, or
 * null without sales.
 */
export function keepRate(input: {
  sales: string;
  promotions?: string;
  net: string;
  advertising: string;
}) {
  const sales = parseDecimal(input.sales) + parseDecimal(input.promotions ?? "0");
  if (sales <= 0n) return null;
  // Advertising is negative (a cost) in the totals; adding it back means subtracting it.
  const beforeAds = parseDecimal(input.net) - parseDecimal(input.advertising);
  return formatDecimal(divRound(beforeAds * 10n ** 10n, sales), 10);
}

/**
 * Where a product's keep rate comes from: its own settled orders, Amazon's fee estimate for its
 * listing (too few settled), the channel's orders in the period, or the channel's orders over the
 * days before the period's end (none in it yet).
 */
export type KeepRateSource = "sku" | "estimate" | "period" | "trailing";

/** A SKU needs this many settled units for a rate of its own; fewer use the channel's. */
export const SKU_KEEP_MIN_UNITS = 5;

/**
 * The keep rate of what's on orders only (docs/ADS.md §3): `totals` are a channel's (or a SKU's)
 * amounts on orders, so referral and fulfilment fees, refunds and promotions set the rate, and the
 * account's own costs (storage, the selling plan, Vine) don't: they don't grow with each unit, so
 * shared by sales they make every unit look worse the fewer have been settled.
 */
export function orderKeepRate(
  totals: GroupTotals,
  options: { feeTaxRecoverable: boolean; promotionsInSales: boolean },
): string | null {
  const p = channelProfit(totals, { feeTaxRecoverable: options.feeTaxRecoverable });
  return keepRate({
    sales: p.groups.sales,
    promotions: options.promotionsInSales ? p.groups.promotions : undefined,
    net: p.net,
    advertising: p.groups.advertising,
  });
}

type RateLine = Pick<
  SettlementLine,
  "transactionType" | "amountType" | "amountDescription" | "amount"
>;

/** A settlement amount on one of a SKU's orders, and the units on it. */
export type SkuSettledLine = RateLine & { orderRef: string; sku: string; quantity: number };

/** What the period's settlements by SKU say about each SKU's orders. */
export type SettledRates = {
  /** SKUs with `minUnits` settled units sold (not given away): their own rate. */
  skus: Map<string, { rate: string; units: number }>;
  /** Every SKU's orders sold (not given away) together: the channel's rate; null without any. */
  channel: string | null;
  /**
   * Orders given away (a promotion of the whole item price: Vine, a free replacement), by SKU:
   * units, and what the marketplace charged on them (positive: a cost).
   */
  giveaways: Map<string, { units: number; fees: string }>;
};

/** A line's item price (not shipping or gift wrap), for units and for giving away. */
const itemLine = (l: RateLine) => !/shipping|giftwrap/i.test(l.amountDescription);

/**
 * Each SKU's own keep rate, from the amounts on its settled orders: a board and a set of mugs pay
 * about the same fulfilment fee per unit at very different prices, so one channel rate shared by
 * sales overstates one and understates the other. Orders given away (the promotion is the whole
 * item price) are left out of every rate: a launch's Vine units would otherwise charge their
 * fulfilment fees to the units that sell. They're counted apart, as a one-off cost.
 */
export function settledKeepRates(
  lines: readonly SkuSettledLine[],
  options: { feeTaxRecoverable: boolean; promotionsInSales: boolean; minUnits?: number },
): SettledRates {
  type Order = {
    sku: string;
    lines: SkuSettledLine[];
    item: bigint;
    promotion: bigint;
    units: number;
  };
  const orders = new Map<string, Order>();
  for (const l of lines) {
    const key = `${l.orderRef}|${l.sku}`;
    const o = orders.get(key) ?? { sku: l.sku, lines: [], item: 0n, promotion: 0n, units: 0 };
    o.lines.push(l);
    const group = settlementGroup(l);
    if (group === "sales" && itemLine(l)) {
      o.item += parseDecimal(l.amount);
      o.units += l.quantity;
    }
    if (group === "promotions" && itemLine(l)) o.promotion += parseDecimal(l.amount);
    orders.set(key, o);
  }
  const bySku = new Map<string, { totals: GroupTotals; units: number }>();
  const channel = emptyGroupTotals();
  const giveaways = new Map<string, { units: number; fees: bigint }>();
  for (const o of orders.values()) {
    if (o.item > 0n && o.item + o.promotion <= 0n) {
      const totals = addSettlementLines(emptyGroupTotals(), o.lines);
      const p = channelProfit(totals, { feeTaxRecoverable: options.feeTaxRecoverable });
      const g = giveaways.get(o.sku) ?? { units: 0, fees: 0n };
      g.units += o.units;
      g.fees -= parseDecimal(p.net) - parseDecimal(p.groups.advertising);
      giveaways.set(o.sku, g);
      continue;
    }
    const found = bySku.get(o.sku) ?? { totals: emptyGroupTotals(), units: 0 };
    addSettlementLines(found.totals, o.lines);
    addSettlementLines(channel, o.lines);
    found.units += o.units;
    bySku.set(o.sku, found);
  }
  const skus = new Map<string, { rate: string; units: number }>();
  for (const [sku, s] of bySku) {
    if (s.units < (options.minUnits ?? SKU_KEEP_MIN_UNITS)) continue;
    const rate = orderKeepRate(s.totals, options);
    if (rate !== null) skus.set(sku, { rate, units: s.units });
  }
  return {
    skus,
    channel: bySku.size ? orderKeepRate(channel, options) : null,
    giveaways: new Map(
      [...giveaways].map(([sku, g]) => [sku, { units: g.units, fees: formatDecimal(g.fees) }]),
    ),
  };
}

/** Amazon's fee estimate for a listing at a price (its referral fee and the whole), in its currency. */
export type ListingFeeEstimate = { price: string; referral: string; total: string };

/**
 * A SKU's keep rate from Amazon's fee estimate for its listing, for one with too few settled
 * orders of its own: the referral fee as a share of the price, the rest (FBA, closing fees) fixed
 * per unit over the SKU's own average price, and its own refunds on its orders as a share of its
 * sales. The channel's rate would charge a dear product a cheap one's share of the fixed fees. 10
 * places; null without a price.
 */
export function estimatedKeepRate(input: {
  averagePrice: string;
  estimate: ListingFeeEstimate;
  /** What the SKU's orders gave back (positive), and its sales. */
  refunded: string;
  sales: string;
}): string | null {
  const average = parseDecimal(input.averagePrice);
  const listed = parseDecimal(input.estimate.price);
  if (average <= 0n || listed <= 0n) return null;
  const scale = 10n ** 10n;
  const referral = parseDecimal(input.estimate.referral);
  const fixed = parseDecimal(input.estimate.total) - referral;
  const sales = parseDecimal(input.sales);
  const rate =
    scale -
    divRound(referral * scale, listed) -
    divRound(fixed * scale, average) -
    (sales > 0n ? divRound(parseDecimal(input.refunded) * scale, sales) : 0n);
  return formatDecimal(rate, 10);
}

/** Units given away in the period (positive amounts: costs), in the channel's currency. */
export type GiveawayCosts = {
  units: number;
  /** Units × each one's cost (the units whose cost is known). */
  productCost: string;
  /** The marketplace's fees on them: per unit as their settled giveaways show, × units. */
  fees: string;
  amount: string;
  /** Units with no cost known (left out of the product cost). */
  costMissing: number;
  /** No giveaway settled yet to learn their fees from: fees are 0 until one is. */
  feesUnknown: boolean;
};

/**
 * What the period's giveaways cost (docs/ADS.md §3): each unit's cost, and the marketplace's fees
 * per unit given away (the SKU's settled giveaways, else every SKU's) × the units given away in the
 * period, so giveaways not settled yet are counted too. A one-off line, not in any product.
 */
export function giveawayCosts(input: {
  skus: readonly { sku: string; units: number; unitCost: string | null }[];
  settled: SettledRates["giveaways"];
  currency: string;
}): GiveawayCosts {
  const decimals = minorUnits(input.currency);
  let settledUnits = 0n;
  let settledFees = 0n;
  for (const g of input.settled.values()) {
    settledUnits += BigInt(g.units);
    settledFees += parseDecimal(g.fees);
  }
  let units = 0;
  let cost = 0n;
  let fees = 0n;
  let costMissing = 0;
  let feesUnknown = false;
  for (const s of input.skus) {
    if (s.units <= 0) continue;
    units += s.units;
    if (s.unitCost === null) costMissing += s.units;
    else cost += roundUnits(parseDecimal(s.unitCost) * BigInt(s.units), decimals);
    const own = input.settled.get(s.sku);
    const [u, f] =
      own && own.units > 0
        ? [BigInt(own.units), parseDecimal(own.fees)]
        : [settledUnits, settledFees];
    if (u > 0n) fees += roundUnits(divRound(f * BigInt(s.units), u), decimals);
    else feesUnknown = true;
  }
  return {
    units,
    productCost: formatDecimal(cost),
    fees: formatDecimal(fees),
    amount: formatDecimal(cost + fees),
    costMissing,
    feesUnknown,
  };
}

/** The account's own costs in a period (positive: a cost), by what they are, largest first. */
export type AccountCosts = { amount: string; items: { label: string; amount: string }[] };

/** Lines that only move a balance (a carried balance, a card charge, a bank check): not costs. */
const BALANCE_LINE = /payable to amazon|successful charge|micro deposit|transfer|reserve/i;

/**
 * What the account cost apart from its orders and ads (docs/ADS.md §3): storage, the selling
 * plan, inbound placement, Vine, coupon fees, less what the marketplace paid back for lost
 * stock. Shown as their own line, in full, never shared out as a rate.
 */
export function accountCosts(
  lines: readonly RateLine[],
  options: { feeTaxRecoverable: boolean },
): AccountCosts {
  const byLabel = new Map<string, bigint>();
  let total = 0n;
  for (const l of lines) {
    if (settlementLineOnOrder(l)) continue;
    const group = settlementGroup(l);
    if (!(PROFIT_GROUPS as readonly string[]).includes(group) || group === "advertising") continue;
    if (group === "feeTax" && options.feeTaxRecoverable) continue;
    if (BALANCE_LINE.test(`${l.transactionType} ${l.amountType} ${l.amountDescription}`)) continue;
    // "FBAFees · FBA Inventory Storage Fee · Base fee": the amount type says what it is.
    const named =
      group === "feeTax" || /other-transaction|^other$/i.test(l.amountType)
        ? l
        : { ...l, amountDescription: l.amountType };
    const label = settlementLineLabel(named).replace(/\s+/g, " ");
    const cost = -parseDecimal(l.amount);
    total += cost;
    byLabel.set(label, (byLabel.get(label) ?? 0n) + cost);
  }
  const size = (v: bigint) => (v < 0n ? -v : v);
  return {
    amount: formatDecimal(total),
    items: [...byLabel]
      .filter(([, v]) => v !== 0n)
      .sort((a, b) => (size(b[1]) > size(a[1]) ? 1 : size(b[1]) < size(a[1]) ? -1 : 0))
      .map(([label, v]) => ({ label, amount: formatDecimal(v) })),
  };
}

/** One SKU's profit after ads, in the channel's currency (`currency` rounds the results). */
export function skuProfit(
  input: SkuPeriodInput,
  options: { keepRate: string | null; keepRateSource?: KeepRateSource | null; currency: string },
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
    keepRate: options.keepRate,
    keepRateSource: options.keepRate === null ? null : (options.keepRateSource ?? null),
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
  /**
   * One-off costs tied to no product's units (positive: a cost): the account's own (storage, the
   * selling plan) and the units given away.
   */
  oneOffCosts: string;
  /** Profit before ads less all ad spend and the one-off costs (null when no SKU has a cost). */
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
  oneOffCosts = "0",
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
    oneOffCosts: formatDecimal(parseDecimal(oneOffCosts)),
    // Each SKU with a cost takes its own spend; the channel also takes the spend tied to no SKU,
    // and the one-off costs.
    profitAfterAds:
      before === null
        ? null
        : formatDecimal(
            before -
              rows.reduce(
                (t, r) => t + (r.profitBeforeAds === null ? 0n : parseDecimal(r.adSpend)),
                0n,
              ) -
              parseDecimal(unallocated.spend) -
              parseDecimal(oneOffCosts),
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
  "Marketplace leaves %",
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
    accountCosts?: AccountCosts | null;
    giveaways?: GiveawayCosts | null;
  }[],
  amount: (value: string | null, currency: string) => string,
): string[][] {
  const pct = (v: number | null) => (v === null ? "" : v.toFixed(1));
  const rate = (v: string | null) =>
    v === null ? "" : formatDecimal(divRound(parseDecimal(v, 10) * 100n, 10n ** 9n), 1);
  const column = (name: (typeof PRODUCT_PROFIT_COLUMNS)[number]) =>
    PRODUCT_PROFIT_COLUMNS.indexOf(name);
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
        rate(r.keepRate),
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
      row[column("Ad spend")] = amount(c.unallocated.spend, c.currency);
      row[column("Ad sales")] = amount(c.unallocated.sales, c.currency);
      row[column("Profit after ads")] = amount(
        formatDecimal(-parseDecimal(c.unallocated.spend)),
        c.currency,
      );
      out.push(row);
    }
    if (c.accountCosts && parseDecimal(c.accountCosts.amount) !== 0n) {
      const row = PRODUCT_PROFIT_COLUMNS.map(() => "");
      row[0] = c.name;
      row[1] = c.currency;
      row[3] = `Storage, selling plan and other account costs (${c.accountCosts.items
        .map((i) => i.label)
        .join(", ")})`;
      row[column("Profit after ads")] = amount(
        formatDecimal(-parseDecimal(c.accountCosts.amount)),
        c.currency,
      );
      out.push(row);
    }
    if (c.giveaways && c.giveaways.units > 0) {
      const row = PRODUCT_PROFIT_COLUMNS.map(() => "");
      row[0] = c.name;
      row[1] = c.currency;
      row[3] =
        "Units given away (Vine and other 100%-off orders): their cost and the marketplace's fees";
      row[column("Units")] = String(c.giveaways.units);
      row[column("Product cost")] = amount(c.giveaways.productCost, c.currency);
      row[column("Profit after ads")] = amount(
        formatDecimal(-parseDecimal(c.giveaways.amount)),
        c.currency,
      );
      out.push(row);
    }
  }
  return out;
}

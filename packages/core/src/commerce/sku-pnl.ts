import { minorUnits } from "../currency";
import { addDaysIso } from "../entity/compliance";
import { divRound, formatDecimal, parseDecimal, roundUnits } from "../money";
import { EBAY_ADVERTISING_FEE, EBAY_TRANSFER_TYPES } from "./ebay-finances";
import { noonTypeKey } from "./noon-posting";
import { NOON_AMOUNT_FIELDS, type NoonAmountField } from "./noon-transactions";
import { type SettlementLine, settlementGroup } from "./settlements";
import { type WalmartLayout, walmartRowGroup } from "./walmart-posting";
import { walmartAmount } from "./walmart-settlement-file";

/**
 * The exact profit and loss of each SKU (docs/ADS.md §6b): for any period, what every unit sold
 * brought in and cost, line by line, from the marketplaces' own rows wherever they carry the SKU
 * (or the order), and marked estimated wherever they don't yet.
 *
 * Orders are the spine: a SKU's period is the order lines bought in it (company time zone), and
 * every amount on those orders (fees, refunds, later reimbursements) counts in that period, so a
 * period's units and what they cost always go together. Amounts tied to no order count by their
 * own day: a SKU's (a reimbursement for lost stock), or the account's (storage, the selling plan),
 * shared by units. Ads count by their day, from the ads reports.
 *
 * An order line with marketplace rows is **settled** (actual). One without yet is estimated: its
 * sales and promotions from the order, its refunds from the order's refunds, and its fees at the
 * rates the settled lines of the same SKU show (else the channel's), or, when nothing on the
 * channel is settled, at the channel's keep rate. Ads in the last 14 days are estimated too
 * (attribution still moves), and so is cost of goods sold for months not posted yet.
 */

export const SKU_PNL_LINES = [
  "grossSales",
  "shipping",
  "promotions",
  "refunds",
  "referral",
  "fulfilment",
  "otherFees",
  "marketplaceEstimate",
  "reimbursements",
  "other",
  "accountFees",
  "cogs",
  "ads",
  "sponsoredBrands",
  "booksAdvertising",
] as const;
export type SkuPnlLine = (typeof SKU_PNL_LINES)[number];

export const SKU_PNL_LABELS: Record<SkuPnlLine, { label: string; hint: string }> = {
  grossSales: { label: "Gross sales", hint: "Item price buyers paid, before promotions." },
  shipping: { label: "Shipping and gift wrap", hint: "What buyers paid for delivery and wrap." },
  promotions: {
    label: "Promotions and coupons",
    hint: "Discounts you funded (and, on Noon, what Noon paid toward them).",
  },
  refunds: { label: "Refunds", hint: "Money given back to buyers, with any fees given back." },
  referral: { label: "Referral and commission", hint: "The marketplace's cut of each sale." },
  fulfilment: {
    label: "Fulfilment fees",
    hint: "FBA, FBN or WFS picking, packing and shipping.",
  },
  otherFees: {
    label: "Other fees",
    hint: "Closing, chargeback, label and other per-order fees, with tax on fees when it's a cost.",
  },
  marketplaceEstimate: {
    label: "Marketplace fees (keep rate)",
    hint: "Nothing on this channel is settled by product yet: its fees, refunds and the rest, estimated by the share of sales the marketplace leaves.",
  },
  reimbursements: {
    label: "Reimbursements",
    hint: "What the marketplace paid back for lost or damaged units.",
  },
  other: { label: "Other", hint: "Anything else on its orders." },
  accountFees: {
    label: "Storage and account fees",
    hint: "Storage, the selling plan and other fees on no product, shared by units sold (an estimate).",
  },
  cogs: {
    label: "Cost of goods",
    hint: "What the units cost you: the cost posted for their month, else the next unit's landed cost (an estimate).",
  },
  ads: { label: "Ad spend", hint: "This product's spend in the ads reports." },
  sponsoredBrands: {
    label: "Sponsored Brands",
    hint: "Brand ads have no spend per product: shared by each product's ad sales.",
  },
  booksAdvertising: {
    label: "Advertising in your books",
    hint: "No ads reports for this channel: its advertising charges, not split by product.",
  },
};

/** Lines that are sales, fees, costs: the waterfall's groups. */
export const SKU_PNL_REVENUE: readonly SkuPnlLine[] = [
  "grossSales",
  "shipping",
  "promotions",
  "refunds",
];
export const SKU_PNL_FEES: readonly SkuPnlLine[] = [
  "referral",
  "fulfilment",
  "otherFees",
  "marketplaceEstimate",
  "reimbursements",
  "other",
  "accountFees",
];
export const SKU_PNL_ADS: readonly SkuPnlLine[] = ["ads", "sponsoredBrands", "booksAdvertising"];

/** Ads this recent are estimated: the marketplace can still give them sales for 14 days. */
export const AD_ATTRIBUTION_DAYS = 14;

/** What a marketplace row's amount is, for a SKU. "ignore": sales tax, reserves, payouts. */
export type SkuMoneyKind =
  | "sales"
  | "shipping"
  | "promotions"
  | "refunds"
  | "referral"
  | "fulfilment"
  | "otherFees"
  | "feeTax"
  | "reimbursements"
  | "advertising"
  | "other"
  | "ignore";

/** One marketplace amount, in the channel's currency (signed: money to the seller is positive). */
export type SkuMoneyRow = {
  /** The marketplace's order number, when the amount is on an order. */
  orderRef: string | null;
  sku: string | null;
  /** Its own day (YYYY-MM-DD): where it counts when it's on no order of the period. */
  date: string;
  kind: SkuMoneyKind;
  amount: string;
  /** Units on a sale row, for an order Bookalyze doesn't have. */
  quantity: number;
  /** Its order is one Bookalyze has, bought outside the period: it counts there, not here. */
  orderElsewhere: boolean;
};

/** An order line bought in the period. Money in the channel's currency. */
export type SkuOrderLine = {
  orderRef: string;
  sku: string;
  /** The day it was bought (company time zone). */
  date: string;
  units: number;
  /** Item price for the whole quantity. */
  gross: string;
  /** Promotion discount (positive). */
  promotions: string;
  /** Its share of what the order gave back (positive), by item price. */
  refunded: string;
  returnedUnits: number;
};

/** One amount of a SKU's profit and loss, on its day, in `currency`. */
export type SkuPnlEntry = {
  /** "" for a channel's lines tied to no product. */
  sku: string;
  date: string;
  line: SkuPnlLine;
  amount: string;
  currency: string;
  estimated: boolean;
};

export type SkuPnlCounts = {
  unitsSold: number;
  unitsReturned: number;
  orders: number;
  /** Units on lines with marketplace rows. */
  settledUnits: number;
};

/** A SKU's link to products (bundles: several), and their costs. */
export type SkuCostInput = {
  components: { productId: string; units: number }[];
};

export type ChannelPnlInput = {
  currency: string;
  /** The cost of goods' currency (the main currency: lots are kept in it). */
  costCurrency: string;
  lines: readonly SkuOrderLine[];
  rows: readonly SkuMoneyRow[];
  /** The channel's keep rate (10 places), for when nothing on it is settled. */
  keepRate: string | null;
  feeTaxRecoverable: boolean;
  /** Ads reports exist for the channel: ad charges in its rows aren't counted again. */
  hasAdsReports: boolean;
  ads: readonly {
    sku: string | null;
    date: string;
    spend: string;
    attributedSales: string;
  }[];
  /** Share Sponsored Brands by ad sales instead of keeping it as its own line. */
  allocateBrands: boolean;
  links: ReadonlyMap<string, SkuCostInput>;
  /** Unit cost each product's units posted at, per month ("2026-09" → product → cost). */
  postedCosts: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The next unit's landed cost (`costCurrency`), for months not posted. */
  nextCosts: ReadonlyMap<string, string>;
  /** Today (company time zone): ads after today − 14 days are estimated. */
  today: string;
};

export type ChannelPnl = {
  entries: SkuPnlEntry[];
  counts: Map<string, SkuPnlCounts>;
  /** "rows": fees from the marketplace's rows; "keep": nothing settled, the keep rate. */
  mode: "rows" | "keep";
  /** SKUs with no cost (not linked, or a product with no cost yet). */
  costMissing: Set<string>;
  /** Nothing settled and no keep rate: fees can't be known. */
  feesUnknown: boolean;
};

const ESTIMATED_RATE_KINDS = [
  "shipping",
  "referral",
  "fulfilment",
  "otherFees",
  "reimbursements",
  "other",
] as const;
type RateKind = (typeof ESTIMATED_RATE_KINDS)[number];

const SCALE = 10n ** 10n;

/** Each SKU's lines for one channel, in the channel's currency (cost of goods in `costCurrency`). */
export function channelSkuPnl(input: ChannelPnlInput): ChannelPnl {
  const entries: SkuPnlEntry[] = [];
  const counts = new Map<string, SkuPnlCounts>();
  const costMissing = new Set<string>();
  const countOf = (sku: string) => {
    let c = counts.get(sku);
    if (!c) {
      c = { unitsSold: 0, unitsReturned: 0, orders: 0, settledUnits: 0 };
      counts.set(sku, c);
    }
    return c;
  };
  const push = (
    sku: string,
    date: string,
    line: SkuPnlLine,
    units: bigint,
    estimated: boolean,
    currency = input.currency,
  ) => {
    if (units === 0n) return;
    entries.push({ sku, date, line, amount: formatDecimal(units), currency, estimated });
  };
  const lineOf = (kind: SkuMoneyKind): SkuPnlLine | null => {
    switch (kind) {
      case "sales":
        return "grossSales";
      case "feeTax":
        return input.feeTaxRecoverable ? null : "otherFees";
      case "advertising":
        return input.hasAdsReports ? null : "ads";
      case "ignore":
        return null;
      default:
        return kind;
    }
  };

  // Order lines, by order then SKU; rows on the period's orders hang off them.
  type Line = SkuOrderLine & { rows: SkuMoneyRow[]; split: { row: SkuMoneyRow; units: bigint }[] };
  const byOrder = new Map<string, Map<string, Line>>();
  for (const l of input.lines) {
    const order = byOrder.get(l.orderRef) ?? new Map<string, Line>();
    const found = order.get(l.sku);
    if (found) {
      found.units += l.units;
      found.gross = formatDecimal(parseDecimal(found.gross) + parseDecimal(l.gross));
      found.promotions = formatDecimal(parseDecimal(found.promotions) + parseDecimal(l.promotions));
      found.refunded = formatDecimal(parseDecimal(found.refunded) + parseDecimal(l.refunded));
      found.returnedUnits += l.returnedUnits;
    } else order.set(l.sku, { ...l, rows: [], split: [] });
    byOrder.set(l.orderRef, order);
  }
  const account: SkuMoneyRow[] = [];
  for (const row of input.rows) {
    if (row.kind === "ignore") continue;
    const order = row.orderRef ? byOrder.get(row.orderRef) : undefined;
    if (order) {
      const own = row.sku ? order.get(row.sku) : undefined;
      if (own) own.rows.push(row);
      else if (row.sku) {
        // A SKU the order's lines don't have: its own line on the order, with no units.
        const first = [...order.values()][0];
        order.set(row.sku, {
          orderRef: row.orderRef ?? "",
          sku: row.sku,
          date: first?.date ?? row.date,
          units: 0,
          gross: "0",
          promotions: "0",
          refunded: "0",
          returnedUnits: 0,
          rows: [row],
          split: [],
        });
      } else {
        // On the order but no SKU (eBay's rows, some of Amazon's): shared by item price.
        const lines = [...order.values()];
        const shares = splitUnits(
          parseDecimal(row.amount),
          lines.map((l) => parseDecimal(l.gross)),
        );
        lines.forEach((l, i) => {
          l.split.push({ row, units: shares[i] ?? 0n });
        });
      }
      continue;
    }
    if (row.orderElsewhere) continue;
    if (row.orderRef && row.sku) {
      // An order Bookalyze doesn't have (not synced, or older than the order history): its rows
      // make its line, dated by the rows.
      const made = byOrder.get(row.orderRef) ?? new Map<string, Line>();
      let line = made.get(row.sku);
      if (!line) {
        line = {
          orderRef: row.orderRef,
          sku: row.sku,
          date: row.date,
          units: 0,
          gross: "0",
          promotions: "0",
          refunded: "0",
          returnedUnits: 0,
          rows: [],
          split: [],
        };
        made.set(row.sku, line);
        byOrder.set(row.orderRef, made);
      }
      if (row.date < line.date) line.date = row.date;
      if (row.kind === "sales") line.units += row.quantity;
      line.rows.push(row);
      continue;
    }
    if (row.sku) {
      // On a SKU but no order: a reimbursement for its stock, say. Actual, on its day.
      const target = lineOf(row.kind);
      if (target) push(row.sku, row.date, target, parseDecimal(row.amount), false);
      countOf(row.sku);
      continue;
    }
    account.push(row);
  }

  const lines = [...byOrder.values()].flatMap((o) => [...o.values()]);
  const hasRows = (l: Line) => l.rows.length > 0 || l.split.length > 0;
  const mode: ChannelPnl["mode"] = lines.some(hasRows) ? "rows" : "keep";
  const feesUnknown = mode === "keep" && input.keepRate === null && lines.length > 0;
  const amountsOf = (l: Line) => {
    const out = new Map<SkuPnlLine, bigint>();
    const add = (row: SkuMoneyRow, units: bigint) => {
      const target = lineOf(row.kind);
      if (target) out.set(target, (out.get(target) ?? 0n) + units);
    };
    for (const r of l.rows) add(r, parseDecimal(r.amount));
    for (const s of l.split) add(s.row, s.units);
    return out;
  };
  const rowAmounts = new Map<Line, Map<SkuPnlLine, bigint>>();
  for (const l of lines) if (hasRows(l)) rowAmounts.set(l, amountsOf(l));
  /** A line whose sale is in the marketplace's rows: settled, every amount actual. */
  const settled = (l: Line) => rowAmounts.get(l)?.has("grossSales") ?? false;

  // Rates of the settled lines (per SKU, and the channel's), for the lines not settled yet.
  type Rates = { base: bigint } & Record<RateKind, bigint>;
  const blankRates = (): Rates => ({
    base: 0n,
    shipping: 0n,
    referral: 0n,
    fulfilment: 0n,
    otherFees: 0n,
    reimbursements: 0n,
    other: 0n,
  });
  const skuRates = new Map<string, Rates>();
  const channelRates = blankRates();
  for (const l of lines) {
    const amounts = rowAmounts.get(l);
    if (!amounts || !settled(l)) continue;
    const base = parseDecimal(l.gross) - parseDecimal(l.promotions);
    if (base <= 0n) continue;
    const rates = skuRates.get(l.sku) ?? blankRates();
    rates.base += base;
    channelRates.base += base;
    for (const k of ESTIMATED_RATE_KINDS) {
      rates[k] += amounts.get(k) ?? 0n;
      channelRates[k] += amounts.get(k) ?? 0n;
    }
    skuRates.set(l.sku, rates);
  }

  const decimals = minorUnits(input.currency);
  const round = (units: bigint) => roundUnits(units, decimals);
  for (const l of lines) {
    const c = countOf(l.sku);
    c.unitsSold += l.units;
    c.unitsReturned += l.returnedUnits;
    if (l.units > 0) c.orders++;
    const amounts = rowAmounts.get(l) ?? new Map<SkuPnlLine, bigint>();
    if (settled(l)) {
      c.settledUnits += l.units;
      for (const [line, units] of amounts) push(l.sku, l.date, line, units, false);
    } else {
      // Not settled yet: sales from the order, fees estimated; any rows it has (a refund
      // settled before the sale, say) count as they are.
      const gross = parseDecimal(l.gross);
      const promotions = parseDecimal(l.promotions);
      const base = gross - promotions;
      push(l.sku, l.date, "grossSales", gross, false);
      push(l.sku, l.date, "promotions", -promotions, false);
      if (mode === "keep") {
        if (input.keepRate !== null) {
          const kept = round(divRound(base * parseDecimal(input.keepRate, 10), SCALE));
          push(l.sku, l.date, "marketplaceEstimate", kept - base, true);
        }
      } else {
        if (!amounts.has("refunds")) {
          push(l.sku, l.date, "refunds", -parseDecimal(l.refunded), true);
        }
        const own = skuRates.get(l.sku);
        const rates = own && own.base > 0n ? own : channelRates;
        if (rates.base > 0n) {
          for (const k of ESTIMATED_RATE_KINDS) {
            push(l.sku, l.date, k, round(divRound(base * rates[k], rates.base)), true);
          }
        }
      }
      for (const [line, units] of amounts) push(l.sku, l.date, line, units, false);
    }
    // Cost of goods: the month's posted cost (actual), else the next unit's (estimated).
    const link = input.links.get(l.sku);
    if (!link?.components.length) {
      if (l.units > 0) costMissing.add(l.sku);
      continue;
    }
    if (l.units <= 0) continue;
    const posted = input.postedCosts.get(l.date.slice(0, 7));
    let cost = 0n;
    let estimated = false;
    let missing = false;
    for (const comp of link.components) {
      const at = posted?.get(comp.productId);
      const unit = at ?? input.nextCosts.get(comp.productId);
      if (unit === undefined) {
        missing = true;
        break;
      }
      if (at === undefined) estimated = true;
      cost += parseDecimal(unit) * BigInt(comp.units * l.units);
    }
    if (missing) costMissing.add(l.sku);
    else
      push(
        l.sku,
        l.date,
        "cogs",
        -roundUnits(cost, minorUnits(input.costCurrency)),
        estimated,
        input.costCurrency,
      );
  }

  // The account's own fees (rows mode only: the keep rate already has them), shared by units.
  const unitsBySku = [...counts.entries()].filter(([, c]) => c.unitsSold > 0);
  const totalUnits = unitsBySku.reduce((t, [, c]) => t + BigInt(c.unitsSold), 0n);
  for (const row of account) {
    if (row.kind === "advertising") {
      if (!input.hasAdsReports)
        push("", row.date, "booksAdvertising", parseDecimal(row.amount), false);
      continue;
    }
    if (mode === "keep") continue;
    if (row.kind === "feeTax" && input.feeTaxRecoverable) continue;
    const units = parseDecimal(row.amount);
    if (totalUnits === 0n) {
      push("", row.date, "accountFees", units, false);
      continue;
    }
    const shares = splitUnits(
      units,
      unitsBySku.map(([, c]) => BigInt(c.unitsSold)),
    );
    unitsBySku.forEach(([sku], i) => {
      push(sku, row.date, "accountFees", shares[i] ?? 0n, true);
    });
  }

  // Ads from the reports: the last 14 days are estimated (attribution still moves).
  const settledFrom = addDaysIso(input.today, -AD_ATTRIBUTION_DAYS);
  const brands = input.ads.filter((a) => a.sku === null);
  const adSalesBySku = new Map<string, bigint>();
  for (const a of input.ads) {
    if (a.sku === null) continue;
    countOf(a.sku);
    push(a.sku, a.date, "ads", -parseDecimal(a.spend), a.date > settledFrom);
    adSalesBySku.set(a.sku, (adSalesBySku.get(a.sku) ?? 0n) + parseDecimal(a.attributedSales));
  }
  if (brands.length) {
    // Shared by each SKU's ad sales (else its sales), when chosen; else the channel's own line.
    let weights = [...adSalesBySku.entries()].filter(([, v]) => v > 0n);
    if (!weights.length) {
      const sales = new Map<string, bigint>();
      for (const e of entries) {
        if (e.sku && (e.line === "grossSales" || e.line === "promotions")) {
          sales.set(e.sku, (sales.get(e.sku) ?? 0n) + parseDecimal(e.amount));
        }
      }
      weights = [...sales.entries()].filter(([, v]) => v > 0n);
    }
    for (const a of brands) {
      const spend = -parseDecimal(a.spend);
      if (!input.allocateBrands || !weights.length) {
        push("", a.date, "sponsoredBrands", spend, a.date > settledFrom);
        continue;
      }
      const shares = splitUnits(
        spend,
        weights.map(([, w]) => w),
      );
      weights.forEach(([sku], i) => {
        push(sku, a.date, "sponsoredBrands", shares[i] ?? 0n, true);
      });
    }
  }

  return { entries, counts, mode, costMissing, feesUnknown };
}

/**
 * Splits `units` by `weights` exactly: each share rounded down to a cent of the 4-place units,
 * the remainder to the largest weights, so the shares always add up to `units`.
 */
export function splitUnits(units: bigint, weights: readonly bigint[]): bigint[] {
  const positive = weights.map((w) => (w > 0n ? w : 0n));
  const total = positive.reduce((t, w) => t + w, 0n);
  if (!weights.length) return [];
  if (total === 0n) {
    // No weights: evenly.
    const each = units / BigInt(weights.length);
    const out = weights.map(() => each);
    out[0] = (out[0] ?? 0n) + (units - each * BigInt(weights.length));
    return out;
  }
  const out = positive.map((w) => (units * w) / total);
  let left = units - out.reduce((t, v) => t + v, 0n);
  const order = positive
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (b.w > a.w ? 1 : b.w < a.w ? -1 : a.i - b.i));
  const step = left > 0n ? 1n : -1n;
  for (let k = 0; left !== 0n; k = (k + 1) % order.length) {
    const at = order[k]?.i ?? 0;
    out[at] = (out[at] ?? 0n) + step;
    left -= step;
  }
  return out;
}

// --- The summary --------------------------------------------------------------------------

export type SkuPnlAmount = {
  /** The line's total. */
  amount: string;
  /** How much of it is estimated. */
  estimated: string;
};

export type SkuPnl = {
  sku: string;
  label: string | null;
  linked: boolean;
  unitsSold: number;
  unitsReturned: number;
  orders: number;
  lines: Record<SkuPnlLine, SkuPnlAmount>;
  /** Gross sales plus promotions: what buyers paid for the items. */
  sales: string;
  /** Sales, shipping and refunds: what the sales brought in. */
  revenue: string;
  /** Fees, reimbursements and the rest. */
  marketplace: string;
  cogs: string;
  ads: string;
  /** Null when its cost or its fees aren't known. */
  profit: string | null;
  /** Profit ÷ sales, in percent. */
  margin: number | null;
  profitPerUnit: string | null;
  /** Ad spend ÷ sales, in percent. */
  tacos: number | null;
  /** The share of its amounts (by size) that are actual, in percent; null with none. */
  actualShare: number | null;
  costMissing: boolean;
  feesUnknown: boolean;
  /** Amounts left out: no exchange rate for their day. */
  unconverted: number;
};

const blankLines = () =>
  Object.fromEntries(SKU_PNL_LINES.map((l) => [l, { amount: 0n, estimated: 0n }])) as Record<
    SkuPnlLine,
    { amount: bigint; estimated: bigint }
  >;

function percent(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  return Number(divRound(numerator * 1000n, denominator)) / 10;
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/**
 * Adds entries up into one row per SKU, in `currency`: `convert` turns an entry's amount into it
 * at its day's rate (null: no rate, left out and counted). The row with SKU "" is what's tied to
 * no product (Sponsored Brands, the books' advertising): profit, but no units.
 */
export function summarizeSkuPnl(input: {
  entries: readonly SkuPnlEntry[];
  counts: ReadonlyMap<string, SkuPnlCounts>;
  currency: string;
  convert: (entry: SkuPnlEntry) => bigint | null;
  labels?: ReadonlyMap<string, { label: string | null; linked: boolean }>;
  costMissing?: ReadonlySet<string>;
  feesUnknown?: ReadonlySet<string>;
}): SkuPnl[] {
  const decimals = minorUnits(input.currency);
  const bySku = new Map<
    string,
    { lines: ReturnType<typeof blankLines>; actual: bigint; all: bigint; unconverted: number }
  >();
  const of = (sku: string) => {
    let s = bySku.get(sku);
    if (!s) {
      s = { lines: blankLines(), actual: 0n, all: 0n, unconverted: 0 };
      bySku.set(sku, s);
    }
    return s;
  };
  for (const sku of input.counts.keys()) of(sku);
  for (const e of input.entries) {
    const s = of(e.sku);
    const units = input.convert(e);
    if (units === null) {
      s.unconverted++;
      continue;
    }
    const line = s.lines[e.line];
    line.amount += units;
    if (e.estimated) line.estimated += units;
    else s.actual += abs(units);
    s.all += abs(units);
  }
  const out: SkuPnl[] = [];
  for (const [sku, s] of bySku) {
    const c = input.counts.get(sku) ?? { unitsSold: 0, unitsReturned: 0, orders: 0 };
    const sum = (keys: readonly SkuPnlLine[]) => keys.reduce((t, k) => t + s.lines[k].amount, 0n);
    const r = (v: bigint) => formatDecimal(roundUnits(v, decimals));
    const sales = s.lines.grossSales.amount + s.lines.promotions.amount;
    const revenue = sum(SKU_PNL_REVENUE);
    const marketplace = sum(SKU_PNL_FEES);
    const cogs = s.lines.cogs.amount;
    const ads = sum(SKU_PNL_ADS);
    const costMissing = Boolean(input.costMissing?.has(sku));
    const feesUnknown = Boolean(input.feesUnknown?.has(sku));
    const profit = costMissing || feesUnknown ? null : revenue + marketplace + cogs + ads;
    const units = BigInt(c.unitsSold);
    const info = input.labels?.get(sku);
    out.push({
      sku,
      label: info?.label ?? null,
      linked: info?.linked ?? false,
      unitsSold: c.unitsSold,
      unitsReturned: c.unitsReturned,
      orders: c.orders,
      lines: Object.fromEntries(
        SKU_PNL_LINES.map((l) => [
          l,
          { amount: r(s.lines[l].amount), estimated: r(s.lines[l].estimated) },
        ]),
      ) as Record<SkuPnlLine, SkuPnlAmount>,
      sales: r(sales),
      revenue: r(revenue),
      marketplace: r(marketplace),
      cogs: r(cogs),
      ads: r(ads),
      profit: profit === null ? null : r(profit),
      margin: profit === null ? null : percent(profit, sales),
      profitPerUnit: profit === null || units === 0n ? null : r(divRound(profit, units)),
      tacos: percent(-ads, sales),
      actualShare: s.all === 0n ? null : percent(s.actual, s.all),
      costMissing,
      feesUnknown,
      unconverted: s.unconverted,
    });
  }
  return out.sort((a, b) => {
    // What's tied to no product goes last; then the worst profit first.
    if (!a.sku !== !b.sku) return a.sku ? -1 : 1;
    const va = a.profit === null ? null : parseDecimal(a.profit);
    const vb = b.profit === null ? null : parseDecimal(b.profit);
    if (va === null || vb === null)
      return va === vb ? a.sku.localeCompare(b.sku) : va === null ? 1 : -1;
    return va === vb ? a.sku.localeCompare(b.sku) : va < vb ? -1 : 1;
  });
}

/** Rows together: every amount summed, the period's "x% actual". */
export function totalSkuPnl(rows: readonly SkuPnl[], currency: string): SkuPnl {
  const decimals = minorUnits(currency);
  const lines = blankLines();
  let unitsSold = 0;
  let unitsReturned = 0;
  let orders = 0;
  let actualWeighted = 0n;
  let all = 0n;
  let anyProfit = false;
  let profit = 0n;
  let unconverted = 0;
  for (const row of rows) {
    unitsSold += row.unitsSold;
    unitsReturned += row.unitsReturned;
    orders += row.orders;
    unconverted += row.unconverted;
    for (const l of SKU_PNL_LINES) {
      lines[l].amount += parseDecimal(row.lines[l].amount);
      lines[l].estimated += parseDecimal(row.lines[l].estimated);
    }
    if (row.profit !== null) {
      anyProfit = true;
      profit += parseDecimal(row.profit);
    }
  }
  for (const l of SKU_PNL_LINES) {
    all += abs(lines[l].amount);
    actualWeighted += abs(lines[l].amount - lines[l].estimated);
  }
  const r = (v: bigint) => formatDecimal(roundUnits(v, decimals));
  const sum = (keys: readonly SkuPnlLine[]) => keys.reduce((t, k) => t + lines[k].amount, 0n);
  const sales = lines.grossSales.amount + lines.promotions.amount;
  const ads = sum(SKU_PNL_ADS);
  return {
    sku: "",
    label: "All products",
    linked: false,
    unitsSold,
    unitsReturned,
    orders,
    lines: Object.fromEntries(
      SKU_PNL_LINES.map((l) => [
        l,
        { amount: r(lines[l].amount), estimated: r(lines[l].estimated) },
      ]),
    ) as Record<SkuPnlLine, SkuPnlAmount>,
    sales: r(sales),
    revenue: r(sum(SKU_PNL_REVENUE)),
    marketplace: r(sum(SKU_PNL_FEES)),
    cogs: r(lines.cogs.amount),
    ads: r(ads),
    profit: anyProfit ? r(profit) : null,
    margin: anyProfit ? percent(profit, sales) : null,
    profitPerUnit: anyProfit && unitsSold ? r(divRound(profit, BigInt(unitsSold))) : null,
    tacos: percent(-ads, sales),
    actualShare: all === 0n ? null : percent(actualWeighted, all),
    costMissing: rows.some((x) => x.costMissing),
    feesUnknown: rows.some((x) => x.feesUnknown),
    unconverted,
  };
}

export type WaterfallStep = {
  line: SkuPnlLine | "profit";
  label: string;
  amount: string;
  estimated: string;
  /** The running total after it. */
  after: string;
};

/** One SKU's lines in order, each with the running total: the waterfall. Zero lines left out. */
export function skuWaterfall(row: SkuPnl): WaterfallStep[] {
  let running = 0n;
  const steps: WaterfallStep[] = [];
  for (const l of SKU_PNL_LINES) {
    const value = parseDecimal(row.lines[l].amount);
    if (value === 0n) continue;
    running += value;
    steps.push({
      line: l,
      label: SKU_PNL_LABELS[l].label,
      amount: row.lines[l].amount,
      estimated: row.lines[l].estimated,
      after: formatDecimal(running),
    });
  }
  steps.push({
    line: "profit",
    label: "Profit",
    amount: formatDecimal(running),
    estimated: "0",
    after: formatDecimal(running),
  });
  return steps;
}

// --- Reading each marketplace's rows by SKU -----------------------------------------------

/** An Amazon settlement line's kind, for a SKU (fees split into referral, fulfilment, other). */
export function amazonSkuKind(
  line: Pick<SettlementLine, "transactionType" | "amountType" | "amountDescription">,
): SkuMoneyKind {
  const group = settlementGroup(line);
  const ad = line.amountDescription.toLowerCase().replace(/[\s_-]/g, "");
  switch (group) {
    case "sales":
      return /principal|itemprice/.test(ad) || line.amountType.toLowerCase() === "other"
        ? "sales"
        : "shipping";
    case "fees":
      if (/refundcommission/.test(ad)) return "otherFees";
      if (/commission|referral/.test(ad)) return "referral";
      if (/fba|fulfil|pickpack|weightbased|perunit|perorder/.test(ad)) return "fulfilment";
      return "otherFees";
    case "tax":
    case "reserve":
      return "ignore";
    default:
      return group;
  }
}

/** A Noon transaction row as money rows by kind (payouts left out). Order rows are one unit each. */
export function noonSkuRows(row: {
  orderNr: string | null;
  sku: string | null;
  partnerSku: string | null;
  transactionDate: string;
  transactionType: string;
  advertising: boolean;
  amounts: Record<NoonAmountField, string>;
  total: string;
}): Omit<SkuMoneyRow, "orderElsewhere">[] {
  const type = noonTypeKey(row.transactionType);
  if (type === "payment") return [];
  const base = {
    orderRef: row.orderNr,
    sku: row.partnerSku ?? row.sku,
    date: row.transactionDate,
    quantity: 0,
  };
  if (type === "balance_transfer" || type === "statement_fee") {
    const kind: SkuMoneyKind =
      type === "balance_transfer" ? "other" : row.advertising ? "advertising" : "otherFees";
    return [{ ...base, kind, amount: row.total }];
  }
  const a = (f: NoonAmountField) => parseDecimal(row.amounts[f]);
  const columns = NOON_AMOUNT_FIELDS.reduce((t, f) => t + a(f), 0n);
  const parts: [SkuMoneyKind, bigint][] = [
    [type === "order_update" ? "refunds" : "sales", a("netProceeds")],
    ["referral", a("referralFee")],
    ["fulfilment", a("fulfilmentFee")],
    ["shipping", a("shippingCredits")],
    ["otherFees", a("otherOrderFees") + a("nonOrderFees")],
    ["promotions", a("orderSubsidies") + a("nonOrderSubsidies")],
    ["other", a("others") + (parseDecimal(row.total) - columns)],
  ];
  return parts
    .filter(([, v]) => v !== 0n)
    .map(([kind, v]) => ({
      ...base,
      kind,
      amount: formatDecimal(v),
      quantity: kind === "sales" && type === "order" ? 1 : 0,
    }));
}

/** An eBay finances row as money rows: the sale (or refund) before fees, and the fees. */
export function ebaySkuRows(row: {
  orderId: string | null;
  transactionDate: string;
  transactionType: string;
  feeType: string | null;
  amount: string;
  fees: string;
}): Omit<SkuMoneyRow, "orderElsewhere">[] {
  const type = row.transactionType.toUpperCase();
  if (EBAY_TRANSFER_TYPES.has(type)) return [];
  const amount = parseDecimal(row.amount);
  const fees = parseDecimal(row.fees);
  const feePart = amount >= 0n ? -fees : fees;
  const rest = amount - feePart;
  const kind: SkuMoneyKind =
    type === "SALE"
      ? "sales"
      : type === "REFUND" || type === "DISPUTE"
        ? "refunds"
        : type === "SHIPPING_LABEL"
          ? "otherFees"
          : type === "CREDIT"
            ? "reimbursements"
            : type === "NON_SALE_CHARGE"
              ? EBAY_ADVERTISING_FEE.test(row.feeType ?? "")
                ? "advertising"
                : "otherFees"
              : "other";
  const base = { orderRef: row.orderId, sku: null, date: row.transactionDate, quantity: 0 };
  return [
    { ...base, kind, amount: formatDecimal(rest) },
    { ...base, kind: "referral" as const, amount: formatDecimal(feePart) },
  ].filter((r) => parseDecimal(r.amount) !== 0n);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();

/** A Walmart report's order, SKU and quantity columns, when it has them. */
export function walmartSkuColumns(columns: readonly string[]): {
  order: string | null;
  sku: string | null;
  quantity: string | null;
} {
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const found = columns.find((c) => p.test(norm(c)));
      if (found) return found;
    }
    return null;
  };
  return {
    order: find(/^walmart com po #$/, /^po #$/, /^purchase order/, /^po number$/, /po #/),
    sku: find(/^partner item id$/, /^seller sku$/, /^sku$/, /^partner sku$/),
    quantity: find(/^qty$/, /^quantity$/, /^shipped qty$/),
  };
}

/** A Walmart settlement row as a money row (payouts and sales tax left out). */
export function walmartSkuRow(
  row: Record<string, string>,
  layout: WalmartLayout,
  columns: ReturnType<typeof walmartSkuColumns>,
  date: string,
): Omit<SkuMoneyRow, "orderElsewhere"> | null {
  const raw = row[layout.amount]?.trim();
  const amount = raw ? walmartAmount(raw) : null;
  if (amount === null) return null;
  const group = walmartRowGroup(row, layout);
  const amountType = layout.amountType ? norm(row[layout.amountType] ?? "") : "";
  const kind: SkuMoneyKind =
    group === "payout" || group === "tax"
      ? "ignore"
      : group === "fees"
        ? /commission|referral/.test(amountType)
          ? "referral"
          : "otherFees"
        : group === "shipping"
          ? "otherFees"
          : group;
  const cell = (c: string | null) => (c ? (row[c] ?? "").trim() : "");
  const quantity = Number.parseInt(cell(columns.quantity), 10);
  return {
    orderRef: cell(columns.order) || null,
    sku: cell(columns.sku) || null,
    date,
    kind,
    amount,
    quantity: kind === "sales" && Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
  };
}

// --- CSV ----------------------------------------------------------------------------------

export const SKU_PNL_COLUMNS = [
  "Channel",
  "Currency",
  "SKU",
  "Product",
  "Units sold",
  "Units returned",
  "Orders",
  ...SKU_PNL_LINES.map((l) => SKU_PNL_LABELS[l].label),
  "Profit",
  "Margin %",
  "Profit per unit",
  "TACOS %",
  "Actual %",
  "Estimated amounts",
] as const;

/** SKU profit and loss as CSV rows (without the file's header lines). */
export function skuPnlCsvRows(
  groups: readonly { name: string; currency: string; rows: readonly SkuPnl[] }[],
  amount: (value: string | null, currency: string) => string,
): string[][] {
  const pct = (v: number | null) => (v === null ? "" : v.toFixed(1));
  return groups.flatMap((g) =>
    g.rows.map((r) => [
      g.name,
      g.currency,
      r.sku,
      r.sku ? (r.label ?? "") : "Not tied to one product",
      String(r.unitsSold),
      String(r.unitsReturned),
      String(r.orders),
      ...SKU_PNL_LINES.map((l) => amount(r.lines[l].amount, g.currency)),
      amount(r.profit, g.currency),
      pct(r.margin),
      amount(r.profitPerUnit, g.currency),
      pct(r.tacos),
      pct(r.actualShare),
      amount(
        formatDecimal(SKU_PNL_LINES.reduce((t, l) => t + parseDecimal(r.lines[l].estimated), 0n)),
        g.currency,
      ),
    ]),
  );
}

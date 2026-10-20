import { parseCsv } from "../import/csv";
import { formatDecimal, parseDecimal } from "../money";
import { AMAZON_MARKETPLACES } from "./amazon";
import type { AmazonOrder, AmazonOrderItem } from "./orders";
import { readSettlementAmount, type Settlement, type SettlementLine } from "./settlements";

/**
 * Amazon's date range transaction report (Payments → Reports Repository → Transaction, "Custom
 * date range"): one CSV row per order, refund, fee or transfer, each with its settlement ID, for
 * as many years back as the seller asks. Settlement flat files only go back so far and come one
 * by one; this one file rebuilds every settlement in it.
 *
 * Each row's money columns become lines named like the flat file's (transaction type, amount
 * type, description), so `settlementGroup` sorts them the same way: product sales are
 * ItemPrice / Principal, selling fees ItemFees / Commission, and so on. Fee, adjustment and
 * service rows keep Amazon's own type and description ("Service Fee", "Cost of Advertising").
 * Transfer rows are payouts, not earnings: they're left out, and give the settlement they pay
 * its deposit date. When a payout differs from the period's total, Amazon held some back or
 * released what it held before: the difference becomes the flat file's reserve lines, so each
 * closed settlement's total is what reached the bank.
 */

/** Order and refund columns, as the flat file names them. Unknown money columns go to Other. */
const ORDER_COLUMNS: Record<string, [amountType: string, description: string]> = {
  "product sales": ["ItemPrice", "Principal"],
  "product sales tax": ["ItemPrice", "Tax"],
  "shipping credits": ["ItemPrice", "Shipping"],
  "shipping credits tax": ["ItemPrice", "ShippingTax"],
  "gift wrap credits": ["ItemPrice", "GiftWrap"],
  "giftwrap credits tax": ["ItemPrice", "GiftWrapTax"],
  "gift wrap credits tax": ["ItemPrice", "GiftWrapTax"],
  "regulatory fee": ["ItemPrice", "RegulatoryFee"],
  "tax on regulatory fee": ["ItemPrice", "RegulatoryFeeTax"],
  "promotional rebates": ["Promotion", "Principal"],
  "promotional rebates tax": ["Promotion", "Tax"],
  "marketplace withheld tax": ["ItemWithheldTax", "MarketplaceFacilitatorTax-Principal"],
  "selling fees": ["ItemFees", "Commission"],
  "fba fees": ["ItemFees", "FBAPerUnitFulfillmentFee"],
  "other transaction fees": ["ItemFees", "Other transaction fees"],
};

/** Columns that aren't money (everything else between them and "total" is). */
const TEXT_COLUMNS = new Set([
  "date/time",
  "settlement id",
  "type",
  "order id",
  "sku",
  "description",
  "quantity",
  "marketplace",
  "account type",
  "fulfillment",
  "fulfilment",
  "order city",
  "order state",
  "order postal",
  "tax collection model",
  "total",
]);

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
/** Hours to add to the local time to get UTC. */
const ZONES: Record<string, number> = {
  utc: 0,
  gmt: 0,
  bst: -1,
  cet: -1,
  cest: -2,
  gst: -4,
  ast: -3,
  pst: 8,
  pdt: 7,
  mst: 7,
  mdt: 6,
  cst: 6,
  cdt: 5,
  est: 5,
  edt: 4,
};

/**
 * The report's dates: "6 Oct 2023 8:41:29 PM UTC" (most marketplaces) or "Oct 6, 2023 8:41:29
 * PM PDT" (Amazon.com and .ca). Returns an ISO timestamp, or null.
 */
export function readReportDate(raw: string): string | null {
  const t = raw.trim().replace(/,/g, "");
  const m =
    /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?(AM|PM)?(?: ([A-Za-z]+))?/i.exec(
      t,
    ) ??
    /^([A-Za-z]{3})[a-z]* (\d{1,2}) (\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?(AM|PM)?(?: ([A-Za-z]+))?/i.exec(
      t,
    );
  if (!m) return null;
  const monthFirst = /^[A-Za-z]/.test(m[1] ?? "");
  const day = Number(monthFirst ? m[2] : m[1]);
  const month = MONTHS[String(monthFirst ? m[1] : m[2]).toLowerCase()];
  if (month === undefined) return null;
  let hour = Number(m[4]) % 12;
  if ((m[7] ?? "").toUpperCase() === "PM") hour += 12;
  else if (!m[7]) hour = Number(m[4]);
  const offset = ZONES[(m[8] ?? "utc").toLowerCase()] ?? 0;
  const at = new Date(
    Date.UTC(Number(m[3]), month, day, hour + offset, Number(m[5]), Number(m[6])),
  );
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

const marketplaceOf = (raw: string) =>
  AMAZON_MARKETPLACES.find((m) => m.name.toLowerCase() === raw.trim().toLowerCase()) ?? null;

type Building = {
  sums: Map<string, SettlementLine & { units: bigint }>;
  total: bigint;
  orders: Set<string>;
  places: Map<string, number>;
  first: string;
  last: string;
};

/** True when the text looks like the date range transaction report. */
export function isTransactionReport(text: string): boolean {
  return /"?date\/time"?,\s*"?settlement id"?/i.test(text.slice(0, 5000));
}

/**
 * Every settlement in the report, oldest first. Throws, in plain words, on a file that isn't
 * the report or has no settlements.
 */
export function parseTransactionReport(text: string): Settlement[] {
  const rows = parseCsv(text.replace(/^﻿/, ""), ",");
  const headerAt = rows.findIndex((r) => (r[0] ?? "").trim().toLowerCase() === "date/time");
  const header = (rows[headerAt] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const at = {
    date: col("date/time"),
    settlement: col("settlement id"),
    type: col("type"),
    order: col("order id"),
    description: col("description"),
    marketplace: col("marketplace"),
    total: col("total"),
  };
  if (headerAt < 0 || at.settlement < 0 || at.type < 0 || at.total < 0) {
    throw new Error(
      "This isn't Amazon's transaction report. In Seller Central → Payments → Reports Repository, request a Transaction report for a custom date range.",
    );
  }
  const money = header
    .map((name, i) => ({ name, i }))
    .filter((c) => c.name && !TEXT_COLUMNS.has(c.name));
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  const built = new Map<string, Building>();
  const transfers: { at: string; amount: bigint }[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const id = cell(row, at.settlement);
    const when = readReportDate(cell(row, at.date));
    const total = readSettlementAmount(cell(row, at.total));
    if (!id || !when || total === null) continue;
    const type = cell(row, at.type) || "Other";
    if (/^transfer$/i.test(type)) {
      transfers.push({ at: when, amount: parseDecimal(total) });
      continue;
    }
    const s = built.get(id) ?? {
      sums: new Map(),
      total: 0n,
      orders: new Set<string>(),
      places: new Map(),
      first: when,
      last: when,
    };
    built.set(id, s);
    s.total += parseDecimal(total);
    if (when < s.first) s.first = when;
    if (when > s.last) s.last = when;
    const place = cell(row, at.marketplace);
    if (place) s.places.set(place, (s.places.get(place) ?? 0) + 1);
    const description = cell(row, at.description) || type;
    const isOrder = /^(order|refund)/i.test(type);
    if (isOrder && /^order/i.test(type) && cell(row, at.order)) s.orders.add(cell(row, at.order));
    const add = (amountType: string, amountDescription: string, amount: bigint) => {
      if (amount === 0n) return;
      const transactionType = type;
      const key = `${transactionType}\u0000${amountType}\u0000${amountDescription}`;
      const sum = s.sums.get(key) ?? {
        transactionType,
        amountType,
        amountDescription,
        amount: "0",
        count: 0,
        units: 0n,
      };
      sum.units += amount;
      sum.count++;
      s.sums.set(key, sum);
    };
    if (isOrder) {
      for (const c of money) {
        const value = readSettlementAmount(cell(row, c.i));
        if (value === null) continue;
        // A column with no flat-file name keeps its own ("other"), not the product's.
        const [amountType, name] = ORDER_COLUMNS[c.name] ?? ["Other", c.name];
        add(amountType, name, parseDecimal(value));
      }
    } else {
      // A fee, adjustment or service row: one line, named by Amazon's type and description.
      add(type, description, parseDecimal(total));
    }
  }
  if (!built.size) throw new Error("The report has no settlements in it.");

  const ordered = [...built.entries()].sort((a, b) => a[1].last.localeCompare(b[1].last));
  // Each transfer pays the settlement that closed last before it.
  const paid = new Map<string, { amount: bigint; at: string | null }>();
  for (const t of transfers) {
    const owner = ordered.filter(([, s]) => s.last <= t.at).at(-1);
    if (!owner) continue;
    const p = paid.get(owner[0]) ?? { amount: 0n, at: null };
    p.amount += -t.amount;
    if (!p.at || t.at > p.at) p.at = t.at;
    paid.set(owner[0], p);
  }
  const lastTransfer = transfers.reduce<string | null>(
    (latest, t) => (!latest || t.at > latest ? t.at : latest),
    null,
  );

  // What Amazon held back: the payout is the period's total plus what it released from the
  // last period, less what it held this time. The report has no rows for it, so it comes from
  // the payouts: a settlement is closed once a transfer follows it.
  let held = 0n;
  return ordered.map(([settlementId, s]) => {
    const lines: SettlementLine[] = [...s.sums.values()].map(({ units, ...l }) => ({
      ...l,
      amount: formatDecimal(units),
    }));
    const place = [...s.places.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const market = marketplaceOf(place);
    const payout = paid.get(settlementId);
    const closed = lastTransfer !== null && lastTransfer >= s.last;
    let total = s.total;
    if (closed) {
      const released = held;
      held = released + s.total - (payout?.amount ?? 0n);
      const reserve = (description: string, units: bigint) => {
        if (units !== 0n) {
          lines.push({
            transactionType: "Other",
            amountType: "Other",
            amountDescription: description,
            amount: formatDecimal(units),
            count: 1,
          });
        }
      };
      reserve("Previous Reserve Amount Balance", released);
      reserve("Current Reserve Amount", -held);
      total = payout?.amount ?? 0n;
    }
    return {
      settlementId: settlementId.slice(0, 100),
      startAt: s.first,
      endAt: s.last,
      depositDate: payout?.at ? payout.at.slice(0, 10) : null,
      total: formatDecimal(total),
      currency: market?.currency ?? "",
      marketplace: market?.name ?? (place.slice(0, 100) || null),
      lines,
      orderCount: s.orders.size,
      balanced: lines.reduce((sum, l) => sum + parseDecimal(l.amount), 0n) === total,
    };
  });
}

/** One marketplace's orders from the report, each with its items (by SKU). */
export type ReportOrders = {
  marketplace: string;
  currency: string;
  orders: { order: AmazonOrder; items: AmazonOrderItem[] }[];
};

/**
 * The orders in the report, by marketplace: each order's SKUs, quantities and what the buyer
 * paid, for the years before Amazon's Orders API reaches (it goes back about two years). An order
 * is dated when it settled (its first Order row), which is when it shipped; refunds aren't
 * orders and are left out. Throws on a file that isn't the report.
 */
export function parseTransactionReportOrders(text: string): ReportOrders[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""), ",");
  const headerAt = rows.findIndex((r) => (r[0] ?? "").trim().toLowerCase() === "date/time");
  const header = (rows[headerAt] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const at = {
    date: col("date/time"),
    type: col("type"),
    order: col("order id"),
    sku: col("sku"),
    description: col("description"),
    quantity: col("quantity"),
    marketplace: col("marketplace"),
    fulfillment: header.indexOf("fulfillment") >= 0 ? col("fulfillment") : col("fulfilment"),
    sales: col("product sales"),
    shipping: col("shipping credits"),
    promotions: col("promotional rebates"),
  };
  if (headerAt < 0 || at.type < 0 || at.order < 0 || at.sku < 0) {
    throw new Error(
      "This isn't Amazon's transaction report. In Seller Central → Payments → Reports Repository, request a Transaction report for a custom date range.",
    );
  }
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
  const units = (row: string[], i: number) =>
    parseDecimal(readSettlementAmount(cell(row, i)) ?? "0");

  type Item = { title: string; quantity: number; price: bigint; shipping: bigint; promo: bigint };
  type Building = { at: string; place: string; amazon: boolean; items: Map<string, Item> };
  const byOrder = new Map<string, Building>();
  for (const row of rows.slice(headerAt + 1)) {
    if (!/^order$/i.test(cell(row, at.type))) continue;
    const id = cell(row, at.order);
    const sku = cell(row, at.sku);
    const when = readReportDate(cell(row, at.date));
    if (!id || !sku || !when) continue;
    const o = byOrder.get(id) ?? {
      at: when,
      place: cell(row, at.marketplace),
      amazon: /amazon/i.test(cell(row, at.fulfillment)),
      items: new Map<string, Item>(),
    };
    if (when < o.at) o.at = when;
    const item = o.items.get(sku) ?? {
      title: cell(row, at.description),
      quantity: 0,
      price: 0n,
      shipping: 0n,
      promo: 0n,
    };
    item.quantity += Math.trunc(Number(cell(row, at.quantity)) || 0);
    item.price += units(row, at.sales);
    item.shipping += units(row, at.shipping);
    item.promo += units(row, at.promotions);
    o.items.set(sku, item);
    byOrder.set(id, o);
  }

  const result = new Map<string, ReportOrders>();
  for (const [orderId, o] of byOrder) {
    const market = marketplaceOf(o.place);
    if (!market) continue;
    const group = result.get(market.name) ?? {
      marketplace: market.name,
      currency: market.currency,
      orders: [],
    };
    result.set(market.name, group);
    const items = [...o.items.entries()].map(([sku, i]) => ({
      itemId: `report:${sku}`,
      asin: "",
      sku,
      title: i.title.slice(0, 500) || null,
      quantityOrdered: i.quantity,
      quantityShipped: i.quantity,
      itemPrice: formatDecimal(i.price),
      itemTax: null,
      shippingPrice: formatDecimal(i.shipping),
      shippingTax: null,
      promotionDiscount: formatDecimal(-i.promo),
    }));
    const total = [...o.items.values()].reduce(
      (sum, i) => sum + i.price + i.shipping + i.promo,
      0n,
    );
    const shipped = items.reduce((n, i) => n + i.quantityShipped, 0);
    group.orders.push({
      order: {
        orderId: orderId.slice(0, 100),
        marketplaceId: market.id,
        purchasedAt: o.at,
        lastUpdatedAt: o.at,
        status: "Shipped",
        fulfillment: o.amazon ? "amazon" : "merchant",
        currency: market.currency,
        total: formatDecimal(total),
        itemsShipped: shipped,
        itemsUnshipped: 0,
        shipCountry: null,
        shipRegion: null,
        isBusiness: false,
        isPrime: false,
        isReplacement: false,
        earliestDelivery: null,
        latestDelivery: null,
      },
      items,
    });
  }
  for (const g of result.values())
    g.orders.sort((a, b) => a.order.purchasedAt.localeCompare(b.order.purchasedAt));
  return [...result.values()];
}

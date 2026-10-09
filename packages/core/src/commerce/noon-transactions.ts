import { parseCsv } from "../import/csv";
import { formatDecimal, parseDecimal } from "../money";
import { readSettlementAmount } from "./settlements";

/**
 * Noon's item-level transaction view (Noon's export `noon_financeweb_transactionviewreportonitemlevel`,
 * or the same file from Noon's seller portal → Finance → Transaction view). One row per sale,
 * update, fee, refund or subsidy, in the currency of the country it happened in. Amounts carry
 * VAT; Total is what the row adds to (or takes from) the seller's payouts. There is no payout or
 * statement number: rows are kept one by one and grouped by date.
 */

/** The money columns, in the order Noon prints them. */
export const NOON_AMOUNT_FIELDS = [
  "netProceeds",
  "referralFee",
  "fulfilmentFee",
  "shippingCredits",
  "otherOrderFees",
  "orderSubsidies",
  "nonOrderFees",
  "nonOrderSubsidies",
  "others",
] as const;
export type NoonAmountField = (typeof NOON_AMOUNT_FIELDS)[number];

export const NOON_AMOUNT_LABELS: Record<NoonAmountField | "total", string> = {
  netProceeds: "Net proceeds (sales)",
  referralFee: "Referral fee",
  fulfilmentFee: "Fulfilment & logistics fees",
  shippingCredits: "Shipping credits",
  otherOrderFees: "Other order fees",
  orderSubsidies: "Order subsidies",
  nonOrderFees: "Non-order fees",
  nonOrderSubsidies: "Non-order subsidies",
  others: "Others",
  total: "Total",
};

export type NoonTransaction = {
  contract: string | null;
  referenceNr: string;
  orderNr: string | null;
  itemNr: string | null;
  /** YYYY-MM-DD. */
  orderDate: string | null;
  transactionDate: string;
  title: string | null;
  sku: string | null;
  partnerSku: string | null;
  transactionType: string;
  currency: string;
  amounts: Record<NoonAmountField, string>;
  total: string;
  /** The money columns add up to Total. */
  balanced: boolean;
  /** Same for the same row in any copy of the report, so bringing it in twice adds it once. */
  key: string;
};

export type NoonTransactionsParse =
  | {
      ok: true;
      rows: NoonTransaction[];
      /** Rows left out: no reference, date, type, currency or total that can be read. */
      skipped: number;
      from: string | null;
      to: string | null;
    }
  | { ok: false; error: string };

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/includingvat|inclvat|incvat|withvat$/g, "");

/** Which column holds what, by Noon's header names (spelling and order may vary). */
function columnFor(header: string): keyof typeof COLUMN_TESTS | null {
  const h = norm(header);
  for (const [field, test] of Object.entries(COLUMN_TESTS)) {
    if (test(h)) return field as keyof typeof COLUMN_TESTS;
  }
  return null;
}

const COLUMN_TESTS = {
  contractTitle: (h: string) => h === "contracttitle",
  contract: (h: string) => h === "contract",
  referenceNr: (h: string) => /^reference(nr|no|number|id)?$/.test(h),
  orderNr: (h: string) => /^order(nr|no|number|id)$/.test(h),
  itemNr: (h: string) => /^item(nr|no|number|id)$/.test(h),
  orderDate: (h: string) => h === "orderdate",
  transactionDate: (h: string) => /^transaction(date|time|datetime)$/.test(h),
  title: (h: string) => h === "title" || h === "producttitle",
  partnerSku: (h: string) => /^partnerskus?$/.test(h),
  sku: (h: string) => /^skus?$/.test(h),
  transactionType: (h: string) => h === "transactiontype",
  currency: (h: string) => h === "currency" || h === "currencycode",
  netProceeds: (h: string) => h === "netproceeds",
  referralFee: (h: string) => /^referralfees?$/.test(h),
  fulfilmentFee: (h: string) => /^ful+fil+ment(and)?logisticsfees?$/.test(h),
  shippingCredits: (h: string) => /^shippingcredits?$/.test(h),
  otherOrderFees: (h: string) => /^otherorderfees?$/.test(h),
  orderSubsidies: (h: string) => /^ordersubsid(y|ies)$/.test(h),
  nonOrderFees: (h: string) => /^nonorderfees?$/.test(h),
  nonOrderSubsidies: (h: string) => /^nonordersubsid(y|ies)$/.test(h),
  others: (h: string) => h === "others" || h === "other",
  total: (h: string) => h === "total" || h === "totalamount",
} as const;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Noon's dates: "2026-10-01", "2026-10-01 14:03:00", "01/10/2026" and "01-10-2026" (day first,
 * as Noon prints them), "01-Oct-2026", "1 Oct 2026", "Oct 1, 2026". YYYY-MM-DD, or null.
 */
export function readNoonDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const pad = (n: string | number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return ok(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v);
  if (m) return ok(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})/.exec(v);
  if (m) return ok(Number(m[3]), MONTHS.indexOf(m[2]?.toLowerCase() ?? "") + 1, Number(m[1]));
  m = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/.exec(v);
  if (m) return ok(Number(m[3]), MONTHS.indexOf(m[1]?.toLowerCase() ?? "") + 1, Number(m[2]));
  return null;
}

/** Parses the transaction view (CSV or TSV). Errors in plain words when it isn't one. */
export function parseNoonTransactions(text: string): NoonTransactionsParse {
  const table = parseCsv(text.replace(/^﻿/, ""));
  const [header, ...data] = table;
  if (!header?.length) return { ok: false, error: "The file is empty." };
  const at = new Map<string, number>();
  header.forEach((h, i) => {
    const field = columnFor(h);
    if (field && !at.has(field)) at.set(field, i);
  });
  const missing = ["referenceNr", "transactionType", "transactionDate", "currency", "total"].filter(
    (f) => !at.has(f),
  );
  if (missing.length) {
    return {
      ok: false,
      error:
        "This isn't Noon's transaction view. Download it from Noon's seller portal → Finance → Transaction view, or bring it in from Noon on this page.",
    };
  }
  const cell = (row: string[], field: string) => {
    const i = at.get(field);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const seen = new Map<string, number>();
  const rows: NoonTransaction[] = [];
  let skipped = 0;
  for (const row of data) {
    if (row.every((c) => !c.trim())) continue;
    const referenceNr = cell(row, "referenceNr");
    const transactionType = cell(row, "transactionType");
    const transactionDate = readNoonDate(cell(row, "transactionDate"));
    const currency = cell(row, "currency").toUpperCase();
    const total = readSettlementAmount(cell(row, "total"));
    if (
      !referenceNr ||
      !transactionType ||
      !transactionDate ||
      !/^[A-Z]{3}$/.test(currency) ||
      total === null
    ) {
      skipped++;
      continue;
    }
    const amounts = Object.fromEntries(
      NOON_AMOUNT_FIELDS.map((f) => [f, readSettlementAmount(cell(row, f)) ?? "0"]),
    ) as Record<NoonAmountField, string>;
    const sum = NOON_AMOUNT_FIELDS.reduce((t, f) => t + parseDecimal(amounts[f]), 0n);
    const fields = {
      contract: (cell(row, "contractTitle") || cell(row, "contract")).slice(0, 200) || null,
      referenceNr: referenceNr.slice(0, 200),
      orderNr: cell(row, "orderNr").slice(0, 200) || null,
      itemNr: cell(row, "itemNr").slice(0, 200) || null,
      orderDate: readNoonDate(cell(row, "orderDate")),
      transactionDate,
      title: cell(row, "title").slice(0, 500) || null,
      sku: cell(row, "sku").slice(0, 200) || null,
      partnerSku: cell(row, "partnerSku").slice(0, 200) || null,
      transactionType: transactionType.slice(0, 100),
      currency,
    };
    const base = [
      fields.referenceNr,
      fields.itemNr,
      fields.orderNr,
      fields.transactionType,
      fields.transactionDate,
      fields.currency,
      cell(row, "contract"),
    ].join("|");
    // Rows alike in all of these are still separate rows: number them within the file.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({
      ...fields,
      amounts,
      total,
      balanced: sum === parseDecimal(total),
      key: `${base}|${n}`,
    });
  }
  const dates = rows.map((r) => r.transactionDate).sort();
  return { ok: true, rows, skipped, from: dates[0] ?? null, to: dates.at(-1) ?? null };
}

/** A month (YYYY-MM-01) and the one after, for asking Noon a month at a time. */
export function monthRange(day: string): { from: string; to: string } {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

/** Sums of each money column over rows (amounts as decimal strings). */
export function sumNoonAmounts(
  rows: readonly Pick<NoonTransaction, "amounts" | "total">[],
): Record<NoonAmountField | "total", string> {
  const units = Object.fromEntries([...NOON_AMOUNT_FIELDS, "total"].map((f) => [f, 0n])) as Record<
    NoonAmountField | "total",
    bigint
  >;
  for (const r of rows) {
    for (const f of NOON_AMOUNT_FIELDS) units[f] += parseDecimal(r.amounts[f]);
    units.total += parseDecimal(r.total);
  }
  return Object.fromEntries(Object.entries(units).map(([k, v]) => [k, formatDecimal(v)])) as Record<
    NoonAmountField | "total",
    string
  >;
}

/** How far back bringing Noon's transactions in starts: the first of the month a year ago. */
export const NOON_HISTORY_MONTHS = 12;
/** Once caught up, the last three weeks are read again (Noon adds late fees and updates). */
export const NOON_REFRESH_DAYS = 21;
/** ...at most this often. */
export const NOON_REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;

const isoAddDays = (day: string, days: number) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * The next days to ask Noon for, given how far in the company is (`through`) and today's date
 * in its time zone: a calendar month at a time from a year back up to yesterday; once caught up,
 * the last three weeks again when they were last read over six hours ago. Null: nothing to do.
 */
export function nextNoonWindow(
  state: { through: string | null; refreshedAt: string | null },
  today: string,
  now = Date.now(),
): { from: string; to: string; refresh: boolean } | null {
  const yesterday = isoAddDays(today, -1);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1 - NOON_HISTORY_MONTHS, 1)).toISOString().slice(0, 10);
  const next = state.through && state.through >= start ? isoAddDays(state.through, 1) : start;
  if (next <= yesterday) {
    const month = monthRange(next);
    return { from: next, to: month.to < yesterday ? month.to : yesterday, refresh: false };
  }
  const refreshed = state.refreshedAt ? Date.parse(state.refreshedAt) : 0;
  if (now - refreshed < NOON_REFRESH_EVERY_MS) return null;
  const from = isoAddDays(yesterday, 1 - NOON_REFRESH_DAYS);
  return { from: from < start ? start : from, to: yesterday, refresh: true };
}

import { parseCsv } from "../import/csv";
import { formatDecimal, parseDecimal } from "../money";
import type { EbayPayout, EbayTransaction } from "./ebay-finances";

/**
 * eBay's transaction report (Seller Hub → Payments → Reports → Transaction report, CSV): the
 * same money as the Finances API, for sellers who can't use the API (EU and UK sellers' calls
 * must be signed) or want to fill in history. Rows come out as `EbayTransaction`s keyed
 * `report:…` (the report has no API transaction id), and Payout rows as `EbayPayout`s (their
 * ids are eBay's payout ids). Columns are found by name, since sellers can add and remove them;
 * eBay's lines above the table are skipped. No buyer details are read.
 */

export type EbayReportParse =
  | {
      ok: true;
      transactions: EbayTransaction[];
      payouts: EbayPayout[];
      /** Rows that couldn't be read (no date, type or amount). */
      skipped: number;
      /** Rows that aren't money moving (holds and the like). */
      ignored: number;
    }
  | { ok: false; error: string };

/** The report's Type → the Finances API's transaction type; null: not kept. */
const TYPES: Record<string, string | null> = {
  order: "SALE",
  sale: "SALE",
  refund: "REFUND",
  claim: "DISPUTE",
  "payment dispute": "DISPUTE",
  dispute: "DISPUTE",
  "other fee": "NON_SALE_CHARGE",
  charge: "NON_SALE_CHARGE",
  fee: "NON_SALE_CHARGE",
  "shipping label": "SHIPPING_LABEL",
  credit: "CREDIT",
  transfer: "TRANSFER",
  adjustment: "ADJUSTMENT",
  withdrawal: "WITHDRAWAL",
  "loan repayment": "LOAN_REPAYMENT",
  purchase: "PURCHASE",
  hold: null,
  "hold release": null,
};

const norm = (s: string) => s.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

/** The column names this reads, each with the names eBay has used for it. */
const COLUMNS = {
  date: ["transaction creation date", "transaction date", "date"],
  type: ["type", "transaction type"],
  order: ["order number", "order id"],
  net: ["net amount", "amount"],
  payoutCurrency: ["payout currency"],
  transactionCurrency: ["transaction currency", "currency"],
  payoutId: ["payout id"],
  payoutDate: ["payout date"],
  payoutStatus: ["payout status"],
  itemId: ["item id"],
  lineId: ["transaction id"],
  reference: ["reference id"],
  description: ["description"],
  ebayTax: ["ebay collected tax"],
} as const;
type Column = keyof typeof COLUMNS;

const abs = (n: bigint) => (n < 0n ? -n : n);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date as eBay prints it in the report: "Jul 6, 2026", "06-Jul-2026", "6 Jul 2026",
 * "2026-07-06" or "06.07.2026", optionally with a time after. Returns YYYY-MM-DD, or null.
 */
export function readEbayReportDate(raw: string): string | null {
  const t = raw.trim();
  const pad = (n: string | number) => String(n).padStart(2, "0");
  const ok = (y: string, m: number, d: string) => {
    const day = Number(d);
    if (m < 1 || m > 12 || day < 1 || day > 31) return null;
    return `${y}-${pad(m)}-${pad(day)}`;
  };
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m?.[1] && m[2] && m[3]) return ok(m[1], Number(m[2]), m[3]);
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})/.exec(t);
  if (m?.[1] && m[2] && m[3]) return ok(m[3], month(m[1]), m[2]);
  m = /^(\d{1,2})[- ]([A-Za-z]{3,9})\.?[- ](\d{2,4})/.exec(t);
  if (m?.[1] && m[2] && m[3]) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return ok(y, month(m[2]), m[1]);
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  if (m?.[1] && m[2] && m[3]) return ok(m[3], Number(m[2]), m[1]);
  return null;
}

/**
 * An amount as eBay prints it: "12.34", "-12.34", "1,234.56", "$12.34", "-C $5.00", "(5.00)",
 * "1.234,56". "--" and blank are no amount (null).
 */
export function readEbayReportAmount(raw: string): string | null {
  let t = raw.trim();
  if (!t || /^-+$/.test(t)) return null;
  const negative = /^\(.*\)$/.test(t) || t.includes("-");
  t = t.replace(/[^\d.,]/g, "");
  if (!t) return null;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastComma > lastDot && /,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const units = parseDecimal(t);
  return formatDecimal(negative ? -units : units);
}

/** Payout statuses as the report words them → the API's. */
function payoutStatus(raw: string): string {
  const s = norm(raw);
  if (!s || s === "--" || /succeed|paid|complete|sent/.test(s)) return "SUCCEEDED";
  if (/revers/.test(s)) return "REVERSED";
  if (/retry/.test(s)) return "RETRYABLE_FAILED";
  if (/fail/.test(s)) return "TERMINAL_FAILED";
  return "INITIATED";
}

/** Finds the header row (the first with a date, a type and an amount column). */
function findHeader(table: string[][]): { index: number; at: Record<Column, number> } | null {
  for (let i = 0; i < Math.min(table.length, 30); i++) {
    const names = (table[i] ?? []).map(norm);
    const at = Object.fromEntries(
      (Object.keys(COLUMNS) as Column[]).map((c) => [
        c,
        COLUMNS[c].map((n) => names.indexOf(n)).find((n) => n >= 0) ?? -1,
      ]),
    ) as Record<Column, number>;
    if (at.date >= 0 && at.type >= 0 && at.net >= 0) return { index: i, at };
  }
  return null;
}

export function parseEbayTransactionReport(text: string): EbayReportParse {
  const body = text.replace(/^﻿/, "");
  if (!body.trim()) return { ok: false, error: "The file is empty." };
  let found: { table: string[][]; index: number; at: Record<Column, number> } | null = null;
  for (const delimiter of [",", ";", "\t"]) {
    const table = parseCsv(body, delimiter);
    const header = findHeader(table);
    if (header) {
      found = { table, ...header };
      break;
    }
  }
  if (!found) {
    return {
      ok: false,
      error:
        "This doesn't look like eBay's transaction report. In Seller Hub, go to Payments → Reports and download the Transaction report.",
    };
  }
  const { table, index, at } = found;
  const header = (table[index] ?? []).map(norm);
  // Fee columns ("Final Value Fee - fixed", "International fee"…): eBay's fees on an order.
  const feeColumns = header
    .map((name, i) => ({ name, i }))
    .filter(({ name }) => /\bfees?\b/.test(name) && !/^payout/.test(name))
    .map(({ i }) => i);

  const transactions: EbayTransaction[] = [];
  const payouts = new Map<string, EbayPayout>();
  const seen = new Map<string, number>();
  let skipped = 0;
  let ignored = 0;
  for (const row of table.slice(index + 1)) {
    const cell = (c: Column) => (at[c] >= 0 ? (row[at[c]] ?? "").trim() : "");
    const clean = (c: Column) => {
      const v = cell(c);
      return v && !/^-+$/.test(v) ? v : "";
    };
    if (row.every((v) => !v.trim())) continue;
    const typeName = norm(cell("type"));
    const date = readEbayReportDate(cell("date"));
    const net = readEbayReportAmount(cell("net"));
    const currency = (clean("payoutCurrency") || clean("transactionCurrency")).toUpperCase();
    if (!typeName || !date || net === null || !/^[A-Z]{3}$/.test(currency)) {
      skipped++;
      continue;
    }

    if (typeName === "payout") {
      const id = clean("payoutId");
      if (!id) {
        skipped++;
        continue;
      }
      const amount = parseDecimal(net);
      payouts.set(id, {
        payoutId: id,
        status: payoutStatus(cell("payoutStatus")),
        payoutDate: `${readEbayReportDate(clean("payoutDate")) ?? date}T00:00:00.000Z`,
        currency,
        amount: formatDecimal(abs(amount)),
        accountLast4: null,
      });
      continue;
    }

    if (!(typeName in TYPES)) {
      skipped++;
      continue;
    }
    const type = TYPES[typeName];
    if (!type) {
      ignored++;
      continue;
    }
    const isOrder = type === "SALE" || type === "REFUND";
    const fees = isOrder
      ? feeColumns.reduce((t, i) => {
          const v = readEbayReportAmount(row[i] ?? "");
          return v === null ? t : t + parseDecimal(v);
        }, 0n)
      : 0n;
    const tax = readEbayReportAmount(cell("ebayTax"));
    const description = clean("description");
    // A key that stays the same when the file comes in again, and a count for rows that repeat.
    const base = [
      type,
      date,
      clean("order"),
      clean("itemId"),
      clean("lineId"),
      clean("reference"),
      description,
      net,
      currency,
    ].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    transactions.push({
      transactionId: `report:${base}${n > 1 ? `#${n}` : ""}`,
      transactionType: type,
      status: null,
      transactionDate: `${date}T00:00:00.000Z`,
      orderId: clean("order") || null,
      payoutId: clean("payoutId") || null,
      feeType: type === "NON_SALE_CHARGE" && description ? description.slice(0, 200) : null,
      currency,
      amount: net,
      fees: formatDecimal(abs(fees)),
      ebayTax: formatDecimal(abs(tax === null ? 0n : parseDecimal(tax))),
    });
  }
  return { ok: true, transactions, payouts: [...payouts.values()], skipped, ignored };
}

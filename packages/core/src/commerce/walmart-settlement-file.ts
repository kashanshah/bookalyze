import { readCsvTable } from "../import/csv";
import { formatDecimal, parseDecimal } from "../money";

/**
 * One Walmart settlement (reconciliation) report, read so it can be kept row by row, as Walmart
 * sent it, before Bookalyze knows what every column means: each row keeps its columns by name.
 * Columns that could say who or where a buyer is (ship-to city, postal code, customer…) are
 * dropped, so nothing personal is kept. The settlement period, the payout and its currency are
 * picked out when a column says what they are.
 */

export type WalmartSettlementFile = {
  /** The columns kept, in the file's order. */
  columns: string[];
  /** Columns left out because they could identify a buyer or where they live. */
  dropped: string[];
  rows: Record<string, string>[];
  periodFrom: string | null;
  periodTo: string | null;
  /** What Walmart paid out for the settlement, when the report says. */
  payout: string | null;
  currency: string | null;
};

/** Column names that could identify a buyer, or where they live. */
const PERSONAL =
  /(ship[\s_-]*to|zip|postal|post[\s_-]*code|city|county|customer[\s_-]*(name|email|phone)|buyer|e-?mail|phone|address|recipient)/i;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();

/** The first column whose name matches. */
function column(columns: readonly string[], ...patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const found = columns.find((c) => p.test(norm(c)));
    if (found) return found;
  }
  return null;
}

/** MM/DD/YYYY, YYYY-MM-DD or MMDDYYYY as YYYY-MM-DD, or null. */
export function walmartDay(value: string): string | null {
  const s = value.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1]?.padStart(2, "0")}-${m[2]?.padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** An amount as written in the report ("1,234.50", "-6.00", "(6.00)", "$6") as a decimal. */
export function walmartAmount(value: string): string | null {
  let s = value.trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  if (negative) s = `-${s.slice(1, -1)}`;
  try {
    return formatDecimal(parseDecimal(s));
  } catch {
    return null;
  }
}

/** Reads a settlement report's text (CSV). Throws, in plain words, when it isn't one. */
export function readWalmartSettlement(text: string): WalmartSettlementFile {
  const table = readCsvTable(text.replace(/^﻿/, ""));
  if (table.headers.length < 2) {
    throw new Error("This isn't a Walmart settlement report: it has no columns.");
  }
  const keep = table.headers.map((h) => Boolean(h) && !PERSONAL.test(h));
  const columns = table.headers.filter((_, i) => keep[i]);
  const dropped = table.headers.filter((h, i) => h && !keep[i]);
  const rows = table.rows.map((cells) => {
    const row: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      if (keep[i] && cells[i]) row[h] = cells[i] ?? "";
    });
    return row;
  });
  const first = (name: string | null) =>
    name ? (rows.find((r) => r[name])?.[name] ?? null) : null;
  const fromCol = column(columns, /^period start/, /^settlement start/);
  const toCol = column(columns, /^period end/, /^settlement end/);
  const payoutCol = column(columns, /^total payout/, /^total payable/, /^net payable/);
  const currencyCol = column(columns, /^currency/);
  const from = first(fromCol);
  const to = first(toCol);
  const payout = first(payoutCol);
  const currency = first(currencyCol)?.trim().toUpperCase() ?? null;
  return {
    columns,
    dropped,
    rows,
    periodFrom: from ? walmartDay(from) : null,
    periodTo: to ? walmartDay(to) : null,
    payout: payout ? walmartAmount(payout) : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}

/**
 * The date an uploaded report is kept under, as Walmart's API files it: the settlement (payment)
 * date when a column says, else the period's last day. Null when the report says neither.
 */
export function walmartSettlementDate(file: WalmartSettlementFile): string | null {
  const col = column(
    file.columns,
    /^settlement date/,
    /^payment date/,
    /^pay date/,
    /^deposit date/,
    /^disbursement date/,
  );
  const value = col ? file.rows.find((r) => r[col])?.[col] : undefined;
  return (value ? walmartDay(value) : null) ?? file.periodTo;
}

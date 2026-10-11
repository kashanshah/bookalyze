import { parseCsv } from "../import/csv";

/**
 * Noon's FBN inventory ledger, summary view (export `fbn_inventoryv2_ledgersummaryview`): one row
 * per day, warehouse, SKU and condition, with the opening and closing quantity and each kind of
 * movement that day. It says what Noon holds (the closing quantity of the latest day), and its
 * daily change checks the detailed ledger (`noon-ledger.ts`): both should move a SKU by the same
 * number of units on the same day.
 */

export const NOON_SUMMARY_EXPORT = "fbn_inventoryv2_ledgersummaryview";

/** The movement columns, in Noon's order, by what they're called here. */
export const NOON_SUMMARY_MOVEMENTS = [
  ["inbound", "inboundquantity"],
  ["vendorReturn", "vendorreturnquantity"],
  ["disposal", "disposalquantity"],
  ["customerOutbound", "customeroutboundquantity"],
  ["customerReturn", "customerreturnquantity"],
  ["transferIn", "transferinquantity"],
  ["transferOut", "transferoutquantity"],
  ["transit", "transitquantity"],
  ["lost", "lostquantity"],
  ["found", "foundquantity"],
  ["damaged", "damagedquantity"],
  ["other", "otherquantity"],
] as const;

export type NoonStockMovement = (typeof NOON_SUMMARY_MOVEMENTS)[number][0];

export const NOON_STOCK_MOVEMENT_NAMES = NOON_SUMMARY_MOVEMENTS.map(([name]) => name) as [
  NoonStockMovement,
  ...NoonStockMovement[],
];

export type NoonStockDay = {
  date: string;
  /** Noon's warehouse (location) code. */
  location: string;
  /** The seller's SKU (partner_sku), else Noon's. */
  sku: string;
  nfsku: string | null;
  /** "sellable", "damaged"… as Noon writes it, lower case. */
  condition: string;
  opening: number;
  closing: number;
  movements: Partial<Record<NoonStockMovement, number>>;
};

export type NoonStockParseResult =
  | { ok: true; rows: NoonStockDay[]; from: string | null; to: string | null; skipped: number }
  | { ok: false; error: string };

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function isoDay(value: string): string | null {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2]?.padStart(2, "0")}-${dmy[1]?.padStart(2, "0")}`;
  return null;
}

const whole = (value: string): number | null => {
  const v = value.trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/** Whether a file's header is Noon's FBN ledger summary view. */
export function isNoonSummaryHeader(header: readonly string[]): boolean {
  const names = new Set(header.map(norm));
  return names.has("closingquantity") && names.has("openingquantity");
}

/** Parses Noon's FBN ledger summary view. Rows with the same day, place, SKU and condition add up. */
export function parseNoonStockSummary(text: string): NoonStockParseResult {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const [header, ...data] = rows;
  if (!header) return { ok: false, error: "The file is empty." };
  if (!isNoonSummaryHeader(header)) {
    return {
      ok: false,
      error:
        "This isn't Noon's FBN inventory ledger (summary view). It has columns such as opening_quantity and closing_quantity.",
    };
  }
  const col = new Map(header.map((h, i) => [norm(h), i]));
  const at = (row: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const byKey = new Map<string, NoonStockDay>();
  let skipped = 0;
  for (const row of data) {
    if (row.every((cell) => !cell.trim())) continue;
    const date = isoDay(at(row, "date"));
    const sku = (at(row, "partnersku") || at(row, "sku")).slice(0, 200);
    const opening = whole(at(row, "openingquantity"));
    const closing = whole(at(row, "closingquantity"));
    if (!date || !sku || opening === null || closing === null) {
      skipped++;
      continue;
    }
    const location = (at(row, "location") || at(row, "warehousecode")).slice(0, 40);
    const condition = (at(row, "inventorycondition") || "sellable").toLowerCase().slice(0, 50);
    const key = [date, location, sku, condition].join("|");
    const found = byKey.get(key) ?? {
      date,
      location,
      sku,
      nfsku: at(row, "nfsku").slice(0, 50) || null,
      condition,
      opening: 0,
      closing: 0,
      movements: {},
    };
    found.opening += opening;
    found.closing += closing;
    for (const [name, column] of NOON_SUMMARY_MOVEMENTS) {
      const n = whole(at(row, column));
      if (n) found.movements[name] = (found.movements[name] ?? 0) + n;
    }
    byKey.set(key, found);
  }
  const all = [...byKey.values()];
  const dates = all.map((r) => r.date).sort();
  return { ok: true, rows: all, from: dates[0] ?? null, to: dates.at(-1) ?? null, skipped };
}

export type NoonLedgerMismatch = {
  date: string;
  sku: string;
  /** Closing − opening in Noon's summary that day (every warehouse and condition). */
  summary: number;
  /** The detailed ledger's rows that day added up. */
  ledger: number;
};

/**
 * Days where Noon's summary and its detailed ledger move a SKU by different amounts. Only days
 * the summary covers are checked; a day without ledger rows counts as no movement.
 */
export function noonLedgerMismatches(
  summary: readonly { date: string; sku: string; change: number }[],
  ledger: readonly { date: string; sku: string; quantity: number }[],
): NoonLedgerMismatch[] {
  const moved = new Map<string, number>();
  for (const row of ledger) {
    const key = `${row.date}|${row.sku}`;
    moved.set(key, (moved.get(key) ?? 0) + row.quantity);
  }
  const changed = new Map<string, number>();
  for (const row of summary) {
    const key = `${row.date}|${row.sku}`;
    changed.set(key, (changed.get(key) ?? 0) + row.change);
  }
  const out: NoonLedgerMismatch[] = [];
  for (const [key, change] of changed) {
    const [date = "", sku = ""] = key.split("|");
    const ledgerUnits = moved.get(key) ?? 0;
    if (ledgerUnits !== change) out.push({ date, sku, summary: change, ledger: ledgerUnits });
  }
  return out.sort((a, b) =>
    a.date === b.date ? a.sku.localeCompare(b.sku) : b.date.localeCompare(a.date),
  );
}

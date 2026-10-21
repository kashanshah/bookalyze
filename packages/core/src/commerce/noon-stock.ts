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
  /** The day, or the last day of a period report. */
  date: string;
  /** A period report's first day (its opening is that morning's); null for one day. */
  fromDate?: string | null;
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
  /** The day, or a period report's last day. */
  date: string;
  /** A period report's first day; null for one day. */
  from: string | null;
  /** What's compared: the product (or the SKU, when it isn't linked to one). */
  sku: string;
  /** Closing − opening in Noon's summary (every warehouse and condition). */
  summary: number;
  /** The detailed ledger's rows over the same days added up. */
  ledger: number;
};

/**
 * Where Noon's summary and its detailed ledger move a product by different amounts: each day the
 * summary covers, or each period a period report covers (the ledger added up over its days). Rows
 * are matched on `key` (the product, so the same product under two SKU spellings still matches);
 * `label` is what the reader sees. A day without ledger rows counts as no movement.
 */
export function noonLedgerMismatches(
  summary: readonly {
    date: string;
    from?: string | null;
    key: string;
    label: string;
    change: number;
  }[],
  ledger: readonly { date: string; key: string; quantity: number }[],
): NoonLedgerMismatch[] {
  const changed = new Map<
    string,
    { date: string; from: string | null; key: string; label: string; change: number }
  >();
  for (const row of summary) {
    const from = row.from && row.from < row.date ? row.from : null;
    const id = `${from ?? ""}|${row.date}|${row.key}`;
    const found = changed.get(id) ?? {
      date: row.date,
      from,
      key: row.key,
      label: row.label,
      change: 0,
    };
    found.change += row.change;
    changed.set(id, found);
  }
  const out: NoonLedgerMismatch[] = [];
  for (const c of changed.values()) {
    const first = c.from ?? c.date;
    const ledgerUnits = ledger
      .filter((l) => l.key === c.key && l.date >= first && l.date <= c.date)
      .reduce((t, l) => t + l.quantity, 0);
    if (ledgerUnits !== c.change) {
      out.push({
        date: c.date,
        from: c.from,
        sku: c.label,
        summary: c.change,
        ledger: ledgerUnits,
      });
    }
  }
  return out.sort((a, b) =>
    a.date === b.date ? a.sku.localeCompare(b.sku) : b.date.localeCompare(a.date),
  );
}

/** Noon's period summary's movement columns, by what they're called here (signed: net). */
const PERIOD_MOVEMENTS: [string, NoonStockMovement, NoonStockMovement?][] = [
  ["inboundreceived", "inbound"],
  ["customershipment", "customerOutbound"],
  ["returnreinbound", "customerReturn"],
  ["vendorreturn", "vendorReturn"],
  ["dispose", "disposal"],
  ["liquidation", "disposal"],
  ["intransit", "transit"],
  ["warehousetransfer", "transferIn", "transferOut"],
  ["lostandfound", "found", "lost"],
  ["qcfailreturn", "other"],
  ["relabel", "other"],
  ["unknowntransactions", "other"],
];

/** Whether a file's header is Noon's FBN ledger summary for a period (no date column). */
export function isNoonPeriodSummaryHeader(header: readonly string[]): boolean {
  const names = new Set(header.map(norm));
  return names.has("openingstock") && names.has("closingstock");
}

/**
 * Parses Noon's FBN ledger summary for a period (Seller Lab's newer report: one row per
 * warehouse and SKU, with the stock at the start and end of the dates chosen and what moved in
 * between). The file doesn't say its dates, so they're asked for: `from` and `to` are the first
 * and last day chosen on Noon. Noon's own SKU (sku) is kept; it's matched to the seller's SKU
 * when checked. Rows of the same warehouse and SKU add up.
 */
export function parseNoonPeriodSummary(
  text: string,
  period: { from: string; to: string },
): NoonStockParseResult {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const [header, ...data] = rows;
  if (!header) return { ok: false, error: "The file is empty." };
  if (!isNoonPeriodSummaryHeader(header)) {
    return {
      ok: false,
      error:
        "This isn't Noon's FBN ledger summary for a period. It has columns such as opening_stock and closing_stock.",
    };
  }
  if (!isoDay(period.from) || !isoDay(period.to) || period.from > period.to) {
    return { ok: false, error: "Enter the first and last day the report covers." };
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
    const sku = (at(row, "partnersku") || at(row, "sku")).slice(0, 200);
    const opening = whole(at(row, "openingstock"));
    const closing = whole(at(row, "closingstock"));
    if (!sku || opening === null || closing === null) {
      skipped++;
      continue;
    }
    const location = (at(row, "warehousecode") || at(row, "location")).slice(0, 40);
    const condition = (at(row, "inventorycondition") || "sellable").toLowerCase().slice(0, 50);
    const key = [location, sku, condition].join("|");
    const found = byKey.get(key) ?? {
      date: period.to,
      fromDate: period.from,
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
    for (const [column, up, down] of PERIOD_MOVEMENTS) {
      const n = whole(at(row, column));
      if (!n) continue;
      const name = n < 0 && down ? down : up;
      found.movements[name] = (found.movements[name] ?? 0) + n;
    }
    byKey.set(key, found);
  }
  return { ok: true, rows: [...byKey.values()], from: period.from, to: period.to, skipped };
}

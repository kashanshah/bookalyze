import { parseCsv } from "../import/csv";

/**
 * Amazon's FBA inventory ledger, detailed view (report GET_LEDGER_DETAIL_VIEW_DATA, or Seller
 * Central → Reports → Fulfillment → Inventory Ledger → Detailed view, downloaded as CSV or TSV).
 * One row per movement of units of one SKU at one fulfilment centre: shipped to a customer,
 * returned, received, adjusted (lost, found, damaged, disposed), removed, transferred.
 */

export const LEDGER_EVENT_TYPES = [
  "Shipments",
  "CustomerReturns",
  "Receipts",
  "Adjustments",
  "VendorReturns",
  "WhseTransfers",
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number] | "Other";

export const LEDGER_EVENT_LABELS: Record<LedgerEventType, string> = {
  Shipments: "Shipped to customers",
  CustomerReturns: "Returned by customers",
  Receipts: "Received at Amazon",
  Adjustments: "Adjustments (lost, found, damaged, disposed)",
  VendorReturns: "Removed (sent back to you)",
  WhseTransfers: "Moved between Amazon warehouses",
  Other: "Other",
};

export type LedgerEvent = {
  /** YYYY-MM-DD. */
  date: string;
  sku: string;
  fnsku: string | null;
  asin: string | null;
  title: string | null;
  eventType: LedgerEventType;
  referenceId: string | null;
  /** Signed: units in (+) or out (−) of Amazon's stock. */
  quantity: number;
  fulfillmentCenter: string | null;
  disposition: string | null;
  reason: string | null;
  country: string | null;
  /** Same for the same row in any copy of the report, so bringing it in twice adds it once. */
  key: string;
};

export type LedgerParseResult =
  | { ok: true; events: LedgerEvent[]; from: string | null; to: string | null }
  | { ok: false; error: string };

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");

/** "09/05/2026", "2026-09-05", "2026-09-05T07:00:00-07:00" → "2026-09-05". */
function isoDay(value: string): string | null {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (us) return `${us[3]}-${us[1]?.padStart(2, "0")}-${us[2]?.padStart(2, "0")}`;
  return null;
}

/** Parses the detailed inventory ledger. Unknown event types are kept as "Other". */
export function parseInventoryLedger(text: string): LedgerParseResult {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const [header, ...data] = rows;
  if (!header) return { ok: false, error: "The file is empty." };
  const col = new Map(header.map((h, i) => [norm(h), i]));
  const at = (row: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  for (const required of ["date", "msku", "eventtype", "quantity"]) {
    if (!col.has(required)) {
      return {
        ok: false,
        error:
          "This isn't Amazon's inventory ledger (detailed view). Download it from Seller Central → Reports → Fulfillment → Inventory Ledger, Detailed view.",
      };
    }
  }
  const seen = new Map<string, number>();
  const events: LedgerEvent[] = [];
  for (const row of data) {
    const date = isoDay(at(row, "date"));
    const sku = at(row, "msku");
    const quantity = Number(at(row, "quantity"));
    if (!date || !sku || !Number.isInteger(quantity)) continue;
    const type = at(row, "eventtype");
    const eventType = (LEDGER_EVENT_TYPES as readonly string[]).includes(type)
      ? (type as LedgerEventType)
      : "Other";
    const fields = {
      date,
      sku,
      fnsku: at(row, "fnsku") || null,
      asin: at(row, "asin") || null,
      title: at(row, "title").slice(0, 500) || null,
      eventType,
      referenceId: at(row, "referenceid") || null,
      quantity,
      fulfillmentCenter: at(row, "fulfillmentcenter") || null,
      disposition: at(row, "disposition") || null,
      reason: at(row, "reason") || null,
      country: at(row, "country") || null,
    };
    const base = [
      date,
      sku,
      fields.fnsku,
      type,
      fields.referenceId,
      quantity,
      fields.fulfillmentCenter,
      fields.disposition,
      fields.reason,
      at(row, "dateandtime"),
    ].join("|");
    // Identical rows are real (two units moved the same way): number them within the file.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    events.push({ ...fields, key: `${base}|${n}` });
  }
  const dates = events.map((e) => e.date).sort();
  return { ok: true, events, from: dates[0] ?? null, to: dates.at(-1) ?? null };
}

/**
 * How a month's ledger moves owned stock, per SKU in listing units: units customers returned
 * (any condition: they're yours again) and the net of adjustments (negative: lost, damaged or
 * disposed; positive: found). Shipments come from orders; receipts, removals and transfers
 * don't change what you own.
 */
export function ledgerStockChanges(
  events: readonly Pick<LedgerEvent, "sku" | "eventType" | "quantity">[],
): Map<string, { returned: number; adjusted: number }> {
  const map = new Map<string, { returned: number; adjusted: number }>();
  for (const e of events) {
    const entry = map.get(e.sku) ?? { returned: 0, adjusted: 0 };
    if (e.eventType === "CustomerReturns" && e.quantity > 0) entry.returned += e.quantity;
    else if (e.eventType === "Adjustments") entry.adjusted += e.quantity;
    else continue;
    map.set(e.sku, entry);
  }
  return map;
}

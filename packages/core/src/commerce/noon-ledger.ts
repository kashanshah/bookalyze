import { parseCsv } from "../import/csv";
import type { LedgerEvent, LedgerEventType } from "./inventory-ledger";

/**
 * Noon's FBN inventory ledger, detailed view (export `fbn_inventoryv2_ledgerdetailedview`, or
 * the same report downloaded from Noon): one row per movement of units of one SKU in one Noon
 * warehouse, with its type, reference and a signed quantity. Rows are read into the same
 * movements as Amazon's FBA ledger, so returns go back into stock and losses are written off the
 * same way when a month's cost of goods sold is posted.
 */

export const NOON_LEDGER_EXPORT = "fbn_inventoryv2_ledgerdetailedview";

/**
 * Noon's movement type in Amazon's terms, from the words of its transaction and reference types
 * (Noon's labels vary). What isn't recognised is kept as "Other": it changes nothing and is
 * listed on Stock movements so it can be told apart later.
 */
export function noonLedgerEventType(transactionType: string, referenceType = ""): LedgerEventType {
  const text = `${transactionType} ${referenceType}`
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  const has = (pattern: RegExp) => pattern.test(text);
  // Units sent back to the seller (removals) before customer returns: both say "return".
  if (
    has(/\b(vendor|partner|seller|supplier)\b.*\breturn|\bremoval|\bwithdraw|\brecall|\bliquidat/)
  ) {
    return "VendorReturns";
  }
  if (has(/\breturn|\brto\b|\brefund/)) return "CustomerReturns";
  if (
    has(
      /\b(lost|loss|found|damage[ds]?|dispos|destroy|scrap|adjust|write ?off|shrink|expir|missing|cycle ?count|audit|stock ?take|qc ?fail)/,
    )
  ) {
    return "Adjustments";
  }
  if (has(/\btransfer|\bstn\b|\brelocat|\bmove(d|ment)? between/)) return "WhseTransfers";
  if (has(/\binbound|\breceiv|\breceipt|\bgrn\b|\basn\b|\bputaway|\bput away/)) return "Receipts";
  if (has(/\boutbound|\bship|\bdispatch|\bsale|\border|\bfulfil|\bpick/)) return "Shipments";
  return "Other";
}

export type NoonLedgerParseResult =
  | {
      ok: true;
      /** Each movement with its Noon country (ISO code, upper case) in `country`. */
      events: LedgerEvent[];
      from: string | null;
      to: string | null;
      /** Rows without a date, SKU or whole-number quantity. */
      skipped: number;
    }
  | { ok: false; error: string };

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** "2026-09-05", "2026-09-05 10:00:00", "05/09/2026" (Noon writes day first) → "2026-09-05". */
function isoDay(value: string): string | null {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2]?.padStart(2, "0")}-${dmy[1]?.padStart(2, "0")}`;
  return null;
}

/** Whether a file's header is Noon's detailed FBN ledger (not Amazon's). */
export function isNoonLedgerHeader(header: readonly string[]): boolean {
  const names = new Set(header.map(norm));
  return names.has("quantitydelta") && names.has("transactiontype");
}

/** Parses Noon's detailed FBN ledger. The seller's SKU (partner_sku) links rows to products. */
export function parseNoonLedger(text: string): NoonLedgerParseResult {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const [header, ...data] = rows;
  if (!header) return { ok: false, error: "The file is empty." };
  if (!isNoonLedgerHeader(header)) {
    return {
      ok: false,
      error:
        "This isn't Noon's FBN inventory ledger (detailed view). It has columns such as transaction_type and quantity_delta.",
    };
  }
  const col = new Map(header.map((h, i) => [norm(h), i]));
  const at = (row: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const seen = new Map<string, number>();
  const events: LedgerEvent[] = [];
  let skipped = 0;
  for (const row of data) {
    if (row.every((cell) => !cell.trim())) continue;
    const date = isoDay(at(row, "transactiondate"));
    const sku = at(row, "partnersku") || at(row, "sku");
    const quantity = Number(at(row, "quantitydelta"));
    if (!date || !sku || !Number.isInteger(quantity)) {
      skipped++;
      continue;
    }
    const transactionType = at(row, "transactiontype");
    const referenceType = at(row, "referencetype");
    const fields = {
      date,
      sku: sku.slice(0, 200),
      fnsku: (at(row, "nfsku") || at(row, "sku")).slice(0, 50) || null,
      asin: null,
      title: null,
      eventType: noonLedgerEventType(transactionType, referenceType),
      referenceId: at(row, "referencenr").slice(0, 100) || null,
      quantity,
      fulfillmentCenter: at(row, "warehousecode").slice(0, 20) || null,
      disposition: at(row, "inventorycondition").slice(0, 50) || null,
      reason: [transactionType, referenceType].filter(Boolean).join(" · ").slice(0, 50) || null,
      country: at(row, "countrycode").toUpperCase().slice(0, 10) || null,
    };
    const base = [
      "noon",
      date,
      fields.sku,
      fields.fnsku,
      transactionType,
      referenceType,
      fields.referenceId,
      quantity,
      fields.fulfillmentCenter,
      fields.disposition,
      at(row, "qcfailitemidentifier"),
    ].join("|");
    // Identical rows are real (two units moved the same way): number them within the file.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    events.push({ ...fields, key: `${base}|${n}`.slice(0, 1000) });
  }
  const dates = events.map((e) => e.date).sort();
  return { ok: true, events, from: dates[0] ?? null, to: dates.at(-1) ?? null, skipped };
}

import type { LedgerEvent, LedgerEventType } from "./inventory-ledger";

/**
 * WFS's inventory log (phase 4e, slice 6): `GET /v3/fulfillment/inventory-log`, one GTIN at a
 * time, every change to what Walmart Fulfillment Services holds of it: received, shipped to a
 * customer, returned by one, damaged, lost, found, removed. Each entry is read into the same
 * movements as Amazon's FBA ledger, so returns come back into your lots and losses are written
 * off when a month's cost of goods sold is posted. The log asks for the item's GTIN, which
 * Walmart's item API (`GET /v3/items/{sku}`) gives for a SKU.
 */

export const WALMART_INVENTORY_LOG_PATH = "/v3/fulfillment/inventory-log";
/** Entries per page. */
export const WALMART_INVENTORY_LOG_PAGE = 200;

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/** The item API's address for a SKU. */
export function walmartItemPath(sku: string): string {
  return `/v3/items/${encodeURIComponent(sku)}?productIdType=SKU`;
}

/** The GTIN (else the UPC) Walmart has for the item, or null. */
export function parseWalmartItemGtin(json: unknown): string | null {
  const body = record(json);
  const list = Array.isArray(body.ItemResponse)
    ? body.ItemResponse
    : Array.isArray(record(body.payload).ItemResponse)
      ? (record(body.payload).ItemResponse as unknown[])
      : [body];
  for (const raw of list) {
    const item = record(raw);
    const code = text(item.gtin) || text(item.upc);
    if (/^\d{8,14}$/.test(code)) return code;
  }
  return null;
}

/** The query for one page of a GTIN's log, between two days (YYYY-MM-DD, both included). */
export function walmartInventoryLogQuery(input: {
  gtin: string;
  from: string;
  to: string;
  offset: number;
}): string {
  const params = new URLSearchParams({
    gtin: input.gtin,
    startDate: input.from,
    endDate: input.to,
    offset: String(input.offset),
    limit: String(WALMART_INVENTORY_LOG_PAGE),
  });
  return `${WALMART_INVENTORY_LOG_PATH}?${params.toString()}`;
}

/** Whether a word (or a word's start, as "damage" for "damaged") is in the text. */
const has = (s: string, ...words: string[]) => words.some((w) => new RegExp(`\\b${w}`).test(s));

/**
 * Which movement an entry is, from its transaction type and reason: returns by customers, then
 * removals back to the seller, adjustments (damaged, lost, found, disposed, expired…), receipts,
 * shipments, transfers. Anything else is "Other": shown on Stock movements as not counted, so a
 * type Walmart names differently can be told apart and read later.
 */
export function walmartLogEventType(type: string, reason: string): LedgerEventType {
  const t = `${type} ${reason}`.toLowerCase().replace(/[_-]+/g, " ");
  if (has(t, "return to seller", "return to vendor", "removal", "rts", "liquidat")) {
    return "VendorReturns";
  }
  if (has(t, "customer return", "return")) return "CustomerReturns";
  if (
    has(
      t,
      "damage",
      "lost",
      "missing",
      "found",
      "defect",
      "dispos",
      "destroy",
      "expire",
      "shrink",
      "adjust",
      "cycle count",
      "recount",
      "unsellable",
    )
  ) {
    return "Adjustments";
  }
  if (has(t, "receiv", "inbound", "receipt")) return "Receipts";
  if (has(t, "customer order", "order", "ship", "fulfil", "sale", "pick")) return "Shipments";
  if (has(t, "transfer")) return "WhseTransfers";
  return "Other";
}

/** "2026-10-09T14:05:00Z", "2026-10-09", "10/09/2026" → "2026-10-09". */
function day(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  return us ? `${us[3]}-${us[1]?.padStart(2, "0")}-${us[2]?.padStart(2, "0")}` : null;
}

/**
 * Reads a page of a SKU's log as movements (units in +, out −), and how many entries there are
 * in all when Walmart says. Entries without a day or a quantity are left out. Throws, in plain
 * words, on anything that isn't a log.
 */
export function parseWalmartInventoryLogPage(
  json: unknown,
  sku: string,
): { events: LedgerEvent[]; total: number | null } {
  const body = record(json);
  const payload = record(body.payload);
  const list = payload.inventoryLog ?? body.inventoryLog;
  if (!Array.isArray(list)) throw new Error("Unexpected response from Walmart.");
  const gtin = text(payload.gtin) || null;
  const events = list.flatMap((raw): LedgerEvent[] => {
    const entry = record(raw);
    const date = day(text(entry.transactionTime) || text(entry.transactionDate));
    const quantity = Number(entry.changedQty ?? entry.quantity);
    if (!date || !Number.isFinite(quantity) || quantity === 0) return [];
    const type = text(entry.transactionType);
    const reason = text(entry.transactionReasonDesc) || text(entry.transactionReasonCode);
    const eventType = walmartLogEventType(type, reason);
    const id = text(entry.id);
    return [
      {
        date,
        sku,
        fnsku: null,
        asin: gtin,
        title: text(payload.productName) || null,
        eventType,
        referenceId: id || null,
        quantity: Math.trunc(quantity),
        fulfillmentCenter: text(entry.fcName).slice(0, 20) || null,
        disposition: null,
        // What Walmart called it, kept short: "Other" rows are listed by it on Stock movements.
        reason: (eventType === "Other" ? type || reason : reason || type).slice(0, 50) || null,
        country: null,
        key: id
          ? `wfs:${id}`
          : `wfs:${sku}:${date}:${type}:${reason}:${quantity}:${text(entry.fcName)}`,
      },
    ];
  });
  const totalCount = Number(record(body.headers).totalCount);
  return { events, total: Number.isFinite(totalCount) && totalCount >= 0 ? totalCount : null };
}

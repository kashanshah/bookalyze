/**
 * Amazon's FBA inventory summaries (FBA Inventory API v1, getInventorySummaries): every seller
 * SKU Amazon holds stock for in a marketplace, sold or not: what can be sold now, what's
 * reserved, on its way in, unsellable or being looked for.
 */

export type FbaInventoryItem = {
  sku: string;
  asin: string | null;
  title: string | null;
  /** Units that can be sold now; null when Amazon didn't say. */
  fulfillable: number | null;
  /** Held for customer orders, moves between warehouses or processing. */
  reserved: number | null;
  /** On their way in: shipments being worked on, shipped and being received. */
  inbound: number | null;
  /** Damaged, defective or expired: still yours, but can't be sold. */
  unfulfillable: number | null;
  /** Lost or misplaced units Amazon is looking for. */
  researching: number | null;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const quantity = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;

/** Adds the parts Amazon gave; null when it gave none. */
const sum = (parts: (number | null)[]) =>
  parts.some((p) => p !== null) ? parts.reduce<number>((a, p) => a + (p ?? 0), 0) : null;

export function parseFbaInventoryPage(json: unknown): {
  items: FbaInventoryItem[];
  nextToken: string | null;
} {
  const body = record(json);
  const summaries = record(body.payload).inventorySummaries;
  if (!Array.isArray(summaries)) throw new Error("Unexpected response from Amazon.");
  const items = summaries.flatMap((raw): FbaInventoryItem[] => {
    const s = record(raw);
    // Kept exactly as Amazon has it, so it matches the SKU on order lines.
    const sku = typeof s.sellerSku === "string" ? s.sellerSku : "";
    if (!sku.trim()) return [];
    const details = record(s.inventoryDetails);
    return [
      {
        sku,
        asin: text(s.asin) || null,
        title: text(s.productName).slice(0, 500) || null,
        fulfillable: quantity(details.fulfillableQuantity),
        reserved: quantity(record(details.reservedQuantity).totalReservedQuantity),
        inbound: sum([
          quantity(details.inboundWorkingQuantity),
          quantity(details.inboundShippedQuantity),
          quantity(details.inboundReceivingQuantity),
        ]),
        unfulfillable: quantity(record(details.unfulfillableQuantity).totalUnfulfillableQuantity),
        researching: quantity(record(details.researchingQuantity).totalResearchingQuantity),
      },
    ];
  });
  const nextToken = text(record(body.pagination).nextToken);
  return { items, nextToken: nextToken || null };
}

/**
 * Amazon's FBA inventory summaries (FBA Inventory API v1, getInventorySummaries): every seller
 * SKU Amazon holds stock for in a marketplace, sold or not, with what can be sold now.
 */

export type FbaInventoryItem = {
  sku: string;
  asin: string | null;
  title: string | null;
  /** Units that can be sold now; null when Amazon didn't say. */
  fulfillable: number | null;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const quantity = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;

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
      },
    ];
  });
  const nextToken = text(record(body.pagination).nextToken);
  return { items, nextToken: nextToken || null };
}

/**
 * Walmart Fulfillment Services stock (phase 4e, slice 5): `GET /v3/fulfillment/inventory`, every
 * SKU WFS holds for the seller in a market, a page at a time. Each SKU's WFS ship nodes say what
 * can be sold now (`availToSellQty`) and what's in Walmart's warehouses (`onHandQty`); what's on
 * hand but can't be sold is held (reserved for orders, being checked, unsellable). Kept like
 * Amazon's FBA inventory, so Stock shows it beside your lots.
 */

export const WALMART_WFS_INVENTORY_PATH = "/v3/fulfillment/inventory";
/** Walmart's largest page. */
export const WALMART_WFS_INVENTORY_PAGE = 300;

export type WalmartWfsItem = {
  sku: string;
  /** Units that can be sold now. */
  fulfillable: number | null;
  /** On hand at WFS but not sellable now (held for orders, checked, unsellable). */
  reserved: number | null;
};

/** The query for one page of WFS inventory. */
export function walmartWfsInventoryQuery(offset: number): string {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(WALMART_WFS_INVENTORY_PAGE),
  });
  return `${WALMART_WFS_INVENTORY_PATH}?${params.toString()}`;
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const quantity = (v: unknown) => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};

/**
 * Reads a page: its SKUs (WFS ship nodes added up; a SKU with none is left out) and how many SKUs
 * there are in all, when Walmart says. Throws, in plain words, on anything else.
 */
export function parseWalmartWfsInventoryPage(json: unknown): {
  items: WalmartWfsItem[];
  total: number | null;
} {
  const body = record(json);
  const list = record(body.payload).inventory ?? body.inventory;
  if (!Array.isArray(list)) throw new Error("Unexpected response from Walmart.");
  const items = list.flatMap((raw): WalmartWfsItem[] => {
    const item = record(raw);
    const sku = typeof item.sku === "string" ? item.sku.trim() : "";
    const nodes = Array.isArray(item.shipNodes) ? item.shipNodes.map(record) : [];
    const wfs = nodes.filter(
      (n) => typeof n.shipNodeType !== "string" || /wfs/i.test(n.shipNodeType),
    );
    if (!sku || !wfs.length) return [];
    let sellable: number | null = null;
    let onHand: number | null = null;
    for (const node of wfs) {
      const s = quantity(node.availToSellQty);
      const h = quantity(node.onHandQty);
      if (s !== null) sellable = (sellable ?? 0) + s;
      if (h !== null) onHand = (onHand ?? 0) + h;
    }
    const reserved = onHand === null ? null : Math.max(onHand - (sellable ?? 0), 0);
    return [{ sku, fulfillable: sellable ?? (onHand === null ? null : 0), reserved }];
  });
  const total = quantity(record(body.headers).totalCount);
  return { items, total };
}

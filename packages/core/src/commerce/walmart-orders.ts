import { formatDecimal, parseDecimal, sumDecimals } from "../money";
import type { AmazonOrder, AmazonOrderItem } from "./orders";

/**
 * Walmart orders (Marketplace API, GET /v3/orders): the query for a window and the parsing of a
 * page into the shapes the Orders screen already keeps (`orders`, `order_items`), so Walmart sits
 * next to Amazon, eBay and Noon. An order is Walmart's purchase order (its PO number), with its
 * order lines. Walmart lists the orders it ships (WFS) apart from the seller's own, so each kind
 * is asked for on its own (`shipNodeType`). No buyer details are kept, only the ship-to country
 * and state. Nothing here touches the ledger.
 */

export const WALMART_ORDERS_PATH = "/v3/orders";
/** Walmart's largest page. */
export const WALMART_ORDERS_PAGE = 200;

/** Who shipped: the seller's own warehouses, or Walmart's (WFS). */
export const WALMART_SHIP_NODES = ["SellerFulfilled", "WFSFulfilled"] as const;
export type WalmartShipNode = (typeof WALMART_SHIP_NODES)[number];

/** The ship nodes to ask for, from who ships the channel's orders (both when not said). */
export function walmartShipNodes(fulfilment: string | null): WalmartShipNode[] {
  if (fulfilment === "seller") return ["SellerFulfilled"];
  if (fulfilment === "marketplace") return ["WFSFulfilled"];
  return ["SellerFulfilled", "WFSFulfilled"];
}

/**
 * The query for a window's first page. The first sync asks by creation date (from the start
 * date chosen); later ones by last change, so shipped and cancelled orders are brought up to
 * date. Later pages follow Walmart's own `nextCursor` (`walmartOrdersNextPath`).
 */
export function walmartOrdersQuery(input: {
  by: "created" | "lastModified";
  after: string;
  before: string;
  shipNode: WalmartShipNode;
}): string {
  const params = new URLSearchParams({
    [`${input.by}StartDate`]: input.after,
    [`${input.by}EndDate`]: input.before,
    limit: String(WALMART_ORDERS_PAGE),
    shipNodeType: input.shipNode,
  });
  return `${WALMART_ORDERS_PATH}?${params.toString()}`;
}

/** The next page's path from Walmart's `nextCursor` (a query string, "?limit=…&…"). */
export function walmartOrdersNextPath(cursor: string): string {
  const query = cursor.startsWith("?") ? cursor : `?${cursor}`;
  return `${WALMART_ORDERS_PATH}${query}`;
}

export type WalmartOrder = { order: AmazonOrder; items: AmazonOrderItem[] };

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
/** Walmart wraps lists in an object ({ orderLine: [...] }) and sometimes sends one item bare. */
const list = (v: unknown, key?: string): Record<string, unknown>[] => {
  const inner = key && v && typeof v === "object" && !Array.isArray(v) ? record(v)[key] : v;
  if (Array.isArray(inner)) return inner.map(record);
  return inner && typeof inner === "object" ? [record(inner)] : [];
};
const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const whole = (v: unknown) => {
  const n = Number(text(v));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** Walmart's times are milliseconds since 1970 (or ISO text); as ISO, or null. */
function instant(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  const s = text(v);
  if (/^\d{10,}$/.test(s)) return new Date(Number(s)).toISOString();
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/** An amount as an exact decimal string, or null. */
function decimal(v: unknown): string | null {
  const value = text(v);
  if (!value) return null;
  try {
    return formatDecimal(parseDecimal(value));
  } catch {
    return null;
  }
}

const sum = (values: readonly (string | null)[]): string | null => {
  const present = values.filter((v): v is string => v !== null);
  return present.length ? sumDecimals(present) : null;
};

/** Walmart's countries come as three letters (USA); the Orders screen keeps two. */
const COUNTRIES: Record<string, string> = {
  USA: "US",
  US: "US",
  CAN: "CA",
  CA: "CA",
  MEX: "MX",
  MX: "MX",
};
const country = (v: unknown) => {
  const c = text(v).toUpperCase();
  return COUNTRIES[c] ?? (c.length === 2 ? c : null);
};

/** A line's units in each state, from its statuses (a line can be part shipped). */
function lineUnits(line: Record<string, unknown>) {
  const units = { cancelled: 0, shipped: 0, open: 0 };
  for (const s of list(line.orderLineStatuses, "orderLineStatus")) {
    const n = whole(record(s.statusQuantity).amount);
    const status = text(s.status).toLowerCase();
    if (status === "cancelled" || status === "canceled") units.cancelled += n;
    else if (status === "shipped" || status === "delivered") units.shipped += n;
    else units.open += n;
  }
  return units;
}

/**
 * Parses one page. `next` is Walmart's cursor for the next page, or null on the last one. An
 * order needs its PO number, its date and at least one line.
 */
export function parseWalmartOrdersPage(json: unknown): {
  orders: WalmartOrder[];
  next: string | null;
} {
  const body = record(json);
  const page = record(body.list);
  if (!("list" in body)) throw new Error("Unexpected response from Walmart.");
  const meta = record(page.meta);
  const cursor = text(meta.nextCursor);
  const raw = list(page.elements, "order");

  const orders = raw.flatMap((o): WalmartOrder[] => {
    const orderId = text(o.purchaseOrderId);
    const purchasedAt = instant(o.orderDate);
    const lines = list(o.orderLines, "orderLine");
    if (!orderId || !purchasedAt || !lines.length) return [];

    let currency: string | null = null;
    let latest = purchasedAt;
    const units = { cancelled: 0, shipped: 0, open: 0 };
    const items = lines.map((line): AmazonOrderItem => {
      const item = record(line.item);
      const charges = list(line.charges, "charge");
      const of = (type: string) => charges.filter((c) => text(c.chargeType).toUpperCase() === type);
      const amountOf = (c: Record<string, unknown>) => {
        const a = record(c.chargeAmount);
        currency ??= text(a.currency) || null;
        return decimal(a.amount);
      };
      const taxOf = (c: Record<string, unknown>) => decimal(record(record(c.tax).taxAmount).amount);
      const product = of("PRODUCT");
      const shipping = of("SHIPPING");
      const ordered = whole(record(line.orderLineQuantity).amount);
      const lineState = lineUnits(line);
      units.cancelled += lineState.cancelled;
      units.shipped += lineState.shipped;
      units.open += lineState.open;
      const changed = instant(line.statusDate);
      if (changed && changed > latest) latest = changed;
      const sku = text(item.sku);
      return {
        itemId: text(line.lineNumber) || sku,
        asin: "",
        sku: sku || null,
        title: text(item.productName) || null,
        quantityOrdered: ordered,
        quantityShipped: Math.min(ordered, lineState.shipped),
        itemPrice: sum(product.map(amountOf)),
        itemTax: sum(product.map(taxOf)),
        shippingPrice: sum(shipping.map(amountOf)),
        shippingTax: sum(shipping.map(taxOf)),
        promotionDiscount: null,
      };
    });

    const ordered = items.reduce((n, i) => n + i.quantityOrdered, 0);
    const status =
      units.cancelled >= ordered && ordered > 0
        ? "Canceled"
        : units.shipped > 0 && units.open === 0
          ? "Shipped"
          : units.shipped > 0
            ? "PartiallyShipped"
            : "Unshipped";
    const shipping = record(o.shippingInfo);
    const address = record(shipping.postalAddress);
    const delivery = instant(shipping.estimatedDeliveryDate)?.slice(0, 10) ?? null;
    const total = sum(
      items.flatMap((i) => [i.itemPrice, i.itemTax, i.shippingPrice, i.shippingTax]),
    );
    return [
      {
        order: {
          orderId,
          marketplaceId: "",
          purchasedAt,
          lastUpdatedAt: latest,
          status,
          fulfillment: text(record(o.shipNode).type) === "WFSFulfilled" ? "amazon" : "merchant",
          currency,
          total,
          itemsShipped: units.shipped,
          itemsUnshipped:
            status === "Canceled" ? 0 : Math.max(0, ordered - units.shipped - units.cancelled),
          shipCountry: country(address.country),
          shipRegion: text(address.state) || null,
          isBusiness: false,
          isPrime: false,
          isReplacement: false,
          earliestDelivery: delivery,
          latestDelivery: delivery,
        },
        items,
      },
    ];
  });
  return { orders, next: cursor && raw.length ? cursor : null };
}

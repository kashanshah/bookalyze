import { formatDecimal, parseDecimal } from "../money";

/**
 * Amazon orders (Orders API v0): parsing, status wording and the sync window. Orders are kept
 * for the Orders screen and analytics; the books are written from settlements later, so nothing
 * here touches the ledger. The sync keeps no buyer details, only the ship-to country and region
 * (which sales tax depends on). A customer invoice may ask for the name and tax number later.
 */

/** Amazon's order statuses, in the words the Orders screen uses. */
export const AMAZON_ORDER_STATUSES = {
  Pending: { label: "Pending", hint: "Placed, but Amazon hasn't confirmed the payment yet." },
  PendingAvailability: { label: "Pre-order", hint: "Waiting for the item's release date." },
  Unshipped: { label: "To ship", hint: "Paid and waiting to be shipped." },
  PartiallyShipped: { label: "Partly shipped", hint: "Some items have shipped." },
  Shipped: { label: "Shipped", hint: "Every item has shipped." },
  InvoiceUnconfirmed: { label: "Shipped", hint: "Shipped; the invoice isn't confirmed yet." },
  Canceled: { label: "Cancelled", hint: "Cancelled before it shipped." },
  Unfulfillable: { label: "Can't be fulfilled", hint: "Amazon couldn't fulfil it." },
} as const;
export type AmazonOrderStatus = keyof typeof AMAZON_ORDER_STATUSES;

/** The groups the Orders screen filters by. */
export const ORDER_STATUS_GROUPS = {
  open: ["Pending", "PendingAvailability", "Unshipped", "PartiallyShipped"],
  shipped: ["Shipped", "InvoiceUnconfirmed"],
  cancelled: ["Canceled", "Unfulfillable"],
} as const satisfies Record<string, readonly AmazonOrderStatus[]>;
export type OrderStatusGroup = keyof typeof ORDER_STATUS_GROUPS;

export function orderStatusLabel(status: string): { label: string; hint: string } {
  return AMAZON_ORDER_STATUSES[status as AmazonOrderStatus] ?? { label: status, hint: "" };
}

/** Orders without final prices yet: their items are fetched once they move on. */
export const isPriceless = (status: string) =>
  status === "Pending" || status === "PendingAvailability";

export type AmazonOrder = {
  orderId: string;
  marketplaceId: string;
  /** ISO timestamps, as Amazon gives them (UTC). */
  purchasedAt: string;
  lastUpdatedAt: string;
  status: string;
  fulfillment: "amazon" | "merchant";
  currency: string | null;
  /** Null until Amazon prices it (pending orders). */
  total: string | null;
  itemsShipped: number;
  itemsUnshipped: number;
  shipCountry: string | null;
  shipRegion: string | null;
  isBusiness: boolean;
  isPrime: boolean;
  isReplacement: boolean;
  /** For a replacement order: the order number it replaces. */
  replacedOrderId?: string | null;
  /** Promised delivery dates (YYYY-MM-DD): Amazon's review request window hangs off them. */
  earliestDelivery: string | null;
  latestDelivery: string | null;
};

export type AmazonOrderItem = {
  itemId: string;
  asin: string;
  sku: string | null;
  title: string | null;
  quantityOrdered: number;
  quantityShipped: number;
  /** For the whole quantity, in the order's currency. */
  itemPrice: string | null;
  itemTax: string | null;
  shippingPrice: string | null;
  shippingTax: string | null;
  /** Shown as positive amounts taken off. */
  promotionDiscount: string | null;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const text = (v: unknown) => (typeof v === "string" ? v : "");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

/** A Money object ({ CurrencyCode, Amount }) as an exact decimal string, or null. */
function money(v: unknown): string | null {
  const amount = record(v).Amount;
  const value = typeof amount === "number" ? String(amount) : text(amount);
  if (!value) return null;
  try {
    return formatDecimal(parseDecimal(value));
  } catch {
    return null;
  }
}

/** Parses one page of GET /orders/v0/orders. */
export function parseOrdersPage(json: unknown): {
  orders: AmazonOrder[];
  nextToken: string | null;
} {
  const payload = record(record(json).payload);
  if (!Array.isArray(payload.Orders)) throw new Error("Unexpected response from Amazon.");
  const orders = payload.Orders.flatMap((raw): AmazonOrder[] => {
    const o = record(raw);
    const orderId = text(o.AmazonOrderId);
    const purchasedAt = text(o.PurchaseDate);
    if (!orderId || !purchasedAt) return [];
    const total = record(o.OrderTotal);
    const address = record(o.ShippingAddress);
    const latest = text(o.LatestDeliveryDate);
    const earliest = text(o.EarliestDeliveryDate);
    const day = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
    return [
      {
        orderId,
        marketplaceId: text(o.MarketplaceId),
        purchasedAt,
        lastUpdatedAt: text(o.LastUpdateDate) || purchasedAt,
        status: text(o.OrderStatus) || "Pending",
        fulfillment: o.FulfillmentChannel === "AFN" ? "amazon" : "merchant",
        currency: text(total.CurrencyCode) || null,
        total: money(total),
        itemsShipped: count(o.NumberOfItemsShipped),
        itemsUnshipped: count(o.NumberOfItemsUnshipped),
        shipCountry: text(address.CountryCode).slice(0, 2) || null,
        shipRegion: text(address.StateOrRegion).slice(0, 100) || null,
        isBusiness: o.IsBusinessOrder === true,
        isPrime: o.IsPrime === true,
        isReplacement: o.IsReplacementOrder === true || o.IsReplacementOrder === "true",
        replacedOrderId: text(o.ReplacedOrderId) || null,
        earliestDelivery: day(earliest),
        latestDelivery: day(latest),
      },
    ];
  });
  return { orders, nextToken: text(payload.NextToken) || null };
}

/** Parses one page of GET /orders/v0/orders/{orderId}/orderItems. */
export function parseOrderItemsPage(json: unknown): {
  items: AmazonOrderItem[];
  nextToken: string | null;
} {
  const payload = record(record(json).payload);
  if (!Array.isArray(payload.OrderItems)) throw new Error("Unexpected response from Amazon.");
  const items = payload.OrderItems.flatMap((raw): AmazonOrderItem[] => {
    const i = record(raw);
    const itemId = text(i.OrderItemId);
    if (!itemId) return [];
    const discount = money(i.PromotionDiscount);
    return [
      {
        itemId,
        asin: text(i.ASIN),
        sku: text(i.SellerSKU) || null,
        title: text(i.Title).slice(0, 500) || null,
        quantityOrdered: count(i.QuantityOrdered),
        quantityShipped: count(i.QuantityShipped),
        itemPrice: money(i.ItemPrice),
        itemTax: money(i.ItemTax),
        shippingPrice: money(i.ShippingPrice),
        shippingTax: money(i.ShippingTax),
        promotionDiscount: discount && parseDecimal(discount) !== 0n ? discount : null,
      },
    ];
  });
  return { items, nextToken: text(payload.NextToken) || null };
}

/** Re-read this far before the last sync: Amazon updates orders after the fact. */
export const ORDER_SYNC_OVERLAP_MS = 60 * 60 * 1000;
/** Amazon wants LastUpdatedBefore at least two minutes in the past. */
const ORDER_SYNC_LAG_MS = 3 * 60 * 1000;

/**
 * The window of the next orders query: everything updated since the last sync (less an hour),
 * or since the start date on the first one, up to a few minutes ago.
 */
export function orderSyncWindow(input: {
  /** First day to bring in (YYYY-MM-DD), chosen when orders were switched on. */
  from: string;
  syncedThrough: Date | null;
  now: Date;
}): { after: string; before: string } {
  const start = new Date(`${input.from}T00:00:00Z`).getTime();
  const after = input.syncedThrough
    ? Math.max(start, input.syncedThrough.getTime() - ORDER_SYNC_OVERLAP_MS)
    : start;
  const before = input.now.getTime() - ORDER_SYNC_LAG_MS;
  return {
    after: new Date(Math.min(after, before - 1000)).toISOString(),
    before: new Date(before).toISOString(),
  };
}

/** The order's page in Seller Central (the marketplace's own domain). */
export function sellerCentralOrderUrl(channelName: string, orderId: string): string | null {
  if (!/^Amazon\.[a-z.]+$/i.test(channelName)) return null;
  return `https://sellercentral.${channelName.toLowerCase()}/orders-v3/order/${encodeURIComponent(orderId)}`;
}

import { formatDecimal, parseDecimal, sumDecimals } from "../money";
import type { AmazonOrder, AmazonOrderItem } from "./orders";

/**
 * eBay orders (Fulfillment API, GET /sell/fulfillment/v1/order): the query for a window and the
 * parsing of a page into the shapes the Orders screen already keeps (`orders`, `order_items`), so
 * eBay sits next to Amazon and Noon. One eBay account sells on several sites; each order belongs
 * to the site its items were listed on (the channel's marketplace id). No buyer details are kept,
 * only the ship-to country and region. Nothing here touches the ledger.
 */

export const EBAY_ORDERS_PATH = "/sell/fulfillment/v1/order";
/** eBay's largest page. */
export const EBAY_ORDERS_PAGE = 200;

/**
 * The query for one page. The first sync asks by creation date (from the start date chosen,
 * which reaches back past eBay's default 90 days); later ones by last change, so shipped and
 * cancelled orders are brought up to date.
 */
export function ebayOrdersQuery(input: {
  by: "creationdate" | "lastmodifieddate";
  after: string;
  before: string;
  offset: number;
}): string {
  const params = new URLSearchParams({
    filter: `${input.by}:[${input.after}..${input.before}]`,
    limit: String(EBAY_ORDERS_PAGE),
    offset: String(input.offset),
  });
  return `${EBAY_ORDERS_PATH}?${params.toString()}`;
}

export type EbayOrder = { order: AmazonOrder; items: AmazonOrderItem[] };

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

/** An Amount ({ value, currency }) as an exact decimal string, or null. */
function amount(v: unknown): string | null {
  const raw = record(v).value;
  const value = typeof raw === "number" ? String(raw) : text(raw);
  if (!value) return null;
  try {
    return formatDecimal(parseDecimal(value));
  } catch {
    return null;
  }
}

/** The sum of several amounts, or null when there are none. */
function sum(values: readonly (string | null)[]): string | null {
  const present = values.filter((v): v is string => v !== null);
  return present.length ? sumDecimals(present) : null;
}

/**
 * eBay's states in the words the Orders screen already has: cancelled, not paid yet, shipped,
 * partly shipped or to ship.
 */
export function ebayOrderStatus(order: unknown): string {
  const o = record(order);
  const cancel = text(record(o.cancelStatus).cancelState);
  if (cancel === "CANCELED") return "Canceled";
  const payment = text(o.orderPaymentStatus);
  if (payment === "PENDING" || payment === "FAILED") return "Pending";
  const fulfilment = text(o.orderFulfillmentStatus);
  if (fulfilment === "FULFILLED") return "Shipped";
  if (fulfilment === "IN_PROGRESS") return "PartiallyShipped";
  return "Unshipped";
}

/**
 * Parses one page, keeping the orders listed on `marketplaceId` (eBay's site id, e.g. EBAY_US).
 * `next` is the offset of the next page, or null on the last one.
 */
export function parseEbayOrdersPage(
  json: unknown,
  marketplaceId: string,
): { orders: EbayOrder[]; next: number | null } {
  const page = record(json);
  if (!("total" in page) && !Array.isArray(page.orders)) {
    throw new Error("Unexpected response from eBay.");
  }
  const raw = list(page.orders);
  const offset = count(page.offset);
  const total = count(page.total);
  const seen = offset + raw.length;
  const next = raw.length && seen < total ? seen : null;

  const orders = raw.flatMap((r): EbayOrder[] => {
    const o = record(r);
    const orderId = text(o.orderId);
    const purchasedAt = text(o.creationDate);
    const lineItems = list(o.lineItems).map(record);
    if (!orderId || !purchasedAt || !lineItems.length) return [];
    const site =
      text(lineItems[0]?.listingMarketplaceId) || text(lineItems[0]?.purchaseMarketplaceId);
    if (site !== marketplaceId) return [];

    const items = lineItems.map((li): AmazonOrderItem => {
      const quantity = count(li.quantity);
      const shipped = text(li.lineItemFulfillmentStatus) === "FULFILLED";
      return {
        itemId: text(li.lineItemId) || text(li.legacyItemId),
        // The listing's item number, so the order page can say which listing it was.
        asin: text(li.legacyItemId),
        // The seller's SKU; a listing without one is matched by its item number.
        sku: text(li.sku) || text(li.legacyItemId) || null,
        title: text(li.title) || null,
        quantityOrdered: quantity,
        quantityShipped: shipped ? quantity : 0,
        itemPrice: amount(li.lineItemCost),
        itemTax: sum(list(li.taxes).map((t) => amount(record(t).amount))),
        shippingPrice: amount(record(li.deliveryCost).shippingCost),
        shippingTax: null,
        promotionDiscount: sum(
          list(li.appliedPromotions).map((p) => amount(record(p).discountAmount)),
        ),
      };
    });

    const total = record(record(o.pricingSummary).total);
    const instructions = record(list(o.fulfillmentStartInstructions)[0]);
    const address = record(record(record(instructions.shippingStep).shipTo).contactAddress);
    const day = (v: unknown) => text(v).slice(0, 10) || null;
    const status = ebayOrderStatus(o);
    const shipped = items.reduce((n, i) => n + i.quantityShipped, 0);
    const ordered = items.reduce((n, i) => n + i.quantityOrdered, 0);
    return [
      {
        order: {
          orderId,
          marketplaceId: site,
          purchasedAt,
          lastUpdatedAt: text(o.lastModifiedDate) || purchasedAt,
          status,
          fulfillment: "merchant",
          currency: text(total.currency) || null,
          total: amount(total),
          itemsShipped: shipped,
          itemsUnshipped: status === "Canceled" ? 0 : ordered - shipped,
          shipCountry: text(address.countryCode) || null,
          shipRegion: text(address.stateOrProvince) || null,
          isBusiness: false,
          isPrime: false,
          isReplacement: false,
          earliestDelivery: day(instructions.minEstimatedDeliveryDate),
          latestDelivery: day(instructions.maxEstimatedDeliveryDate),
        },
        items,
      },
    ];
  });
  return { orders, next };
}

/** The order's page in Seller Hub, on the channel's eBay site. */
export function ebayOrderUrl(site: string, orderId: string): string {
  return `https://www.${site}/sh/ord/details?orderid=${encodeURIComponent(orderId)}`;
}

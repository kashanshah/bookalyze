import { describe, expect, it } from "vitest";
import {
  ebayOrderStatus,
  ebayOrdersQuery,
  ebayOrderUrl,
  parseEbayOrdersPage,
} from "../commerce/ebay-orders";

const lineItem = (over: Record<string, unknown> = {}) => ({
  lineItemId: "10001",
  legacyItemId: "110550001",
  sku: "MUG-01",
  title: "Maple leaf ceramic mug",
  quantity: 2,
  lineItemCost: { value: "30.00", currency: "USD" },
  deliveryCost: { shippingCost: { value: "5.50", currency: "USD" } },
  taxes: [{ amount: { value: "2.40", currency: "USD" } }],
  appliedPromotions: [{ discountAmount: { value: "3.00", currency: "USD" } }],
  lineItemFulfillmentStatus: "FULFILLED",
  listingMarketplaceId: "EBAY_US",
  ...over,
});

const order = (over: Record<string, unknown> = {}) => ({
  orderId: "12-34567-89012",
  creationDate: "2026-09-02T14:05:00.000Z",
  lastModifiedDate: "2026-09-03T09:00:00.000Z",
  orderFulfillmentStatus: "FULFILLED",
  orderPaymentStatus: "PAID",
  cancelStatus: { cancelState: "NONE_REQUESTED" },
  pricingSummary: { total: { value: "35.30", currency: "USD" } },
  fulfillmentStartInstructions: [
    {
      minEstimatedDeliveryDate: "2026-09-06T07:00:00.000Z",
      maxEstimatedDeliveryDate: "2026-09-09T07:00:00.000Z",
      shippingStep: {
        shipTo: {
          fullName: "Synthetic Buyer",
          contactAddress: { countryCode: "US", stateOrProvince: "WA", city: "Seattle" },
        },
      },
    },
  ],
  lineItems: [lineItem()],
  ...over,
});

describe("ebayOrdersQuery", () => {
  it("asks a window by creation or last change, 200 a page", () => {
    const q = ebayOrdersQuery({
      by: "creationdate",
      after: "2025-10-01T00:00:00.000Z",
      before: "2026-10-01T00:00:00.000Z",
      offset: 400,
    });
    const params = new URL(`https://x${q}`).searchParams;
    expect(q.startsWith("/sell/fulfillment/v1/order?")).toBe(true);
    expect(params.get("filter")).toBe(
      "creationdate:[2025-10-01T00:00:00.000Z..2026-10-01T00:00:00.000Z]",
    );
    expect(params.get("limit")).toBe("200");
    expect(params.get("offset")).toBe("400");
  });
});

describe("ebayOrderStatus", () => {
  it("maps eBay's states to the Orders screen's", () => {
    expect(ebayOrderStatus(order())).toBe("Shipped");
    expect(ebayOrderStatus(order({ orderFulfillmentStatus: "IN_PROGRESS" }))).toBe(
      "PartiallyShipped",
    );
    expect(ebayOrderStatus(order({ orderFulfillmentStatus: "NOT_STARTED" }))).toBe("Unshipped");
    expect(ebayOrderStatus(order({ orderPaymentStatus: "PENDING" }))).toBe("Pending");
    expect(ebayOrderStatus(order({ cancelStatus: { cancelState: "CANCELED" } }))).toBe("Canceled");
  });
});

describe("parseEbayOrdersPage", () => {
  it("keeps the order and its items, without the buyer's details", () => {
    const page = parseEbayOrdersPage(
      { total: 1, offset: 0, limit: 200, orders: [order()] },
      "EBAY_US",
    );
    expect(page.next).toBeNull();
    expect(page.orders).toHaveLength(1);
    const [{ order: o, items }] = page.orders as [(typeof page.orders)[number]];
    expect(o).toMatchObject({
      orderId: "12-34567-89012",
      marketplaceId: "EBAY_US",
      purchasedAt: "2026-09-02T14:05:00.000Z",
      lastUpdatedAt: "2026-09-03T09:00:00.000Z",
      status: "Shipped",
      fulfillment: "merchant",
      currency: "USD",
      total: "35.3000",
      itemsShipped: 2,
      itemsUnshipped: 0,
      shipCountry: "US",
      shipRegion: "WA",
      earliestDelivery: "2026-09-06",
      latestDelivery: "2026-09-09",
    });
    expect(JSON.stringify(o)).not.toContain("Synthetic Buyer");
    expect(JSON.stringify(o)).not.toContain("Seattle");
    expect(items).toEqual([
      {
        itemId: "10001",
        asin: "110550001",
        sku: "MUG-01",
        title: "Maple leaf ceramic mug",
        quantityOrdered: 2,
        quantityShipped: 2,
        itemPrice: "30.0000",
        itemTax: "2.4000",
        shippingPrice: "5.5000",
        shippingTax: null,
        promotionDiscount: "3.0000",
      },
    ]);
  });

  it("leaves out orders listed on another eBay site", () => {
    const page = parseEbayOrdersPage(
      {
        total: 2,
        offset: 0,
        orders: [
          order(),
          order({ orderId: "B", lineItems: [lineItem({ listingMarketplaceId: "EBAY_CA" })] }),
        ],
      },
      "EBAY_CA",
    );
    expect(page.orders.map((o) => o.order.orderId)).toEqual(["B"]);
  });

  it("matches a listing without a SKU by its item number; unshipped items count as unshipped", () => {
    const page = parseEbayOrdersPage(
      {
        total: 1,
        orders: [
          order({
            orderFulfillmentStatus: "NOT_STARTED",
            lineItems: [lineItem({ sku: undefined, lineItemFulfillmentStatus: "NOT_STARTED" })],
          }),
        ],
      },
      "EBAY_US",
    );
    const [first] = page.orders;
    expect(first?.items[0]?.sku).toBe("110550001");
    expect(first?.items[0]?.quantityShipped).toBe(0);
    expect(first?.order).toMatchObject({ status: "Unshipped", itemsShipped: 0, itemsUnshipped: 2 });
  });

  it("gives the next page's offset until the last page", () => {
    const orders = Array.from({ length: 200 }, (_, i) => order({ orderId: `O${i}` }));
    expect(parseEbayOrdersPage({ total: 450, offset: 200, orders }, "EBAY_US").next).toBe(400);
    expect(parseEbayOrdersPage({ total: 400, offset: 200, orders }, "EBAY_US").next).toBeNull();
    expect(parseEbayOrdersPage({ total: 0, orders: [] }, "EBAY_US")).toEqual({
      orders: [],
      next: null,
    });
  });

  it("refuses an answer that isn't a page of orders", () => {
    expect(() => parseEbayOrdersPage({ errors: [] }, "EBAY_US")).toThrow();
  });
});

describe("ebayOrderUrl", () => {
  it("opens the order in Seller Hub on its site", () => {
    expect(ebayOrderUrl("ebay.ca", "12-34567-89012")).toBe(
      "https://www.ebay.ca/sh/ord/details?orderid=12-34567-89012",
    );
  });
});

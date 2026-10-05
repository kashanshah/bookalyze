import { describe, expect, it } from "vitest";
import {
  orderStatusLabel,
  orderSyncWindow,
  parseOrderItemsPage,
  parseOrdersPage,
  sellerCentralOrderUrl,
} from "../commerce/orders";

describe("parseOrdersPage", () => {
  it("reads orders, money as exact decimals, and the next page token", () => {
    const page = parseOrdersPage({
      payload: {
        NextToken: "page-2",
        Orders: [
          {
            AmazonOrderId: "702-0000001-0000001",
            MarketplaceId: "A2EUQ1WTGCTBG2",
            PurchaseDate: "2026-09-01T14:03:00Z",
            LastUpdateDate: "2026-09-02T10:00:00Z",
            OrderStatus: "Shipped",
            FulfillmentChannel: "AFN",
            OrderTotal: { CurrencyCode: "CAD", Amount: "45.19" },
            NumberOfItemsShipped: 2,
            NumberOfItemsUnshipped: 0,
            ShippingAddress: { StateOrRegion: "ON", CountryCode: "CA" },
            IsPrime: true,
            LatestDeliveryDate: "2026-09-05T06:59:59Z",
          },
          {
            AmazonOrderId: "702-0000002-0000002",
            PurchaseDate: "2026-09-03T09:00:00Z",
            OrderStatus: "Pending",
            FulfillmentChannel: "MFN",
          },
          { PurchaseDate: "2026-09-03T09:00:00Z" },
        ],
      },
    });
    expect(page.nextToken).toBe("page-2");
    expect(page.orders).toHaveLength(2);
    expect(page.orders[0]).toMatchObject({
      orderId: "702-0000001-0000001",
      status: "Shipped",
      fulfillment: "amazon",
      currency: "CAD",
      total: "45.1900",
      itemsShipped: 2,
      shipCountry: "CA",
      shipRegion: "ON",
      isPrime: true,
      latestDelivery: "2026-09-05",
    });
    expect(page.orders[1]).toMatchObject({
      fulfillment: "merchant",
      total: null,
      currency: null,
      lastUpdatedAt: "2026-09-03T09:00:00Z",
    });
  });

  it("refuses a response that isn't an orders page", () => {
    expect(() => parseOrdersPage({ errors: [] })).toThrow(/Unexpected/);
  });
});

describe("parseOrderItemsPage", () => {
  it("reads items, leaving out zero discounts", () => {
    const { items, nextToken } = parseOrderItemsPage({
      payload: {
        OrderItems: [
          {
            OrderItemId: "11111",
            ASIN: "B000TEST01",
            SellerSKU: "MAPLE-MUG",
            Title: "Maple mug",
            QuantityOrdered: 2,
            QuantityShipped: 2,
            ItemPrice: { CurrencyCode: "CAD", Amount: "39.98" },
            ItemTax: { CurrencyCode: "CAD", Amount: "5.20" },
            PromotionDiscount: { CurrencyCode: "CAD", Amount: "0.00" },
          },
        ],
      },
    });
    expect(nextToken).toBeNull();
    expect(items).toEqual([
      {
        itemId: "11111",
        asin: "B000TEST01",
        sku: "MAPLE-MUG",
        title: "Maple mug",
        quantityOrdered: 2,
        quantityShipped: 2,
        itemPrice: "39.9800",
        itemTax: "5.2000",
        shippingPrice: null,
        shippingTax: null,
        promotionDiscount: null,
      },
    ]);
  });
});

describe("orderSyncWindow", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("starts at the chosen date the first time", () => {
    expect(orderSyncWindow({ from: "2026-07-01", syncedThrough: null, now })).toEqual({
      after: "2026-07-01T00:00:00.000Z",
      before: "2026-10-05T11:57:00.000Z",
    });
  });
  it("then re-reads an hour before the last sync, never before the start date", () => {
    expect(
      orderSyncWindow({ from: "2026-07-01", syncedThrough: new Date("2026-10-04T12:00:00Z"), now })
        .after,
    ).toBe("2026-10-04T11:00:00.000Z");
    expect(
      orderSyncWindow({ from: "2026-10-04", syncedThrough: new Date("2026-10-04T00:30:00Z"), now })
        .after,
    ).toBe("2026-10-04T00:00:00.000Z");
  });
});

describe("wording and links", () => {
  it("names statuses plainly and links to Seller Central", () => {
    expect(orderStatusLabel("Unshipped").label).toBe("To ship");
    expect(orderStatusLabel("SomethingNew").label).toBe("SomethingNew");
    expect(sellerCentralOrderUrl("Amazon.ca", "702-1")).toBe(
      "https://sellercentral.amazon.ca/orders-v3/order/702-1",
    );
    expect(sellerCentralOrderUrl("Website", "1")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  parseWalmartOrdersPage,
  walmartOrdersNextPath,
  walmartOrdersQuery,
  walmartShipNodes,
} from "../commerce/walmart-orders";

const ms = (iso: string) => new Date(iso).getTime();
const charge = (type: string, amount: number, tax?: number) => ({
  chargeType: type,
  chargeName: type === "PRODUCT" ? "ItemPrice" : "Shipping",
  chargeAmount: { currency: "CAD", amount },
  ...(tax !== undefined
    ? { tax: { taxName: "Tax1", taxAmount: { currency: "CAD", amount: tax } } }
    : {}),
});
const line = (input: {
  n: number;
  sku: string;
  qty: number;
  statuses: [string, number][];
  price: number;
  tax?: number;
  shipping?: number;
  changed?: string;
}) => ({
  lineNumber: String(input.n),
  item: { productName: `Product ${input.sku}`, sku: input.sku },
  charges: {
    charge: [
      charge("PRODUCT", input.price, input.tax),
      ...(input.shipping !== undefined ? [charge("SHIPPING", input.shipping)] : []),
    ],
  },
  orderLineQuantity: { unitOfMeasurement: "EACH", amount: String(input.qty) },
  statusDate: input.changed ? ms(input.changed) : undefined,
  orderLineStatuses: {
    orderLineStatus: input.statuses.map(([status, amount]) => ({
      status,
      statusQuantity: { unitOfMeasurement: "EACH", amount: String(amount) },
    })),
  },
});
const order = (input: {
  po: string;
  date: string;
  node?: string;
  lines: ReturnType<typeof line>[];
}) => ({
  purchaseOrderId: input.po,
  customerOrderId: `C${input.po}`,
  customerEmailId: "synthetic@relay.walmart.com",
  orderDate: ms(input.date),
  shippingInfo: {
    phone: "0000000000",
    estimatedDeliveryDate: ms("2026-10-15T00:00:00Z"),
    postalAddress: {
      name: "Synthetic Buyer",
      address1: "1 Test St",
      city: "Toronto",
      state: "ON",
      postalCode: "M0M 0M0",
      country: "CAN",
    },
  },
  orderLines: { orderLine: input.lines },
  shipNode: { type: input.node ?? "SellerFulfilled" },
});

describe("Walmart orders query", () => {
  it("asks each kind of shipping on its own, from who ships the channel's orders", () => {
    expect(walmartShipNodes("seller")).toEqual(["SellerFulfilled"]);
    expect(walmartShipNodes("marketplace")).toEqual(["WFSFulfilled"]);
    expect(walmartShipNodes("both")).toEqual(["SellerFulfilled", "WFSFulfilled"]);
    expect(walmartShipNodes(null)).toEqual(["SellerFulfilled", "WFSFulfilled"]);
  });

  it("asks by creation date first, then by last change, 200 a page", () => {
    const q = walmartOrdersQuery({
      by: "created",
      after: "2026-01-01T00:00:00.000Z",
      before: "2026-10-20T00:00:00.000Z",
      shipNode: "WFSFulfilled",
    });
    const params = new URL(`https://x${q}`).searchParams;
    expect(q.startsWith("/v3/orders?")).toBe(true);
    expect(Object.fromEntries(params)).toEqual({
      createdStartDate: "2026-01-01T00:00:00.000Z",
      createdEndDate: "2026-10-20T00:00:00.000Z",
      limit: "200",
      shipNodeType: "WFSFulfilled",
    });
    expect(
      walmartOrdersQuery({
        by: "lastModified",
        after: "a",
        before: "b",
        shipNode: "SellerFulfilled",
      }),
    ).toContain("lastModifiedStartDate=a");
    expect(walmartOrdersNextPath("?limit=200&hasMoreElements=true&soIndex=2")).toBe(
      "/v3/orders?limit=200&hasMoreElements=true&soIndex=2",
    );
    expect(walmartOrdersNextPath("limit=200")).toBe("/v3/orders?limit=200");
  });
});

describe("Walmart orders page", () => {
  it("reads purchase orders into the Orders screen's shapes, without buyer details", () => {
    const page = parseWalmartOrdersPage({
      list: {
        meta: { totalCount: 3, limit: 200, nextCursor: "?limit=200&soIndex=3" },
        elements: {
          order: [
            order({
              po: "1000001",
              date: "2026-10-05T14:00:00Z",
              lines: [
                line({
                  n: 1,
                  sku: "WMT-MUG",
                  qty: 2,
                  statuses: [["Shipped", 2]],
                  price: 39.98,
                  tax: 5.2,
                  shipping: 4.99,
                  changed: "2026-10-07T10:00:00Z",
                }),
              ],
            }),
            order({
              po: "1000002",
              date: "2026-10-06T09:00:00Z",
              node: "WFSFulfilled",
              lines: [
                line({ n: 1, sku: "WMT-MUG", qty: 1, statuses: [["Shipped", 1]], price: 19.99 }),
                line({
                  n: 2,
                  sku: "WMT-TOWEL",
                  qty: 2,
                  statuses: [["Acknowledged", 2]],
                  price: 25,
                }),
              ],
            }),
            order({
              po: "1000003",
              date: "2026-10-07T09:00:00Z",
              lines: [
                line({ n: 1, sku: "WMT-TOWEL", qty: 1, statuses: [["Cancelled", 1]], price: 12.5 }),
              ],
            }),
          ],
        },
      },
    });
    expect(page.next).toBe("?limit=200&soIndex=3");
    expect(page.orders.map((o) => [o.order.orderId, o.order.status, o.order.fulfillment])).toEqual([
      ["1000001", "Shipped", "merchant"],
      ["1000002", "PartiallyShipped", "amazon"],
      ["1000003", "Canceled", "merchant"],
    ]);
    const [first, second, third] = page.orders;
    expect(first?.order).toMatchObject({
      purchasedAt: "2026-10-05T14:00:00.000Z",
      lastUpdatedAt: "2026-10-07T10:00:00.000Z",
      currency: "CAD",
      total: "50.1700",
      itemsShipped: 2,
      itemsUnshipped: 0,
      shipCountry: "CA",
      shipRegion: "ON",
      earliestDelivery: "2026-10-15",
    });
    expect(first?.items).toEqual([
      {
        itemId: "1",
        asin: "",
        sku: "WMT-MUG",
        title: "Product WMT-MUG",
        quantityOrdered: 2,
        quantityShipped: 2,
        itemPrice: "39.9800",
        itemTax: "5.2000",
        shippingPrice: "4.9900",
        shippingTax: null,
        promotionDiscount: null,
      },
    ]);
    expect(second?.order).toMatchObject({ itemsShipped: 1, itemsUnshipped: 2, total: "44.9900" });
    expect(third?.order).toMatchObject({ itemsShipped: 0, itemsUnshipped: 0 });
    // Nothing about the buyer is kept.
    expect(JSON.stringify(page.orders)).not.toMatch(/Synthetic Buyer|Test St|relay\.walmart|M0M/);
  });

  it("takes a single order or line sent bare, skips orders it can't place, and stops at the last page", () => {
    const page = parseWalmartOrdersPage({
      list: {
        meta: { totalCount: 2, nextCursor: null },
        elements: {
          order: [
            {
              ...order({ po: "2000001", date: "2026-10-01T00:00:00Z", lines: [] }),
              orderLines: {
                orderLine: line({ n: 1, sku: "ONE", qty: 1, statuses: [["Created", 1]], price: 5 }),
              },
            },
            order({
              po: "",
              date: "2026-10-01T00:00:00Z",
              lines: [line({ n: 1, sku: "X", qty: 1, statuses: [], price: 1 })],
            }),
          ],
        },
      },
    });
    expect(page.next).toBeNull();
    expect(page.orders.map((o) => [o.order.orderId, o.order.status])).toEqual([
      ["2000001", "Unshipped"],
    ]);
    expect(parseWalmartOrdersPage({ list: { meta: {}, elements: {} } })).toEqual({
      orders: [],
      next: null,
    });
    expect(() => parseWalmartOrdersPage({ error: [] })).toThrow(/Unexpected response/);
  });
});

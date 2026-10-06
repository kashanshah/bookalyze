import { describe, expect, it } from "vitest";
import { parseRefundEventsPage, refundState, refundSyncWindow } from "../commerce/refunds";

const cad = (n: number) => ({ CurrencyCode: "CAD", CurrencyAmount: n });

describe("parseRefundEventsPage", () => {
  it("reads each refunded item: price, shipping and tax back, less promotions clawed back", () => {
    const page = parseRefundEventsPage({
      payload: {
        NextToken: "events-2",
        FinancialEvents: {
          ShipmentEventList: [{ AmazonOrderId: "702-0000009-0000009" }],
          RefundEventList: [
            {
              AmazonOrderId: "702-0000001-0000001",
              MarketplaceName: "Amazon.ca",
              PostedDate: "2026-09-20T12:00:00Z",
              ShipmentItemAdjustmentList: [
                {
                  OrderAdjustmentItemId: "adj-1",
                  SellerSKU: "MAPLE-MUG",
                  QuantityShipped: 1,
                  ItemChargeAdjustmentList: [
                    { ChargeType: "Principal", ChargeAmount: cad(-19.99) },
                    { ChargeType: "Tax", ChargeAmount: cad(-2.6) },
                    { ChargeType: "RestockingFee", ChargeAmount: cad(1) },
                  ],
                  PromotionAdjustmentList: [{ PromotionAmount: cad(2) }],
                  // Amazon's fees given back to the seller aren't the buyer's refund.
                  ItemFeeAdjustmentList: [{ FeeType: "Commission", FeeAmount: cad(3) }],
                },
                { SellerSKU: "ZERO", ItemChargeAdjustmentList: [] },
              ],
            },
            { PostedDate: "2026-09-20T12:00:00Z" },
          ],
        },
      },
    });
    expect(page.nextToken).toBe("events-2");
    expect(page.refunds).toEqual([
      {
        orderId: "702-0000001-0000001",
        adjustmentId: "adj-1",
        postedAt: "2026-09-20T12:00:00Z",
        sku: "MAPLE-MUG",
        quantity: 1,
        amount: "19.5900",
        currency: "CAD",
      },
    ]);
  });

  it("reads a page with no refunds, and rejects what isn't a financial events page", () => {
    expect(parseRefundEventsPage({ payload: { FinancialEvents: {} } })).toEqual({
      refunds: [],
      nextToken: null,
    });
    expect(() => parseRefundEventsPage({ errors: [] })).toThrow();
  });
});

describe("refundSyncWindow", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("starts at the orders' start date, at most 179 days at once", () => {
    const w = refundSyncWindow({ from: "2026-01-01", syncedThrough: null, now });
    expect(w.after).toBe("2026-01-01T00:00:00.000Z");
    expect(w.before).toBe("2026-06-29T00:00:00.000Z");
  });
  it("starts no further back than Amazon keeps financial events (730 days)", () => {
    const w = refundSyncWindow({ from: "2024-10-05", syncedThrough: null, now });
    expect(w.after).toBe("2024-10-06T12:00:00.000Z");
  });

  it("then re-reads two days before the last sync, up to a few minutes ago", () => {
    const w = refundSyncWindow({
      from: "2026-01-01",
      syncedThrough: new Date("2026-10-01T00:00:00Z"),
      now,
    });
    expect(w.after).toBe("2026-09-29T00:00:00.000Z");
    expect(w.before).toBe("2026-10-05T11:57:00.000Z");
  });
});

describe("refundState", () => {
  it("is refunded when everything came back, partly when some did", () => {
    expect(refundState("45.19", null)).toBeNull();
    expect(refundState("45.19", "0")).toBeNull();
    expect(refundState("45.19", "22.59")).toBe("partly_refunded");
    expect(refundState("45.19", "45.19")).toBe("refunded");
    expect(refundState(null, "5.00")).toBe("partly_refunded");
  });
});

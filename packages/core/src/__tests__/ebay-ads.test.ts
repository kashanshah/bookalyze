import { describe, expect, it } from "vitest";
import { ebayAdMetricRows } from "../commerce/ebay-ads";

describe("eBay Promoted Listings as ad metrics", () => {
  const lines = [
    { orderId: "O-1", sku: "MUG", quantity: 2, sales: "30.00" },
    { orderId: "O-1", sku: "TOTE", quantity: 1, sales: "10.00" },
    { orderId: "O-2", sku: "MUG", quantity: 1, sales: "15.00" },
  ];

  it("shares an order's ad fee over its lines by sales, and counts the sale as the ad's", () => {
    const rows = ebayAdMetricRows([{ date: "2026-10-05", orderId: "O-1", amount: "-4.00" }], lines);
    expect(rows.map((r) => [r.sku, r.spend, r.attributedSales, r.attributedUnits])).toEqual([
      ["MUG", "3.0000", "30.0000", 2],
      ["TOTE", "1.0000", "10.0000", 1],
    ]);
    expect(rows[0]).toMatchObject({
      date: "2026-10-05",
      adType: "promoted_listings",
      campaignName: "Promoted Listings",
      attributedOrders: 1,
      attributionWindow: "30d",
    });
  });

  it("takes a fee given back off: given back in full, nothing is left", () => {
    const rows = ebayAdMetricRows(
      [
        { date: "2026-10-06", orderId: "O-2", amount: "-1.50" },
        { date: "2026-10-09", orderId: "O-2", amount: "1.50" },
      ],
      lines,
    );
    expect(rows).toEqual([]);
  });

  it("keeps a fee on no order Bookalyze has as spend tied to no product", () => {
    const rows = ebayAdMetricRows(
      [
        { date: "2026-10-07", orderId: null, amount: "-12.00" },
        { date: "2026-10-08", orderId: "O-UNKNOWN", amount: "-2.00" },
      ],
      lines,
    );
    expect(rows.map((r) => [r.date, r.sku, r.spend])).toEqual([
      ["2026-10-07", null, "12.0000"],
      ["2026-10-08", null, "2.0000"],
    ]);
  });
});

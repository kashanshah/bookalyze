import { describe, expect, it } from "vitest";
import { parseFbaInventoryPage } from "../commerce/fba-inventory";

describe("FBA inventory summaries", () => {
  it("reads SKUs, titles and what can be sold, and the next page", () => {
    const page = parseFbaInventoryPage({
      pagination: { nextToken: "abc" },
      payload: {
        inventorySummaries: [
          {
            asin: "B0MUG5",
            sellerSku: "MUG-500",
            productName: "Maple mug, 500ml",
            inventoryDetails: { fulfillableQuantity: 12 },
          },
          { asin: "B0X", sellerSku: " ", productName: "No SKU" },
          { sellerSku: "MUG-100" },
        ],
      },
    });
    expect(page).toEqual({
      items: [
        { sku: "MUG-500", asin: "B0MUG5", title: "Maple mug, 500ml", fulfillable: 12 },
        { sku: "MUG-100", asin: null, title: null, fulfillable: null },
      ],
      nextToken: "abc",
    });
    expect(parseFbaInventoryPage({ payload: { inventorySummaries: [] } }).nextToken).toBeNull();
    expect(() => parseFbaInventoryPage({})).toThrow();
  });
});

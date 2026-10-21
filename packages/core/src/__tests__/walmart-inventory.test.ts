import { describe, expect, it } from "vitest";
import {
  parseWalmartWfsInventoryPage,
  walmartWfsInventoryQuery,
} from "../commerce/walmart-inventory";

describe("walmartWfsInventoryQuery", () => {
  it("asks for a page of 300 from an offset", () => {
    expect(walmartWfsInventoryQuery(300)).toBe("/v3/fulfillment/inventory?offset=300&limit=300");
  });
});

describe("parseWalmartWfsInventoryPage", () => {
  it("reads each SKU's sellable and held units from its WFS nodes", () => {
    const page = parseWalmartWfsInventoryPage({
      headers: { totalCount: 3, limit: 300, offset: 0 },
      payload: {
        inventory: [
          {
            sku: " MUG-1 ",
            shipNodes: [
              { shipNodeType: "WFSFulfilled", availToSellQty: 30, onHandQty: 34 },
              { shipNodeType: "WFSFulfilled", availToSellQty: "2", onHandQty: "2" },
            ],
          },
          { sku: "EMPTY", shipNodes: [{ shipNodeType: "WFSFulfilled", onHandQty: 0 }] },
          { sku: "SELLER", shipNodes: [{ shipNodeType: "SellerFulfilled", availToSellQty: 9 }] },
          { sku: "", shipNodes: [{ availToSellQty: 1 }] },
        ],
      },
    });
    expect(page).toEqual({
      total: 3,
      items: [
        { sku: "MUG-1", fulfillable: 32, reserved: 4 },
        { sku: "EMPTY", fulfillable: 0, reserved: 0 },
      ],
    });
  });

  it("says when the answer isn't Walmart's inventory", () => {
    expect(() => parseWalmartWfsInventoryPage({ errors: [] })).toThrow(/Unexpected response/);
  });
});

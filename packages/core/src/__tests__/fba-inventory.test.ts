import { describe, expect, it } from "vitest";
import { parseFbaInventoryPage } from "../commerce/fba-inventory";

describe("FBA inventory summaries", () => {
  it("reads SKUs, titles, what can be sold, what's reserved, inbound or unsellable, and the next page", () => {
    const page = parseFbaInventoryPage({
      pagination: { nextToken: "abc" },
      payload: {
        inventorySummaries: [
          {
            asin: "B0MUG5",
            sellerSku: "MUG-500",
            productName: "Maple mug, 500ml",
            inventoryDetails: {
              fulfillableQuantity: 12,
              inboundWorkingQuantity: 0,
              inboundShippedQuantity: 20,
              inboundReceivingQuantity: 4,
              reservedQuantity: { totalReservedQuantity: 3 },
              unfulfillableQuantity: { totalUnfulfillableQuantity: 1 },
              researchingQuantity: { totalResearchingQuantity: 2 },
            },
          },
          { asin: "B0X", sellerSku: " ", productName: "No SKU" },
          { sellerSku: "MUG-100" },
        ],
      },
    });
    expect(page).toEqual({
      items: [
        {
          sku: "MUG-500",
          asin: "B0MUG5",
          title: "Maple mug, 500ml",
          fulfillable: 12,
          reserved: 3,
          inbound: 24,
          unfulfillable: 1,
          researching: 2,
        },
        {
          sku: "MUG-100",
          asin: null,
          title: null,
          fulfillable: null,
          reserved: null,
          inbound: null,
          unfulfillable: null,
          researching: null,
        },
      ],
      nextToken: "abc",
    });
    expect(parseFbaInventoryPage({ payload: { inventorySummaries: [] } }).nextToken).toBeNull();
    expect(() => parseFbaInventoryPage({})).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  parseWalmartInventoryLogPage,
  parseWalmartItemGtin,
  walmartInventoryLogQuery,
  walmartItemPath,
  walmartLogEventType,
} from "../commerce/walmart-inventory-log";

describe("walmart item lookup", () => {
  it("asks for the item by SKU and reads its GTIN, else its UPC", () => {
    expect(walmartItemPath("MUG 1/A")).toBe("/v3/items/MUG%201%2FA?productIdType=SKU");
    expect(parseWalmartItemGtin({ ItemResponse: [{ sku: "MUG", gtin: "00012345678905" }] })).toBe(
      "00012345678905",
    );
    expect(parseWalmartItemGtin({ ItemResponse: [{ sku: "MUG", upc: "012345678905" }] })).toBe(
      "012345678905",
    );
    expect(parseWalmartItemGtin({ ItemResponse: [{ sku: "MUG" }] })).toBeNull();
  });
});

describe("walmartInventoryLogQuery", () => {
  it("asks for a page of one GTIN's log between two days", () => {
    expect(
      walmartInventoryLogQuery({
        gtin: "00012345678905",
        from: "2026-09-01",
        to: "2026-09-30",
        offset: 200,
      }),
    ).toBe(
      "/v3/fulfillment/inventory-log?gtin=00012345678905&startDate=2026-09-01&endDate=2026-09-30&offset=200&limit=200",
    );
  });
});

describe("walmartLogEventType", () => {
  it.each([
    ["Customer Return", "", "CustomerReturns"],
    ["RETURN_TO_SELLER", "", "VendorReturns"],
    ["Removal Order", "", "VendorReturns"],
    ["Inventory Adjustment", "Damaged in warehouse", "Adjustments"],
    ["Adjustment", "Lost", "Adjustments"],
    ["Adjustment", "Found", "Adjustments"],
    ["Receiving", "", "Receipts"],
    ["Customer Order", "", "Shipments"],
    ["Transfer", "", "WhseTransfers"],
    ["Something new", "", "Other"],
    ["Customer Order", "Parts", "Shipments"],
  ])("reads %s / %s as %s", (type, reason, expected) => {
    expect(walmartLogEventType(type, reason)).toBe(expected);
  });
});

describe("parseWalmartInventoryLogPage", () => {
  it("reads each entry as a movement of the SKU, units in + and out −", () => {
    const page = parseWalmartInventoryLogPage(
      {
        headers: { totalCount: 4, offset: 0, limit: 200 },
        payload: {
          gtin: "00012345678905",
          productName: "Maple mug",
          inventoryLog: [
            {
              id: "L1",
              fcName: "YYZ1",
              transactionType: "Customer Return",
              transactionTime: "2026-09-10T14:00:00Z",
              changedQty: 1,
            },
            {
              id: "L2",
              transactionType: "Inventory Adjustment",
              transactionReasonDesc: "Damaged",
              transactionTime: "2026-09-12T10:00:00Z",
              changedQty: -2,
            },
            {
              id: "L3",
              transactionType: "Brand new type",
              transactionTime: "2026-09-13",
              changedQty: 3,
            },
            { id: "L4", transactionType: "Customer Order", changedQty: -1 },
          ],
        },
      },
      "WMT-MUG",
    );
    expect(page.total).toBe(4);
    expect(page.events.map((e) => [e.date, e.eventType, e.quantity, e.reason, e.key])).toEqual([
      ["2026-09-10", "CustomerReturns", 1, "Customer Return", "wfs:L1"],
      ["2026-09-12", "Adjustments", -2, "Damaged", "wfs:L2"],
      ["2026-09-13", "Other", 3, "Brand new type", "wfs:L3"],
    ]);
    expect(page.events[0]).toMatchObject({
      sku: "WMT-MUG",
      asin: "00012345678905",
      fulfillmentCenter: "YYZ1",
    });
  });

  it("says when the answer isn't a log", () => {
    expect(() => parseWalmartInventoryLogPage({ errors: [] }, "X")).toThrow(/Unexpected response/);
  });
});

import { describe, expect, it } from "vitest";
import {
  purchaseLineTotal,
  purchaseOrderNumber,
  purchaseOrderTotal,
  receiptProblems,
  receivingStatus,
  spreadTotal,
  unitCostFromTotal,
} from "../inventory/purchasing";

describe("purchase orders", () => {
  it("numbers them PO-0001…", () => {
    expect(purchaseOrderNumber(7)).toBe("PO-0007");
    expect(purchaseOrderNumber(12345)).toBe("PO-12345");
  });

  it("totals lines exactly, rounded to the currency", () => {
    expect(purchaseLineTotal(3, "12.5000", "USD")).toBe("37.5000");
    expect(purchaseLineTotal(3, "0.3333", "CAD")).toBe("1.0000");
    expect(purchaseLineTotal(7, "0.0050", "USD")).toBe("0.0400");
    expect(purchaseLineTotal(3, "10.3333", "JPY")).toBe("31.0000");
    expect(purchaseLineTotal(2, "1.2345", "KWD")).toBe("2.4690");
    expect(
      purchaseOrderTotal(
        [
          { quantity: 100, unitCost: "2.4500" },
          { quantity: 3, unitCost: "0.3333" },
        ],
        "CAD",
      ),
    ).toBe("246.0000");
  });

  it("knows how much has arrived", () => {
    expect(receivingStatus([{ quantity: 10, received: 0 }])).toBe("ordered");
    expect(
      receivingStatus([
        { quantity: 10, received: 10 },
        { quantity: 5, received: 2 },
      ]),
    ).toBe("partial");
    expect(
      receivingStatus([
        { quantity: 10, received: 10 },
        { quantity: 5, received: 5 },
      ]),
    ).toBe("received");
  });

  it("checks a delivery against what's still to come", () => {
    const lines = [
      { id: "a", quantity: 10, received: 4 },
      { id: "b", quantity: 5, received: 5 },
    ];
    expect(receiptProblems(lines, { a: 6 })).toEqual({ lines: {} });
    expect(receiptProblems(lines, { a: 7 }).lines.a).toBe("Only 6 still to come.");
    expect(receiptProblems(lines, { b: 1 }).lines.b).toBe("All of these have arrived.");
    expect(receiptProblems(lines, { a: 1.5 }).lines.a).toBe("Use a whole number.");
    expect(receiptProblems(lines, { a: 0 }).form).toMatch(/at least one/);
    expect(receiptProblems(lines, { z: 1 }).lines.z).toMatch(/isn't on the order/);
  });
});

describe("line totals typed in", () => {
  it("keeps the cost of one exact enough to give the total back", () => {
    expect(unitCostFromTotal("3514.77", 200)).toBe("17.57385");
    expect(unitCostFromTotal("100", 3)).toBe("33.3333333333");
    expect(purchaseLineTotal(3, "33.3333333333", "USD")).toBe("100.0000");
    expect(unitCostFromTotal("10", 0)).toBeNull();
    // Any total gives itself back, even for big quantities.
    for (const [total, quantity] of [
      ["7537.85", 560],
      ["99999.99", 9_999_991],
      ["0.01", 7],
    ] as const) {
      const cost = unitCostFromTotal(total, quantity) ?? "";
      expect(purchaseLineTotal(quantity, cost, "USD")).toBe(`${total}00`);
    }
  });

  it("spreads an order total over the lines by their totals", () => {
    expect(spreadTotal("1000", ["100", "300"], "USD")).toEqual(["250.0000", "750.0000"]);
    expect(spreadTotal("100", ["1", "1", "1"], "USD")).toEqual(["33.3400", "33.3300", "33.3300"]);
    expect(spreadTotal("100", ["0", "0"], "USD")).toBeNull();
  });
});

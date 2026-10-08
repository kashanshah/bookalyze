import { describe, expect, it } from "vitest";
import {
  purchaseLineTotal,
  purchaseOrderNumber,
  purchaseOrderTotal,
  receiptProblems,
  receivingStatus,
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

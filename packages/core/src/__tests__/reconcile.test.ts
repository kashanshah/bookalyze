import { describe, expect, it } from "vitest";
import { naturalAmount, reconciliationTotals } from "../accounting";

describe("reconciliation", () => {
  it("reads bank balances as money in the account", () => {
    const totals = reconciliationTotals({
      type: "asset",
      previouslyCleared: ["1000", "-200"],
      cleared: ["500", "-45.20"],
      statementBalance: "1254.80",
    });
    expect(totals).toEqual({
      opening: "800.0000",
      clearedChange: "454.8000",
      clearedBalance: "1254.8000",
      statementBalance: "1254.8000",
      difference: "0.0000",
      balanced: true,
    });
  });

  it("reads credit card balances as what's owed", () => {
    expect(naturalAmount("liability", "-84.75")).toBe("84.7500");
    const totals = reconciliationTotals({
      type: "liability",
      previouslyCleared: [],
      cleared: ["-84.75", "-15.25", "50"],
      statementBalance: "60",
    });
    expect(totals).toMatchObject({
      clearedBalance: "50.0000",
      difference: "10.0000",
      balanced: false,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  paidPercent,
  percentOfTotal,
  planAmounts,
  planProblems,
  planProgress,
} from "../inventory/purchase-payments";

describe("purchase order payment plans", () => {
  const plan = [
    { label: "Upfront", kind: "percent" as const, value: "35" },
    { label: "On completion", kind: "amount" as const, value: "3000" },
    { label: "At the shipping agent", kind: "percent" as const, value: "5" },
  ];

  it("works out each part in the order's currency", () => {
    expect(percentOfTotal("5000", "35", "USD")).toBe("1750.0000");
    expect(percentOfTotal("100.01", "33.3333", "USD")).toBe("33.3400");
    expect(percentOfTotal("12345", "50", "JPY")).toBe("6173.0000");
    expect(planAmounts(plan, "5000", "USD")).toEqual(["1750.0000", "3000.0000", "250.0000"]);
  });

  it("fills the parts in order with what's been paid", () => {
    const amounts = planAmounts(plan, "5000", "USD");
    expect(planProgress(amounts, "0").parts.map((p) => p.status)).toEqual(["due", "due", "due"]);
    expect(planProgress(amounts, "2000")).toEqual({
      parts: [
        { amount: "1750.0000", paid: "1750.0000", status: "paid" },
        { amount: "3000.0000", paid: "250.0000", status: "part" },
        { amount: "250.0000", paid: "0.0000", status: "due" },
      ],
      extra: "0.0000",
    });
    expect(planProgress(amounts, "5100").extra).toBe("100.0000");
  });

  it("says how much of the order is paid", () => {
    expect(paidPercent("1750", "5000")).toBe("35.0");
    expect(paidPercent("1", "3")).toBe("33.3");
    expect(paidPercent("10", "0")).toBe("0.0");
  });

  it("refuses parts over 100% and plans over the order", () => {
    expect(planProblems(plan, "5000", "USD")).toEqual({});
    expect(planProblems([{ label: "", kind: "percent", value: "120" }], "5000", "USD")).toEqual({
      0: "At most 100%.",
    });
    expect(planProblems([{ label: "", kind: "amount", value: "0" }], "5000", "USD")).toEqual({
      0: "Enter more than zero.",
    });
    expect(
      planProblems(
        [
          { label: "", kind: "percent", value: "60" },
          { label: "", kind: "amount", value: "2500" },
        ],
        "5000",
        "USD",
      ),
    ).toEqual({ plan: "The parts add up to more than the order." });
  });
});

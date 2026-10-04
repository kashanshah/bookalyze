import { describe, expect, it } from "vitest";
import { compareProfitAndLoss, comparisonPeriod, percentChange } from "../accounting/compare";
import { type AccountBalance, profitAndLoss } from "../accounting/reports";

describe("comparisonPeriod", () => {
  it("steps back a whole month, quarter or year when the range is whole months", () => {
    expect(comparisonPeriod("2026-03-01", "2026-03-31", "previous")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(comparisonPeriod("2026-04-01", "2026-06-30", "previous")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(comparisonPeriod("2025-07-01", "2026-06-30", "previous")).toEqual({
      from: "2024-07-01",
      to: "2025-06-30",
    });
  });

  it("uses the same number of days for other ranges", () => {
    expect(comparisonPeriod("2026-03-10", "2026-03-19", "previous")).toEqual({
      from: "2026-02-28",
      to: "2026-03-09",
    });
  });

  it("moves to the same dates a year earlier, keeping month ends", () => {
    expect(comparisonPeriod("2024-02-01", "2024-02-29", "last-year")).toEqual({
      from: "2023-02-01",
      to: "2023-02-28",
    });
    expect(comparisonPeriod("2025-02-01", "2025-02-28", "last-year")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(comparisonPeriod("2026-03-10", "2026-03-19", "last-year")).toEqual({
      from: "2025-03-10",
      to: "2025-03-19",
    });
  });
});

const bal = (
  accountId: string,
  type: AccountBalance["type"],
  subtype: string,
  balance: string,
  code: string,
): AccountBalance => ({
  accountId,
  code,
  name: accountId,
  type,
  subtype,
  balance,
});

describe("compareProfitAndLoss", () => {
  const now = profitAndLoss([
    bal("sales", "income", "income", "-600.0000", "4000"),
    bal("rent", "expense", "operating_expense", "200.0000", "6350"),
  ]);
  const before = profitAndLoss([
    bal("sales", "income", "income", "-500.0000", "4000"),
    bal("ads", "expense", "operating_expense", "50.0000", "6100"),
  ]);
  const cmp = compareProfitAndLoss(now, before);

  it("lines up each account with its earlier amount and the change", () => {
    expect(cmp.income.rows).toEqual([
      {
        accountId: "sales",
        code: "4000",
        name: "sales",
        amount: "600.0000",
        prior: "500.0000",
        change: "100.0000",
      },
    ]);
    expect(cmp.netProfit).toEqual({ amount: "400.0000", prior: "450.0000", change: "-50.0000" });
  });

  it("keeps accounts that only had activity in the earlier period", () => {
    expect(cmp.expenses.rows.map((r) => [r.accountId, r.amount, r.prior])).toEqual([
      ["ads", "0.0000", "50.0000"],
      ["rent", "200.0000", "0.0000"],
    ]);
    expect(cmp.expenses).toMatchObject({
      total: "200.0000",
      priorTotal: "50.0000",
      change: "150.0000",
    });
  });
});

describe("percentChange", () => {
  it("reads as people say it", () => {
    expect(percentChange("600", "500")).toBe("+20%");
    expect(percentChange("495", "500")).toBe("-1%");
    expect(percentChange("501", "500")).toBe("+0.2%");
    expect(percentChange("100", "0")).toBeNull();
    // A loss that shrinks is an improvement measured against the size of the loss.
    expect(percentChange("-50", "-100")).toBe("+50%");
  });
});

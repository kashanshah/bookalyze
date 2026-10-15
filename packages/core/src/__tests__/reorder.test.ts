import { describe, expect, it } from "vitest";
import { planReorder, roundOrder, salesVelocity } from "../inventory/reorder";

const days = (n: number, units: number) => Array.from({ length: n }, () => units);

describe("salesVelocity", () => {
  it("weights the last week most, the quarter least", () => {
    expect(salesVelocity(days(90, 2))).toBeCloseTo(2);
    // Selling 4 a day this week after 1 a day before: 0.5·4 + 0.3·(7·4+23)/30 + 0.2·(7·4+83)/90.
    const series = [...days(83, 1), ...days(7, 4)];
    expect(salesVelocity(series)).toBeCloseTo(2 + (0.3 * 51) / 30 + (0.2 * 111) / 90);
    expect(salesVelocity([])).toBe(0);
  });
});

describe("roundOrder", () => {
  it("rounds up to the minimum, then the case pack", () => {
    expect(roundOrder(0)).toBe(0);
    expect(roundOrder(-5, 100, 12)).toBe(0);
    expect(roundOrder(37.2)).toBe(38);
    expect(roundOrder(37, 100)).toBe(100);
    expect(roundOrder(37, null, 12)).toBe(48);
    expect(roundOrder(37, 50, 24)).toBe(72);
  });
});

describe("planReorder", () => {
  const base = {
    today: "2026-10-15",
    dailyUnits: days(90, 2),
    onOrder: 0,
    leadTimeDays: 30,
    coverDays: 60,
  };

  it("says when stock runs out and how many to order to cover lead time and cover days", () => {
    const plan = planReorder({ ...base, inStock: 40 });
    // Steady sales: no safety stock. Reorder point 2·30 = 60 > 40 in stock: order now.
    expect(plan).toMatchObject({
      velocity: 2,
      safetyStock: 0,
      reorderPoint: 60,
      daysLeft: 20,
      runsOutOn: "2026-11-04",
      orderBy: "2026-10-15",
      status: "order_now",
      // 2·(30 + 60) − 40.
      orderQuantity: 140,
    });
  });

  it("counts what's on order, and waits until the order-by day", () => {
    const soon = planReorder({ ...base, inStock: 40, onOrder: 40 });
    // Position 80, 10 days above the reorder point.
    expect(soon).toMatchObject({ status: "order_soon", orderBy: "2026-10-25", orderQuantity: 100 });
    const ok = planReorder({ ...base, inStock: 200 });
    expect(ok).toMatchObject({ status: "ok", orderBy: "2026-12-24", orderQuantity: 0 });
  });

  it("keeps safety stock for uneven sales", () => {
    const uneven = Array.from({ length: 90 }, (_, i) => (i % 2 ? 4 : 0));
    const plan = planReorder({ ...base, dailyUnits: uneven, inStock: 0 });
    expect(plan.velocity).toBeCloseTo(2, 0);
    expect(plan.safetyStock).toBeGreaterThan(0);
    expect(plan.reorderPoint).toBe(Math.ceil(plan.velocity * 30 + plan.safetyStock));
  });

  it("rounds the order to the minimum and the case pack", () => {
    expect(
      planReorder({ ...base, inStock: 40, minimumOrder: 200, casePack: 24 }).orderQuantity,
    ).toBe(216);
  });

  it("has nothing to plan for a product that isn't selling", () => {
    expect(planReorder({ ...base, dailyUnits: days(90, 0), inStock: 10 })).toMatchObject({
      status: "no_sales",
      daysLeft: null,
      orderQuantity: 0,
    });
  });
});

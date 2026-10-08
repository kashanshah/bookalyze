import { describe, expect, it } from "vitest";
import { buildSalesGlance, glanceRange } from "../commerce/glance";

describe("sales glance", () => {
  it("fills quiet days and keeps each currency's sales exact", () => {
    const glance = buildSalesGlance("2026-10-01", "2026-10-03", [
      { date: "2026-10-01", currency: "AED", orders: 2, units: 3, sales: "10.5000" },
      { date: "2026-10-01", currency: "CAD", orders: 1, units: 1, sales: "4.2500" },
      { date: "2026-10-03", currency: "AED", orders: 1, units: 4, sales: "0.1250" },
    ]);

    expect(glance.orders.total).toBe(4);
    expect(glance.orders.points.map((point) => point.value)).toEqual([3, 0, 1]);
    expect(glance.units.total).toBe(8);
    expect(glance.units.points.map((point) => point.value)).toEqual([4, 0, 4]);
    expect(glance.sales.map((series) => series.currency)).toEqual(["AED", "CAD"]);
    expect(glance.sales[0]?.total).toBe("10.6250");
    expect(glance.sales[0]?.points.map((point) => point.amount)).toEqual([
      "10.5000",
      "0.0000",
      "0.1250",
    ]);
    expect(glance.sales[1]?.total).toBe("4.2500");
  });

  it("uses thirty days unless the choice is seven or ninety", () => {
    expect(glanceRange(undefined)).toBe(30);
    expect(glanceRange("14")).toBe(30);
    expect(glanceRange("7")).toBe(7);
    expect(glanceRange("90")).toBe(90);
  });
});

import { describe, expect, it } from "vitest";
import { type CostingLine, costDelivery, splitByWeights } from "../inventory/landed";
import { parseDecimal } from "../money";

const mugs: CostingLine = {
  id: "m",
  name: "Mug",
  quantity: 100,
  unitCost: "2.45",
  unitWeight: "0.4",
};
const candles: CostingLine = {
  id: "c",
  name: "Candle",
  quantity: 3,
  unitCost: "10",
  unitWeight: null,
};

describe("landed costs", () => {
  it("splits to the cent and always adds back up", () => {
    const shares = splitByWeights(parseDecimal("100.00"), [1n, 1n, 1n], "USD");
    expect(shares?.map((s) => Number(s) / 10_000)).toEqual([33.34, 33.33, 33.33]);
    expect(splitByWeights(parseDecimal("5"), [0n, 0n], "USD")).toBeNull();
    // Yen has no minor units: whole yen only.
    expect(splitByWeights(parseDecimal("100"), [1n, 2n], "JPY")?.map(String)).toEqual([
      "330000",
      "670000",
    ]);
  });

  it("costs each line in the main currency, by units and by value", () => {
    const costed = costDelivery({
      baseCurrency: "USD",
      poCurrency: "USD",
      rate: null,
      lines: [mugs, candles],
      extras: [
        { amount: "51.50", currency: "USD", rate: null, allocation: "units" },
        { amount: "27.50", currency: "USD", rate: null, allocation: "value" },
      ],
    });
    if (!costed.ok) throw new Error(costed.problem);
    // Units: 51.50 over 103 units = 50.00 + 1.50. Value: 27.50 over 245 + 30 = 24.50 + 3.00.
    expect(costed.lines).toEqual([
      {
        id: "m",
        quantity: 100,
        productCost: "245.0000",
        landedCost: "74.5000",
        totalCost: "319.5000",
        unitCost: "3.1950",
      },
      {
        id: "c",
        quantity: 3,
        productCost: "30.0000",
        landedCost: "4.5000",
        totalCost: "34.5000",
        unitCost: "11.5000",
      },
    ]);
    expect(costed.totalCost).toBe("354.0000");
  });

  it("converts the PO and each cost at their own rates", () => {
    const costed = costDelivery({
      baseCurrency: "CAD",
      poCurrency: "USD",
      rate: "1.36",
      lines: [mugs],
      extras: [{ amount: "100", currency: "EUR", rate: "1.5", allocation: "units" }],
    });
    if (!costed.ok) throw new Error(costed.problem);
    expect(costed.lines[0]?.productCost).toBe("333.2000");
    expect(costed.lines[0]?.unitCost).toBe("4.8320");
  });

  it("says what's missing", () => {
    const base = { baseCurrency: "CAD", poCurrency: "USD", lines: [mugs, candles] };
    expect(costDelivery({ ...base, rate: null, extras: [] })).toEqual({
      ok: false,
      problem: "Add the USD to CAD exchange rate.",
    });
    expect(
      costDelivery({
        ...base,
        rate: "1.36",
        extras: [{ amount: "9", currency: "CAD", rate: null, allocation: "weight" }],
      }),
    ).toEqual({
      ok: false,
      problem: "Add a weight to Candle (under Products) to split by weight.",
    });
  });
});

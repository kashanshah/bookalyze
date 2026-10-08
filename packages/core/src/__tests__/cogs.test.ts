import { describe, expect, it } from "vitest";
import { type FifoLot, monthBounds, takeFifo } from "../inventory/cogs";

const lot = (id: string, receivedOn: string, quantity: number, totalCost: string): FifoLot => ({
  id,
  receivedOn,
  quantity,
  consumed: 0,
  totalCost,
});

describe("FIFO cost of goods sold", () => {
  it("uses the oldest lot first and spills into the next", () => {
    const lots = [lot("new", "2026-09-10", 70, "206.50"), lot("old", "2026-08-01", 50, "122.50")];
    const sold = takeFifo(lots, 60, "CAD");
    expect(sold.takes).toEqual([
      { lotId: "old", quantity: 50, cost: "122.5000" },
      { lotId: "new", quantity: 10, cost: "29.5000" },
    ]);
    expect(sold.cost).toBe("152.0000");
    expect(sold.short).toBe(0);
  });

  it("shares a lot's cost exactly: its takes add up to it once used up", () => {
    let thirds: FifoLot = lot("a", "2026-08-01", 3, "10.00");
    const first = takeFifo([thirds], 1, "USD");
    expect(first.cost).toBe("3.3300");
    thirds = { ...thirds, consumed: 1 };
    const second = takeFifo([thirds], 1, "USD");
    thirds = { ...thirds, consumed: 2 };
    const third = takeFifo([thirds], 1, "USD");
    expect([first.cost, second.cost, third.cost]).toEqual(["3.3300", "3.3400", "3.3300"]);
  });

  it("says how many units no lot covers", () => {
    const sold = takeFifo([{ ...lot("a", "2026-08-01", 5, "10"), consumed: 4 }], 3, "CAD");
    expect(sold.takes).toEqual([{ lotId: "a", quantity: 1, cost: "2.0000" }]);
    expect(sold.short).toBe(2);
  });

  it("knows a month's first and last day", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02").to).toBe("2028-02-29");
    expect(monthBounds("2026-12").to).toBe("2026-12-31");
  });
});

import { addDaysIso } from "../entity/compliance";
import { formatDecimal, parseDecimal } from "../money";

/** How many days the home page can show at a glance. Thirty is the usual look. */
export const GLANCE_RANGES = [7, 30, 90] as const;
export type GlanceRange = (typeof GLANCE_RANGES)[number];

export function glanceRange(value: string | undefined): GlanceRange {
  if (value === "7" || value === "90") return Number(value) as GlanceRange;
  return 30;
}

/** One day's orders in one currency, as the database counted them. */
export type GlanceRow = {
  date: string;
  currency: string;
  orders: number;
  units: number;
  sales: string;
};

export type GlancePoint = { date: string; value: number };

export type SalesGlance = {
  from: string;
  to: string;
  orders: { total: number; points: GlancePoint[] };
  units: { total: number; points: GlancePoint[] };
  /** One series per currency that had an order, largest sales first. */
  sales: { currency: string; total: string; points: { date: string; amount: string }[] }[];
};

/** Every date from `from` through `to`, inclusive. */
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let date = from; date <= to; date = addDaysIso(date, 1)) days.push(date);
  return days;
}

/**
 * A continuous daily series for the home page. Days with no orders are zeros, so the chart
 * doesn't skip them. Sales stay exact decimals and are never added across currencies.
 */
export function buildSalesGlance(
  from: string,
  to: string,
  rows: readonly GlanceRow[],
): SalesGlance {
  const days = eachDay(from, to);
  const ordersByDay = new Map<string, number>();
  const unitsByDay = new Map<string, number>();
  const salesByCurrency = new Map<string, Map<string, bigint>>();

  for (const row of rows) {
    ordersByDay.set(row.date, (ordersByDay.get(row.date) ?? 0) + row.orders);
    unitsByDay.set(row.date, (unitsByDay.get(row.date) ?? 0) + row.units);
    const byDay = salesByCurrency.get(row.currency) ?? new Map<string, bigint>();
    byDay.set(row.date, (byDay.get(row.date) ?? 0n) + parseDecimal(row.sales));
    salesByCurrency.set(row.currency, byDay);
  }

  const sales = [...salesByCurrency.entries()]
    .map(([currency, byDay]) => {
      let total = 0n;
      const points = days.map((date) => {
        const amount = byDay.get(date) ?? 0n;
        total += amount;
        return { date, amount: formatDecimal(amount) };
      });
      return { currency, total, points };
    })
    .sort((a, b) => {
      if (a.total === b.total) return a.currency.localeCompare(b.currency);
      return a.total < b.total ? 1 : -1;
    })
    .map(({ currency, total, points }) => ({
      currency,
      total: formatDecimal(total),
      points,
    }));

  return {
    from,
    to,
    orders: {
      total: days.reduce((sum, date) => sum + (ordersByDay.get(date) ?? 0), 0),
      points: days.map((date) => ({ date, value: ordersByDay.get(date) ?? 0 })),
    },
    units: {
      total: days.reduce((sum, date) => sum + (unitsByDay.get(date) ?? 0), 0),
      points: days.map((date) => ({ date, value: unitsByDay.get(date) ?? 0 })),
    },
    sales,
  };
}

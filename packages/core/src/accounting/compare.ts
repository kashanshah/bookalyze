import { formatDecimal, parseDecimal } from "../money";
import type { ProfitAndLoss, ReportSection } from "./reports";

/**
 * Comparison columns for the profit and loss: the period being viewed next to an earlier one,
 * with the change. Dates are ISO strings; amounts are decimal strings in the natural direction.
 */

export const COMPARE_MODES = ["none", "previous", "last-year"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export function isCompareMode(value: unknown): value is CompareMode {
  return typeof value === "string" && (COMPARE_MODES as readonly string[]).includes(value);
}

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The same calendar day `months` earlier, clamped to the month's end (Mar 31 → Feb 28). */
function shiftMonths(date: string, months: number): string {
  const { y, m, d } = parts(date);
  const index = y * 12 + (m - 1) - months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const nd = Math.min(d, lastDayOfMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Whole months from the 1st of `from` to the month end of `to`, or null if not month-aligned. */
function wholeMonths(from: string, to: string): number | null {
  const a = parts(from);
  const b = parts(to);
  if (a.d !== 1 || b.d !== lastDayOfMonth(b.y, b.m)) return null;
  return (b.y - a.y) * 12 + (b.m - a.m) + 1;
}

/**
 * The period to compare [from, to] with. "previous" is the period just before, of the same
 * length: the previous month, quarter or year when the range is whole months, otherwise the same
 * number of days. "last-year" is the same dates a year earlier.
 */
export function comparisonPeriod(
  from: string,
  to: string,
  mode: Exclude<CompareMode, "none">,
): { from: string; to: string } {
  if (mode === "last-year") {
    const months = wholeMonths(from, to);
    // A month-aligned range keeps ending on a month end (Feb 29 → Feb 28, Feb 28 → Feb 29).
    if (months !== null) {
      const start = shiftMonths(from, 12);
      const end = shiftMonths(to, 12);
      const e = parts(end);
      return {
        from: start,
        to: `${end.slice(0, 8)}${String(lastDayOfMonth(e.y, e.m)).padStart(2, "0")}`,
      };
    }
    return { from: shiftMonths(from, 12), to: shiftMonths(to, 12) };
  }
  const months = wholeMonths(from, to);
  if (months !== null) {
    const start = shiftMonths(from, months);
    const end = toDate(toTime(from) - DAY);
    return { from: start, to: end };
  }
  const days = Math.round((toTime(to) - toTime(from)) / DAY) + 1;
  return { from: toDate(toTime(from) - days * DAY), to: toDate(toTime(from) - DAY) };
}

export type ComparisonRow = {
  accountId: string;
  code: string | null;
  name: string;
  amount: string;
  prior: string;
  change: string;
};

export type ComparisonSection = {
  key: string;
  label: string;
  rows: ComparisonRow[];
  total: string;
  priorTotal: string;
  change: string;
};

export type ComparisonTotal = { amount: string; prior: string; change: string };

export type ProfitAndLossComparison = {
  income: ComparisonSection;
  costOfSales: ComparisonSection;
  grossProfit: ComparisonTotal;
  expenses: ComparisonSection;
  netProfit: ComparisonTotal;
};

const diff = (a: string, b: string) => formatDecimal(parseDecimal(a) - parseDecimal(b));
const total = (amount: string, prior: string): ComparisonTotal => ({
  amount,
  prior,
  change: diff(amount, prior),
});

function compareSection(current: ReportSection, prior: ReportSection): ComparisonSection {
  const before = new Map(prior.rows.map((r) => [r.accountId, r]));
  const rows: ComparisonRow[] = current.rows.map((r) => {
    const p = before.get(r.accountId)?.amount ?? "0.0000";
    before.delete(r.accountId);
    return {
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      amount: r.amount,
      prior: p,
      change: diff(r.amount, p),
    };
  });
  // Accounts with activity only in the earlier period still get a row.
  for (const r of before.values()) {
    rows.push({
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      amount: "0.0000",
      prior: r.amount,
      change: diff("0", r.amount),
    });
  }
  rows.sort(
    (a, b) =>
      (a.code ?? "~").localeCompare(b.code ?? "~", undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );
  return {
    key: current.key,
    label: current.label,
    rows,
    total: current.total,
    priorTotal: prior.total,
    change: diff(current.total, prior.total),
  };
}

export function compareProfitAndLoss(
  current: ProfitAndLoss,
  prior: ProfitAndLoss,
): ProfitAndLossComparison {
  return {
    income: compareSection(current.income, prior.income),
    costOfSales: compareSection(current.costOfSales, prior.costOfSales),
    grossProfit: total(current.grossProfit, prior.grossProfit),
    expenses: compareSection(current.expenses, prior.expenses),
    netProfit: total(current.netProfit, prior.netProfit),
  };
}

/** The change as a percentage of the earlier amount, e.g. "+12%", or null when there was none. */
export function percentChange(amount: string, prior: string): string | null {
  const p = parseDecimal(prior);
  if (p === 0n) return null;
  const change = parseDecimal(amount) - p;
  const tenths = (change * 1000n) / (p < 0n ? -p : p);
  const rounded = Number(tenths) / 10;
  const text =
    Math.abs(rounded) >= 10
      ? Math.round(rounded).toString()
      : rounded.toFixed(1).replace(/\.0$/, "");
  return `${change > 0n ? "+" : ""}${text}%`;
}

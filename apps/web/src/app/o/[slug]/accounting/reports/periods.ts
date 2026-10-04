import {
  type FiscalYearConfig,
  fiscalQuarters,
  fiscalYearFor,
  previousFiscalYear,
} from "@bookalyze/core";
import { isIsoDate } from "@/lib/dates";

/** Report period presets, all computed from the company's financial year. */

export type RangePreset = { key: string; label: string; from: string; to: string };
export type DatePreset = { key: string; label: string; date: string };

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthOf(date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = new Date(Date.UTC(y, m, 1));
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
}

function currentAndPreviousQuarter(today: string, cfg: FiscalYearConfig) {
  const quarters = fiscalQuarters(today, cfg);
  const index = quarters.findIndex((q) => today >= q.start && today <= q.end);
  const current = quarters[index] ?? quarters[0];
  const previous =
    index > 0
      ? quarters[index - 1]
      : fiscalQuarters(addDays(quarters[0]?.start ?? today, -1), cfg)[3];
  return { current, previous };
}

export function rangePresets(today: string, cfg: FiscalYearConfig): RangePreset[] {
  const fy = fiscalYearFor(today, cfg);
  const last = previousFiscalYear(today, cfg);
  const { current, previous } = currentAndPreviousQuarter(today, cfg);
  const month = monthOf(today);
  const lastMonth = monthOf(addDays(month.from, -1));
  return [
    { key: "this-year", label: `This financial year (${fy.label})`, from: fy.start, to: fy.end },
    {
      key: "last-year",
      label: `Last financial year (${last.label})`,
      from: last.start,
      to: last.end,
    },
    ...(current
      ? [{ key: "this-quarter", label: "This quarter", from: current.start, to: current.end }]
      : []),
    ...(previous
      ? [{ key: "last-quarter", label: "Last quarter", from: previous.start, to: previous.end }]
      : []),
    { key: "this-month", label: "This month", ...month },
    { key: "last-month", label: "Last month", ...lastMonth },
  ];
}

export function datePresets(today: string, cfg: FiscalYearConfig): DatePreset[] {
  const last = previousFiscalYear(today, cfg);
  const { previous } = currentAndPreviousQuarter(today, cfg);
  return [
    { key: "today", label: "Today", date: today },
    ...(previous
      ? [{ key: "last-quarter-end", label: "End of last quarter", date: previous.end }]
      : []),
    { key: "last-year-end", label: `End of ${last.label}`, date: last.end },
  ];
}

/** The range in the URL, or this financial year by default. */
export function resolveRange(
  params: { from?: string; to?: string },
  today: string,
  cfg: FiscalYearConfig,
) {
  const presets = rangePresets(today, cfg);
  const fallback = presets[0] as RangePreset;
  let from = isIsoDate(params.from) ? params.from : fallback.from;
  let to = isIsoDate(params.to) ? params.to : fallback.to;
  if (from > to) [from, to] = [to, from];
  return { from, to, presets };
}

/** The "as of" date in the URL, or today by default. */
export function resolveDate(params: { date?: string }, today: string, cfg: FiscalYearConfig) {
  return {
    date: isIsoDate(params.date) ? params.date : today,
    presets: datePresets(today, cfg),
  };
}

/**
 * Sales tax filing periods up to today, newest first: months, quarters of the financial year, or
 * financial years. Labels mark the period in progress and the last finished one (usually the one
 * being filed).
 */
export function filingPeriods(
  today: string,
  cfg: FiscalYearConfig,
  frequency: "monthly" | "quarterly" | "annual",
  locale: string,
): RangePreset[] {
  let periods: { from: string; to: string; label: string }[];
  if (frequency === "monthly") {
    const monthName = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    periods = [];
    let month = monthOf(today);
    for (let i = 0; i < 12; i++) {
      periods.push({ ...month, label: monthName.format(new Date(`${month.from}T00:00:00Z`)) });
      month = monthOf(addDays(month.from, -1));
    }
  } else if (frequency === "quarterly") {
    const current = fiscalQuarters(today, cfg);
    const before = fiscalQuarters(addDays(current[0]?.start ?? today, -1), cfg);
    periods = [...before, ...current]
      .filter((q) => q.start <= today)
      .reverse()
      .slice(0, 8)
      .map((q) => ({ from: q.start, to: q.end, label: q.label }));
  } else {
    const fy = fiscalYearFor(today, cfg);
    const last = previousFiscalYear(today, cfg);
    const older = previousFiscalYear(last.start, cfg);
    periods = [fy, last, older].map((y) => ({ from: y.start, to: y.end, label: y.label }));
  }
  const lastDone = periods.findIndex((p) => p.to < today);
  return periods.map((p, i) => ({
    key: `${p.from}_${p.to}`,
    label:
      p.to >= today
        ? `${p.label} (in progress)`
        : i === lastDone
          ? `${p.label} (last period)`
          : p.label,
    from: p.from,
    to: p.to,
  }));
}

/** The range in the URL, or the last finished filing period by default. */
export function resolveFilingRange(params: { from?: string; to?: string }, presets: RangePreset[]) {
  const fallback = presets.find((p) => p.label.endsWith("(last period)")) ?? presets[0];
  let from = isIsoDate(params.from) ? params.from : (fallback?.from as string);
  let to = isIsoDate(params.to) ? params.to : (fallback?.to as string);
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

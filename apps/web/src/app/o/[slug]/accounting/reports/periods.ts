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

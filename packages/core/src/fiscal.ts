/**
 * Fiscal-year utilities. All dates are ISO calendar dates ("YYYY-MM-DD") with no time or
 * timezone, which is how accounting periods are defined.
 */

export type IsoDate = string;

export type FiscalYearConfig = {
  /** Month the fiscal year ends in, 1–12. */
  endMonth: number;
  /** Day of that month the fiscal year ends on, 1–31 (clamped to the month's length). */
  endDay: number;
  /** Start of the organization's first fiscal year (e.g. incorporation date), if any. */
  firstFiscalYearStart?: IsoDate | null;
};

export type FiscalPeriod = {
  start: IsoDate;
  end: IsoDate;
  /** e.g. "FY2026" for a calendar year, "FY2026-27" for a year spanning two calendar years. */
  label: string;
  /** True when the period is shorter than a full year because it is the first fiscal year. */
  isShortFirstYear: boolean;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(date: IsoDate): { y: number; m: number; d: number } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`Invalid ISO date: ${date}`);
  const [, y, m, d] = match;
  return { y: Number(y), m: Number(m), d: Number(d) };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function format(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(date: IsoDate, days: number): IsoDate {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function validateFiscalYearEnd(endMonth: number, endDay: number): string | null {
  if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) return "Month must be 1–12";
  // Feb 29 is allowed and clamps to Feb 28 in non-leap years.
  const max = endMonth === 2 ? 29 : daysInMonth(2001, endMonth);
  if (!Number.isInteger(endDay) || endDay < 1 || endDay > max) return `Day must be 1–${max}`;
  return null;
}

/** The fiscal year end date that falls in the given calendar year. */
function endInYear(year: number, cfg: FiscalYearConfig): IsoDate {
  return format(year, cfg.endMonth, Math.min(cfg.endDay, daysInMonth(year, cfg.endMonth)));
}

/** The fiscal year that contains `date`. */
export function fiscalYearFor(date: IsoDate, cfg: FiscalYearConfig): FiscalPeriod {
  const error = validateFiscalYearEnd(cfg.endMonth, cfg.endDay);
  if (error) throw new Error(error);

  const { y } = parse(date);
  let end = endInYear(y, cfg);
  if (date > end) end = endInYear(y + 1, cfg);
  const previousEnd = endInYear(parse(end).y - 1, cfg);
  let start = addDays(previousEnd, 1);
  const label = labelFor(start, end, cfg);

  let isShortFirstYear = false;
  const first = cfg.firstFiscalYearStart;
  if (first && first > start && first <= end) {
    start = first;
    isShortFirstYear = true;
  }

  return { start, end, label, isShortFirstYear };
}

function labelFor(start: IsoDate, end: IsoDate, cfg: FiscalYearConfig): string {
  const endYear = parse(end).y;
  // A full year ending 31 Dec lies in one calendar year; anything else spans two.
  const spansTwoYears = !(cfg.endMonth === 12 && cfg.endDay === 31);
  if (!spansTwoYears || parse(start).y === endYear) return `FY${endYear}`;
  return `FY${endYear - 1}-${String(endYear % 100).padStart(2, "0")}`;
}

export function previousFiscalYear(date: IsoDate, cfg: FiscalYearConfig): FiscalPeriod {
  const current = fiscalYearFor(date, cfg);
  return fiscalYearFor(addDays(current.start, -1), cfg);
}

/** The four fiscal quarters of the fiscal year containing `date` (3-month blocks from the start). */
export function fiscalQuarters(date: IsoDate, cfg: FiscalYearConfig): FiscalPeriod[] {
  const fy = fiscalYearFor(date, { ...cfg, firstFiscalYearStart: null });
  const quarters: FiscalPeriod[] = [];
  let qStart = fy.start;
  for (let q = 1; q <= 4; q++) {
    const { y, m, d } = parse(qStart);
    const next = new Date(Date.UTC(y, m - 1 + 3, d));
    const qEnd =
      q === 4
        ? fy.end
        : addDays(format(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()), -1);
    quarters.push({
      start: qStart,
      end: qEnd,
      label: `${fy.label} Q${q}`,
      isShortFirstYear: false,
    });
    qStart = addDays(qEnd, 1);
  }
  return quarters;
}

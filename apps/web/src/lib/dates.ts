/** Date helpers. Accounting dates are ISO "YYYY-MM-DD" strings. Safe on server and client. */

/** Today's date and hour in a time zone. */
export function nowIn(timezone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * "2 hours ago". Under a minute is "now"; a whole day ago is "yesterday".
 * `now` is passed in so a list shares one clock.
 */
export function formatAgo(at: Date, now: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const delta = at.getTime() - now.getTime();
  const abs = Math.abs(delta);
  const sign = delta < 0 ? -1 : 1;
  const amount = (ms: number) => sign * Math.max(1, Math.floor(abs / ms));
  if (abs < 45_000) return rtf.format(0, "second");
  if (abs < HOUR) return rtf.format(amount(MINUTE), "minute");
  if (abs < DAY) return rtf.format(amount(HOUR), "hour");
  if (abs < WEEK) return rtf.format(amount(DAY), "day");
  if (abs < MONTH) return rtf.format(amount(WEEK), "week");
  if (abs < YEAR) return rtf.format(amount(MONTH), "month");
  return rtf.format(amount(YEAR), "year");
}

/** "2026-10-06" — the calendar day in the company's time zone. */
export function formatOrderDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** "11:46 a.m. PDT" in the company's locale and time zone. */
export function formatOrderClock(at: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    hour12: true,
    timeZone,
  }).format(at);
}

/** "Tue, Oct 6, 2026, 11:46 a.m. PDT" — the purchase moment on an order. */
export function formatPurchaseDate(at: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    hour12: true,
    timeZone,
  }).format(at);
}

/** "4 Oct 2026" in the organization's locale. */
export function formatDate(value: string, locale = "en-CA", style: "medium" | "long" = "medium") {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/** The day after an ISO date. */
export function nextDay(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** `date`, moved to the first open day if it falls on or before `lockedThrough`. */
export function openDate(date: string, lockedThrough: string | null | undefined): string {
  return lockedThrough && date <= lockedThrough ? nextDay(lockedThrough) : date;
}

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

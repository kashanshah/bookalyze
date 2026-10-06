import type { ReviewSettings } from "@bookalyze/core";

/** Days in display order, Monday first. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export function hourLabel(hour: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(2026, 0, 4, hour));
}

/** "Sun", "Mon"… (2026-01-04 is a Sunday). */
export function dayLabel(day: number, locale: string, width: "short" | "long" = "short") {
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(
    Date.UTC(2026, 0, 4 + day),
  );
}

/** "7 days after delivery, at 10:00 a.m., every day". */
export function scheduleSummary(
  settings: Pick<ReviewSettings, "daysAfterDelivery" | "sendHour" | "sendDays">,
  locale: string,
) {
  const days = new Set(settings.sendDays);
  const weekdays = [1, 2, 3, 4, 5].every((d) => days.has(d)) && !days.has(0) && !days.has(6);
  const on =
    days.size === 7
      ? "every day"
      : weekdays
        ? "on weekdays"
        : `on ${WEEK.filter((d) => days.has(d))
            .map((d) => dayLabel(d, locale))
            .join(", ")}`;
  return `${settings.daysAfterDelivery} days after delivery, at ${hourLabel(settings.sendHour, locale)}, ${on}`;
}

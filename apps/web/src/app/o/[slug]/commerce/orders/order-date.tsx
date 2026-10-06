import { formatAgo, formatOrderClock, formatOrderDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Order date on the list: how long ago, the calendar day, then the clock. */
export function OrderDate({
  at,
  now,
  locale,
  timezone,
  className,
}: {
  at: Date;
  now: Date;
  locale: string;
  timezone: string;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-col gap-px text-xs leading-4", className)}>
      <span className="font-medium text-foreground">{formatAgo(at, now, locale)}</span>
      <span className="tabular text-muted-foreground">{formatOrderDay(at, timezone)}</span>
      <span className="tabular whitespace-nowrap text-muted-foreground">
        {formatOrderClock(at, locale, timezone)}
      </span>
    </span>
  );
}

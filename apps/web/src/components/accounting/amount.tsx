import { formatMoney, parseDecimal } from "@bookalyze/core";
import { cn } from "@/lib/utils";

/**
 * A money amount, right-aligned with tabular figures. Negative amounts are shown in
 * parentheses, the way accountants read them.
 */
export function Amount({
  value,
  currency,
  locale,
  className,
  muteZero = false,
}: {
  value: string | null | undefined;
  currency: string;
  locale?: string | undefined;
  className?: string;
  muteZero?: boolean;
}) {
  if (value == null) return <span className={cn("text-muted-foreground/50", className)}>—</span>;
  const units = parseDecimal(value);
  const formatted = formatMoney(units < 0n ? value.replace("-", "") : value, currency, locale);
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        units === 0n && muteZero && "text-muted-foreground/60",
        className,
      )}
    >
      {units < 0n ? `(${formatted})` : formatted}
    </span>
  );
}

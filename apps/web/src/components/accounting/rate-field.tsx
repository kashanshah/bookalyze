"use client";

import { useEffect, useRef, useState } from "react";
import { suggestRateAction } from "@/app/o/[slug]/accounting/actions";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";

/** "1.3650000000" → "1.365" for display in the input. */
function trimRate(rate: string): string {
  return rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
}

/**
 * "1 USD = [ ] CAD". Suggests the Bank of Canada rate for the date (or the fixed AED peg), and
 * keeps following the date until the person types their own rate.
 */
export function RateField({
  slug,
  id,
  currency,
  baseCurrency,
  date,
  value,
  onChange,
  error,
  locale,
  className,
}: {
  slug: string;
  id: string;
  currency: string;
  baseCurrency: string;
  date: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  locale: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [suggested, setSuggested] = useState<{
    rate: string;
    asOf: string | null;
    source: string;
  } | null>(null);
  // The last value we filled in; if the field still holds it, a new date may replace it.
  const autoValue = useRef<string | null>(null);
  const current = useRef(value);
  current.current = value;
  // Kept in a ref so a new onChange from the parent doesn't trigger another lookup.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!date || currency === baseCurrency) return;
    let cancelled = false;
    setLoading(true);
    suggestRateAction(slug, currency, date)
      .then((result) => {
        if (cancelled) return;
        setSuggested(result);
        const untouched = current.current === "" || current.current === autoValue.current;
        if (result && untouched) {
          autoValue.current = trimRate(result.rate);
          onChangeRef.current(autoValue.current);
        }
      })
      .catch(() => {
        if (!cancelled) setSuggested(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, currency, baseCurrency, date]);

  const usingSuggestion = suggested && value === trimRate(suggested.rate);
  const hint = loading
    ? "Looking up the rate…"
    : usingSuggestion && suggested
      ? suggested.source === "Fixed rate"
        ? `Fixed rate (${currency} is pegged). Change it to match your bank if needed.`
        : `Bank of Canada rate${suggested.asOf ? ` for ${formatDate(suggested.asOf, locale)}` : ""}. Change it to match your bank.`
      : suggested
        ? `Bank of Canada: ${trimRate(suggested.rate)}. You're using your own rate.`
        : `How many ${baseCurrency} one ${currency} was worth on this date.`;

  return (
    <Field label="Exchange rate" htmlFor={id} error={error} hint={hint} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
          1 {currency} =
        </span>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          placeholder={loading ? "" : "1.3650"}
          onChange={(e) => onChange(e.target.value)}
          className="tabular ps-20 pe-14 text-end"
          aria-invalid={Boolean(error)}
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
          {loading ? <Spinner className="size-3.5" /> : baseCurrency}
        </span>
      </div>
    </Field>
  );
}

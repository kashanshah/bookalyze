import { getCurrency } from "./reference-data";

/** ISO 4217 minor units (decimal places). Defaults to 2 for unknown codes. */
export function minorUnits(currencyCode: string): number {
  return getCurrency(currencyCode)?.minorUnits ?? 2;
}

/**
 * Formats an amount for display. Amounts are passed as strings (from NUMERIC columns)
 * so they never go through floating point before reaching the formatter.
 */
export function formatMoney(amount: string, currencyCode: string, locale = "en-CA"): string {
  const digits = minorUnits(currencyCode);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount as unknown as number);
}

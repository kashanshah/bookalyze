import { divideDecimals, divRound, formatDecimal, isDecimal, parseDecimal } from "../money";

/**
 * Exchange rates. A rate for (base, quote) is how many units of `base` one unit of `quote` is
 * worth, the same meaning as a journal entry's `fx_rate`. The Bank of Canada publishes daily rates
 * against CAD; every other pair is derived from those, with pegged currencies (AED) going through
 * their anchor.
 */

/** Currencies with a fixed rate to an anchor currency: 1 anchor = `rate` of the currency. */
export const PEGGED_CURRENCIES: Record<string, { anchor: string; rate: string }> = {
  AED: { anchor: "USD", rate: "3.6725" },
};

/** Bank of Canada Valet series we import (all quoted as CAD per unit). */
export const BANK_OF_CANADA_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "INR",
  "AUD",
  "CHF",
  "HKD",
  "MXN",
  "SGD",
  "NZD",
  "SEK",
  "NOK",
] as const;

export type FxObservation = { date: string; base: string; quote: string; rate: string };

/** Parses a Bank of Canada Valet observations response into CAD-based rates. */
export function parseBankOfCanada(json: unknown): FxObservation[] {
  const observations = (json as { observations?: Record<string, unknown>[] })?.observations;
  if (!Array.isArray(observations)) return [];
  const out: FxObservation[] = [];
  for (const row of observations) {
    const date = row.d;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const [key, value] of Object.entries(row)) {
      const match = /^FX([A-Z]{3})CAD$/.exec(key);
      const v = (value as { v?: unknown } | null)?.v;
      if (!match?.[1] || typeof v !== "string" || !isDecimal(v) || parseDecimal(v, 10) <= 0n)
        continue;
      out.push({ date, base: "CAD", quote: match[1], rate: v });
    }
  }
  return out;
}

/**
 * The rate for (base, quote) given CAD-based rates. `cadPer(code)` returns how many CAD one unit
 * of `code` is worth (from the Bank of Canada), or null when unknown. Returns null if the pair
 * can't be derived.
 */
export function crossRate(
  base: string,
  quote: string,
  cadPer: (code: string) => string | null,
): string | null {
  if (base === quote) return "1";
  // Direct pegs (AED per USD) are exact, without going through CAD.
  const basePeg = PEGGED_CURRENCIES[base];
  if (basePeg?.anchor === quote) return basePeg.rate;
  const quotePeg = PEGGED_CURRENCIES[quote];
  if (quotePeg?.anchor === base) return divideDecimals("1", quotePeg.rate);

  // Exact fractions until the very end, so derived rates are rounded once.
  type Fraction = { n: bigint; d: bigint };
  const scale = 10n ** 10n;
  const fraction = (value: string): Fraction => ({ n: parseDecimal(value, 10), d: scale });
  const valueInCad = (code: string): Fraction | null => {
    if (code === "CAD") return { n: 1n, d: 1n };
    const peg = PEGGED_CURRENCIES[code];
    if (peg) {
      const anchor = valueInCad(peg.anchor);
      const rate = fraction(peg.rate);
      return anchor ? { n: anchor.n * rate.d, d: anchor.d * rate.n } : null;
    }
    const value = cadPer(code);
    return value ? fraction(value) : null;
  };
  const q = valueInCad(quote);
  const b = valueInCad(base);
  if (!q || !b) return null;
  return formatDecimal(divRound(q.n * b.d * scale, q.d * b.n), 10);
}

/** The currencies whose CAD rates are needed to price (base, quote). */
export function cadRatesNeeded(base: string, quote: string): string[] {
  const resolve = (code: string): string[] => {
    if (code === "CAD") return [];
    const peg = PEGGED_CURRENCIES[code];
    return peg ? resolve(peg.anchor) : [code];
  };
  return [...new Set([...resolve(base), ...resolve(quote)])];
}

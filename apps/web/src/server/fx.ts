import "server-only";
import { BANK_OF_CANADA_CURRENCIES, parseBankOfCanada } from "@bookalyze/core";
import { fxRateOn, fxRatesForDays, getDb, missingCadRates, upsertFxRates } from "@bookalyze/db";
import { logWarn } from "./log";

/**
 * Exchange rates from the Bank of Canada Valet API (free, official, CAD-based). A daily cron keeps
 * recent rates current; older dates (back-dated entries, imports) are fetched on demand.
 */

const VALET = "https://www.bankofcanada.ca/valet/observations";

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Fetches and stores Bank of Canada rates for [start, end]. Returns how many were stored. */
export async function syncBankOfCanada(start: string, end: string): Promise<number> {
  const series = BANK_OF_CANADA_CURRENCIES.map((c) => `FX${c}CAD`).join(",");
  const url = `${VALET}/${series}/json?start_date=${start}&end_date=${end}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    logWarn("fx.bank_of_canada_failed", { status: response.status, start, end });
    throw new Error(`Bank of Canada responded ${response.status}`);
  }
  return upsertFxRates(getDb(), parseBankOfCanada(await response.json()), "Bank of Canada");
}

export type SuggestedRate = { rate: string; asOf: string | null; source: string };

/**
 * The rate to suggest for `quote` in a company whose main currency is `base`, on `date`. Fetches
 * missing Bank of Canada rates for that week first. Null if none is published (or the bank's site
 * can't be reached); the person then types the rate their bank used.
 */
export async function suggestRate(
  base: string,
  quote: string,
  date: string,
): Promise<SuggestedRate | null> {
  const db = getDb();
  if ((await missingCadRates(db, base, quote, date)).length) {
    try {
      await syncBankOfCanada(shift(date, -7), date);
    } catch (error) {
      logWarn("fx.suggest_rate_fetch_failed", { base, quote, date }, error);
      return null;
    }
  }
  return fxRateOn(db, { base, quote, date });
}

/**
 * Each day's rate for `quote` (main-currency units per one) from `from` to `to`, fetching Bank of
 * Canada's for the range first when any day has none. Days still without one are left out.
 */
export async function dayRates(
  base: string,
  quote: string,
  from: string,
  to: string,
): Promise<Map<string, string>> {
  const db = getDb();
  const read = () => fxRatesForDays(db, { base, quote, from, to });
  const rates = await read();
  const days =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (rates.size >= days) return rates;
  try {
    await syncBankOfCanada(shift(from, -7), to);
  } catch (error) {
    logWarn("fx.day_rates_fetch_failed", { base, quote, from, to }, error);
    return rates;
  }
  return read();
}

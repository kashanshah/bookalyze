import "server-only";
import { BANK_OF_CANADA_CURRENCIES, parseBankOfCanada } from "@bookalyze/core";
import { fxRateOn, getDb, missingCadRates, upsertFxRates } from "@bookalyze/db";

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
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Bank of Canada responded ${response.status}`);
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
    } catch {
      return null;
    }
  }
  return fxRateOn(db, { base, quote, date });
}

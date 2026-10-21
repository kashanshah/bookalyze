import { cadRatesNeeded, crossRate, type FxObservation } from "@bookalyze/core";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Database, Transaction } from "./client";
import { fxRates } from "./schema/reference";

/** Exchange rates (global, not per organization). */

type Db = Database | Transaction;

/** Saves observations, replacing any earlier value for the same day and pair. */
export async function upsertFxRates(
  db: Db,
  rows: FxObservation[],
  source: string,
): Promise<number> {
  if (!rows.length) return 0;
  await db
    .insert(fxRates)
    .values(rows.map((r) => ({ ...r, source })))
    .onConflictDoUpdate({
      target: [fxRates.date, fxRates.base, fxRates.quote],
      set: { rate: sql`excluded.rate`, source: sql`excluded.source`, fetchedAt: sql`now()` },
    });
  return rows.length;
}

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The latest CAD rate for `code` on or before `date` (within a week, to cover weekends/holidays). */
async function cadRateOn(db: Db, code: string, date: string) {
  const [row] = await db
    .select({ rate: fxRates.rate, date: fxRates.date })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.base, "CAD"),
        eq(fxRates.quote, code),
        lte(fxRates.date, date),
        gte(fxRates.date, daysBefore(date, 7)),
      ),
    )
    .orderBy(desc(fxRates.date))
    .limit(1);
  return row ?? null;
}

export type RateQuote = { rate: string; asOf: string | null; source: string };

/**
 * How many `base` one `quote` was worth on `date`, from stored Bank of Canada rates (and the AED
 * peg). Null when a needed rate isn't stored yet.
 */
export async function fxRateOn(
  db: Db,
  input: { base: string; quote: string; date: string },
): Promise<RateQuote | null> {
  if (input.base === input.quote) return { rate: "1", asOf: input.date, source: "Same currency" };
  // Pairs fixed by a peg (AED per USD) need no market rate.
  const fixed = crossRate(input.base, input.quote, () => null);
  if (fixed) return { rate: fixed, asOf: input.date, source: "Fixed rate" };
  const needed = cadRatesNeeded(input.base, input.quote);
  const found = new Map<string, { rate: string; date: string }>();
  for (const code of needed) {
    const row = await cadRateOn(db, code, input.date);
    if (!row) return null;
    found.set(code, row);
  }
  const rate = crossRate(input.base, input.quote, (code) => found.get(code)?.rate ?? null);
  if (!rate) return null;
  const dates = [...found.values()].map((r) => r.date).sort();
  return {
    rate,
    asOf: dates[0] ?? null,
    source: "Bank of Canada",
  };
}

/** Whether every CAD rate needed for the pair is stored for `date` (or the week before). */
export async function missingCadRates(
  db: Db,
  base: string,
  quote: string,
  date: string,
): Promise<string[]> {
  const missing: string[] = [];
  for (const code of cadRatesNeeded(base, quote)) {
    if (!(await cadRateOn(db, code, date))) missing.push(code);
  }
  return missing;
}

/**
 * `fxRateOn` for every day from `from` to `to` at once (each day's rate, or the latest of the
 * week before it): main-currency units per one `quote`. Days with no rate are left out.
 */
export async function fxRatesForDays(
  db: Db,
  input: { base: string; quote: string; from: string; to: string },
): Promise<Map<string, string>> {
  const days: string[] = [];
  for (let d = input.from; d <= input.to; d = daysBefore(d, -1)) days.push(d);
  if (input.base === input.quote) return new Map(days.map((d) => [d, "1"]));
  const fixed = crossRate(input.base, input.quote, () => null);
  if (fixed) return new Map(days.map((d) => [d, fixed]));
  const series = new Map<string, { date: string; rate: string }[]>();
  for (const code of cadRatesNeeded(input.base, input.quote)) {
    const rows = await db
      .select({ rate: fxRates.rate, date: fxRates.date })
      .from(fxRates)
      .where(
        and(
          eq(fxRates.base, "CAD"),
          eq(fxRates.quote, code),
          gte(fxRates.date, daysBefore(input.from, 7)),
          lte(fxRates.date, input.to),
        ),
      )
      .orderBy(fxRates.date);
    series.set(code, rows);
  }
  const out = new Map<string, string>();
  for (const day of days) {
    const floor = daysBefore(day, 7);
    const rate = crossRate(input.base, input.quote, (code) => {
      const rows = series.get(code) ?? [];
      let found: string | null = null;
      for (const r of rows) {
        if (r.date > day) break;
        if (r.date >= floor) found = r.rate;
      }
      return found;
    });
    if (rate) out.set(day, rate);
  }
  return out;
}

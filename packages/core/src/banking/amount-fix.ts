import { minorUnits } from "../currency";
import { divideDecimals, formatDecimal, parseDecimal, roundUnits } from "../money";

/**
 * Correcting foreign-currency amounts that arrived in the main currency. Wave's accounting export
 * only gives main-currency (CAD) values, so a US$123 Wise payment came in as 173.62. Each such
 * line is matched to the account's real statement (the same transaction in its own currency) so
 * its amount can become US$123.00 while keeping the CAD value Wave used.
 *
 * A statement line fits when it goes the same way, is a few days apart at most, and is within
 * a few percent of the main-currency value converted at that day's rate (the rate only judges
 * the fit; the statement's own amount is what's used).
 */

export const AMOUNT_FIX_WINDOW_DAYS = 4;
/** How far (basis points) a statement amount may be from the converted value. */
export const AMOUNT_FIX_TOLERANCE_BP = 300n;

export type MisrecordedLine = {
  lineId: string;
  date: string;
  /** Signed, in the main currency: what the line holds now. */
  baseAmount: string;
  /** Description and memo, to break ties. */
  text: string;
};

export type StatementLine = {
  externalId: string;
  date: string;
  /** Signed, in the account's currency. */
  amount: string;
  text: string;
};

export type AmountFix =
  | { lineId: string; status: "matched"; match: StatementLine; estimate: string | null }
  | { lineId: string; status: "ambiguous"; candidates: StatementLine[]; estimate: string | null }
  | { lineId: string; status: "unmatched"; estimate: string | null };

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const daysApart = (a: string, b: string) => Math.abs(day(a) - day(b)) / 86_400_000;
const abs = (v: bigint) => (v < 0n ? -v : v);
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w)),
  );
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

/**
 * The line's value in the account's currency at `rate` (main-currency units per one unit of it),
 * rounded to that currency's cents. Null without a rate.
 */
export function estimateForeignAmount(
  baseAmount: string,
  rate: string | null,
  currency: string,
): string | null {
  if (!rate || parseDecimal(rate, 10) <= 0n) return null;
  const units = parseDecimal(divideDecimals(baseAmount, rate, 4));
  return formatDecimal(roundUnits(units, minorUnits(currency)));
}

/**
 * Matches each misrecorded line to one statement line. A line with a single fitting statement
 * line (after the obvious ones are taken) is matched; with several it's matched only when its
 * description clearly points to one, otherwise left for a person to choose; with none, unmatched.
 * Each statement line is used once.
 */
export function matchStatementAmounts(
  lines: readonly MisrecordedLine[],
  statement: readonly StatementLine[],
  rateOn: (date: string) => string | null,
  currency: string,
): AmountFix[] {
  const estimates = new Map(
    lines.map((l) => [l.lineId, estimateForeignAmount(l.baseAmount, rateOn(l.date), currency)]),
  );
  const fits = new Map<string, StatementLine[]>();
  for (const line of lines) {
    const estimate = estimates.get(line.lineId);
    const sign = parseDecimal(line.baseAmount) < 0n;
    fits.set(
      line.lineId,
      estimate === null || estimate === undefined
        ? []
        : statement.filter((s) => {
            const amount = parseDecimal(s.amount);
            if (amount === 0n || amount < 0n !== sign) return false;
            if (daysApart(s.date, line.date) > AMOUNT_FIX_WINDOW_DAYS) return false;
            const expected = abs(parseDecimal(estimate));
            return abs(abs(amount) - expected) * 10_000n <= expected * AMOUNT_FIX_TOLERANCE_BP;
          }),
    );
  }

  const taken = new Set<string>();
  const matched = new Map<string, StatementLine>();
  const open = () => lines.filter((l) => !matched.has(l.lineId));
  const available = (lineId: string) =>
    (fits.get(lineId) ?? []).filter((s) => !taken.has(s.externalId));
  const take = (lineId: string, s: StatementLine) => {
    matched.set(lineId, s);
    taken.add(s.externalId);
  };

  // Settle the obvious ones first, again and again: each match can make another obvious.
  for (let progress = true; progress; ) {
    progress = false;
    for (const line of open()) {
      const left = available(line.lineId);
      if (left.length === 1 && left[0]) {
        take(line.lineId, left[0]);
        progress = true;
      }
    }
    if (progress) continue;
    // Then lines whose description (or, failing that, an exact day) singles one out.
    for (const line of open()) {
      const left = available(line.lineId);
      if (left.length < 2) continue;
      const mine = words(line.text);
      const score = (s: StatementLine) =>
        overlap(mine, words(s.text)) * 10 + (s.date === line.date ? 1 : 0);
      const ranked = [...left].sort((a, b) => score(b) - score(a));
      const [best, second] = ranked;
      if (best && second && score(best) > score(second) && score(best) >= 10) {
        take(line.lineId, best);
        progress = true;
      }
    }
  }

  return lines.map((line): AmountFix => {
    const estimate = estimates.get(line.lineId) ?? null;
    const match = matched.get(line.lineId);
    if (match) return { lineId: line.lineId, status: "matched", match, estimate };
    const candidates = available(line.lineId);
    return candidates.length
      ? { lineId: line.lineId, status: "ambiguous", candidates, estimate }
      : { lineId: line.lineId, status: "unmatched", estimate };
  });
}

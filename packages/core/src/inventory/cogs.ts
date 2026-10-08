import { minorUnits } from "../currency";
import { AMOUNT_SCALE, divRound, formatDecimal, parseDecimal, roundUnits } from "../money";

/**
 * Cost of goods sold (phase 5, slice 4): units sold draw on the oldest stock lots first (FIFO).
 * A lot's cost is shared out exactly: taking units from it costs the lot's total × units taken
 * ÷ its quantity, rounded so that once a lot is used up its takes add up to its cost exactly.
 */

export type FifoLot = {
  id: string;
  receivedOn: string;
  quantity: number;
  /** Units already taken by earlier months. */
  consumed: number;
  /** productCost + landedCost, in the main currency. */
  totalCost: string;
};

export type FifoTake = { lotId: string; quantity: number; cost: string };

/** The lot cost of the first `n` units of a lot, rounded to the currency's minor units. */
function costOfFirst(lot: FifoLot, n: number, currency: string): bigint {
  const total = parseDecimal(lot.totalCost);
  if (n >= lot.quantity) return total;
  const exact = divRound(total * BigInt(n), BigInt(lot.quantity));
  return roundUnits(exact, Math.min(minorUnits(currency), AMOUNT_SCALE));
}

/**
 * Takes `units` from `lots`, oldest first (by date, then in the order given). Returns the takes
 * and how many units no lot could cover.
 */
export function takeFifo(
  lots: readonly FifoLot[],
  units: number,
  currency: string,
): { takes: FifoTake[]; cost: string; short: number } {
  const ordered = [...lots]
    .map((lot, i) => ({ lot, i }))
    .sort((a, b) =>
      a.lot.receivedOn === b.lot.receivedOn
        ? a.i - b.i
        : a.lot.receivedOn < b.lot.receivedOn
          ? -1
          : 1,
    )
    .map(({ lot }) => lot);
  const takes: FifoTake[] = [];
  let left = units;
  let cost = 0n;
  for (const lot of ordered) {
    if (left <= 0) break;
    const available = lot.quantity - lot.consumed;
    if (available <= 0) continue;
    const quantity = Math.min(available, left);
    const share =
      costOfFirst(lot, lot.consumed + quantity, currency) -
      costOfFirst(lot, lot.consumed, currency);
    takes.push({ lotId: lot.id, quantity, cost: formatDecimal(share) });
    cost += share;
    left -= quantity;
  }
  return { takes, cost: formatDecimal(cost), short: Math.max(0, left) };
}

/** "2026-09" → first and last day of that month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The month a YYYY-MM-DD date falls in ("2026-09-14" → "2026-09"). */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

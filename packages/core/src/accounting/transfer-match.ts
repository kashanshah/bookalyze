import { parseDecimal } from "../money";
import type { MergeCandidate } from "./merge";

/**
 * Transfer matching: money that left one of the company's accounts and arrived in another shows
 * up as two bank transactions (one out, one in). Matching them turns the pair into one transfer.
 * These helpers find likely pairs and say why two picked by hand can't be matched.
 */

/** How many days apart the two sides may be. */
export const TRANSFER_WINDOW_DAYS = 5;

/**
 * Between currencies the two sides can't be compared exactly: their main-currency values may
 * differ by this much (in basis points), for the bank's rate and fees.
 */
export const TRANSFER_FX_TOLERANCE_BP = 300n;

/** One side that could be part of a transfer: a transaction on one bank, card or cash account. */
export type TransferCandidate = {
  entryId: string;
  date: string;
  accountId: string;
  currency: string;
  /** Signed, in the account's currency: negative = money out. */
  amount: string;
  /** Signed, in the main currency. */
  baseAmount: string;
};

export type TransferPair = { outId: string; inId: string };

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const daysApart = (a: string, b: string) => Math.abs(day(a) - day(b)) / 86_400_000;
const abs = (v: bigint) => (v < 0n ? -v : v);

/**
 * How far apart two amounts are, 0 for an exact match, or null when they can't be the same money:
 * the same currency must match to the cent; different currencies within the tolerance.
 */
function amountGap(out: TransferCandidate, into: TransferCandidate): bigint | null {
  if (out.currency === into.currency) {
    return abs(parseDecimal(out.amount)) === abs(parseDecimal(into.amount)) ? 0n : null;
  }
  const a = abs(parseDecimal(out.baseAmount));
  const b = abs(parseDecimal(into.baseAmount));
  const larger = a > b ? a : b;
  if (larger === 0n) return null;
  const gap = abs(a - b);
  return gap * 10_000n <= larger * TRANSFER_FX_TOLERANCE_BP ? (gap * 10_000n) / larger + 1n : null;
}

/**
 * Likely transfers among `candidates`: money out of one account and the same money into another
 * within a few days. Each transaction is in at most one pair; the closest matches (exact amount,
 * then fewest days apart) win. `skip` leaves out pairs someone already said aren't transfers.
 */
export function pairTransfers(
  candidates: readonly TransferCandidate[],
  skip: (pair: TransferPair) => boolean = () => false,
): TransferPair[] {
  const outs = candidates.filter((c) => parseDecimal(c.amount) < 0n);
  const ins = candidates.filter((c) => parseDecimal(c.amount) > 0n);
  const options: { pair: TransferPair; gap: bigint; days: number; order: string }[] = [];
  for (const out of outs) {
    for (const into of ins) {
      if (into.accountId === out.accountId) continue;
      const days = daysApart(out.date, into.date);
      if (days > TRANSFER_WINDOW_DAYS) continue;
      const gap = amountGap(out, into);
      if (gap === null) continue;
      const pair = { outId: out.entryId, inId: into.entryId };
      if (skip(pair)) continue;
      options.push({ pair, gap, days, order: `${out.date}${out.entryId}${into.entryId}` });
    }
  }
  options.sort((x, y) =>
    x.gap !== y.gap
      ? x.gap < y.gap
        ? -1
        : 1
      : x.days !== y.days
        ? x.days - y.days
        : x.order.localeCompare(y.order),
  );
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const { pair } of options) {
    if (used.has(pair.outId) || used.has(pair.inId)) continue;
    used.add(pair.outId);
    used.add(pair.inId);
    pairs.push(pair);
  }
  return pairs;
}

/**
 * Why two transactions picked by hand can't be matched as a transfer, or null when they can:
 * one money out and one money in, each on a single bank, card or cash account, two different
 * accounts, and (in the same currency) the same amount.
 */
export function transferMatchProblem(a: MergeCandidate, b: MergeCandidate): string | null {
  if (a.kind === "transfer" || b.kind === "transfer") {
    return "One of them is already a transfer.";
  }
  if (a.kind === b.kind) return "Pick one where money went out and one where it came in.";
  if (a.moneyAccountIds.length !== 1 || b.moneyAccountIds.length !== 1) {
    return "Each needs to be on one bank, card or cash account.";
  }
  if (a.moneyAccountIds[0] === b.moneyAccountIds[0]) {
    return "They're on the same account. A transfer moves money between two accounts.";
  }
  if (a.currency === b.currency && parseDecimal(a.amount) !== parseDecimal(b.amount)) {
    return "They need to be the same amount.";
  }
  return null;
}

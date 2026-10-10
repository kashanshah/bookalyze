import { minorUnits } from "../currency";
import { AMOUNT_SCALE, divRound, formatDecimal, parseDecimal, roundUnits } from "../money";

/**
 * Paying for a purchase order (phase 5, slice 8): an optional payment plan of any number of
 * parts, each a percentage of the order or a fixed amount ("35% upfront", "USD 1,000 on
 * completion", "the rest at the shipping agent"), and the payments made against it. Amounts are
 * in the order's currency, exact decimals.
 */

export type PaymentPlanPart = {
  /** What it's for: "Upfront", "On completion"… */
  label: string;
  kind: "percent" | "amount";
  /** "35" (per cent) or "1000.00" (in the order's currency). */
  value: string;
};

export type PlanPartStatus = "paid" | "part" | "due";

const ONE_HUNDRED = parseDecimal("100");

/** `percent` % of `total`, rounded to the currency's minor units ("35" of "5000" → "1750.0000"). */
export function percentOfTotal(total: string, percent: string, currency: string): string {
  const units = divRound(parseDecimal(total) * parseDecimal(percent), ONE_HUNDRED);
  return formatDecimal(roundUnits(units, Math.min(minorUnits(currency), AMOUNT_SCALE)));
}

/** `paid` as a share of `total`, in per cent with one decimal ("1750" of "5000" → "35.0"). */
export function paidPercent(paid: string, total: string): string {
  const t = parseDecimal(total);
  if (t <= 0n) return "0.0";
  // Tenths of a per cent.
  const tenths = divRound(parseDecimal(paid) * 1000n, t);
  const sign = tenths < 0n ? "-" : "";
  const abs = tenths < 0n ? -tenths : tenths;
  return `${sign}${abs / 10n}.${abs % 10n}`;
}

/** Each part's amount in the order's currency. */
export function planAmounts(
  plan: readonly PaymentPlanPart[],
  total: string,
  currency: string,
): string[] {
  return plan.map((part) =>
    part.kind === "percent"
      ? percentOfTotal(total, part.value, currency)
      : formatDecimal(parseDecimal(part.value)),
  );
}

/**
 * What's been paid against each part, in order: payments fill the first part, then the next.
 * Anything paid beyond the plan is `extra`.
 */
export function planProgress(
  amounts: readonly string[],
  paid: string,
): { parts: { amount: string; paid: string; status: PlanPartStatus }[]; extra: string } {
  let left = parseDecimal(paid);
  const parts = amounts.map((amount) => {
    const due = parseDecimal(amount);
    const covered = left <= 0n ? 0n : left >= due ? due : left;
    left -= covered;
    const status: PlanPartStatus = covered >= due ? "paid" : covered > 0n ? "part" : "due";
    return { amount, paid: formatDecimal(covered), status };
  });
  return { parts, extra: formatDecimal(left > 0n ? left : 0n) };
}

/**
 * Problems with a plan for an order of `total`: parts over 100% or over the order, a plan
 * adding up to more than the order. Keyed by part index, or `plan` for the whole.
 */
export function planProblems(
  plan: readonly PaymentPlanPart[],
  total: string,
  currency: string,
): Record<string, string> {
  const problems: Record<string, string> = {};
  plan.forEach((part, i) => {
    const value = parseDecimal(part.value);
    if (value <= 0n) problems[i] = "Enter more than zero.";
    else if (part.kind === "percent" && value > ONE_HUNDRED) problems[i] = "At most 100%.";
  });
  if (Object.keys(problems).length) return problems;
  const sum = planAmounts(plan, total, currency).reduce((s, a) => s + parseDecimal(a), 0n);
  if (sum > parseDecimal(total)) {
    problems.plan = "The parts add up to more than the order.";
  }
  return problems;
}

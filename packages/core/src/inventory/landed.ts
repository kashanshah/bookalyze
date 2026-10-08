import { minorUnits } from "../currency";
import {
  AMOUNT_SCALE,
  convertUnits,
  divRound,
  formatDecimal,
  parseDecimal,
  roundUnits,
} from "../money";
import { purchaseLineTotal } from "./purchasing";

/**
 * Landed costs and stock lots (phase 5, slice 3). Each line of a delivery becomes one FIFO lot.
 * Its cost, in the company's main currency, is what the products cost on the PO plus a share
 * of the delivery's extra costs (freight, duty, brokerage, prep), split by units, value or
 * weight. Shares are exact to the minor unit and always add up to the cost being split.
 */

export type LandedCostKind = "freight" | "duty" | "brokerage" | "prep" | "other";
export type AllocationMethod = "units" | "value" | "weight";

export const LANDED_COST_KIND_LABELS: Record<LandedCostKind, string> = {
  freight: "Freight and shipping",
  duty: "Duty and import taxes",
  brokerage: "Customs brokerage",
  prep: "Prep and labelling",
  other: "Other",
};

export const ALLOCATION_LABELS: Record<AllocationMethod, string> = {
  units: "By units",
  value: "By value",
  weight: "By weight",
};

export const ALLOCATION_HINTS: Record<AllocationMethod, string> = {
  units: "Every unit carries the same share.",
  value: "Pricier products carry more. Usual for duty.",
  weight: "Heavier products carry more. Usual for freight.",
};

function stepFor(currency: string): bigint {
  return 10n ** BigInt(AMOUNT_SCALE - Math.min(minorUnits(currency), AMOUNT_SCALE));
}

/**
 * Splits `total` (amount units, already in minor units of `currency`) in proportion to
 * `weights`, to the minor unit, by largest remainder: the shares add up to `total` exactly.
 * Returns null when every weight is zero.
 */
export function splitByWeights(
  total: bigint,
  weights: readonly bigint[],
  currency: string,
): bigint[] | null {
  const sum = weights.reduce((a, w) => a + w, 0n);
  if (sum <= 0n) return null;
  const step = stepFor(currency);
  const steps = total / step;
  const exact = weights.map((w) => steps * w);
  const shares = exact.map((e) => e / sum);
  let left = steps - shares.reduce((a, s) => a + s, 0n);
  // Hand the leftover minor units to the largest remainders (earliest line wins a tie).
  const order = exact
    .map((e, i) => ({ i, remainder: e % sum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  for (const { i } of order) {
    if (left <= 0n) break;
    shares[i] = (shares[i] ?? 0n) + 1n;
    left -= 1n;
  }
  return shares.map((s) => s * step);
}

export type CostingLine = {
  id: string;
  name: string;
  quantity: number;
  /** Cost of one, in the PO's currency. */
  unitCost: string;
  /** Weight of one product, in any unit the company uses consistently. Null if not set. */
  unitWeight: string | null;
};

export type CostingExtra = {
  amount: string;
  currency: string;
  /** How many of the main currency one `currency` is worth. Ignored when it is the main one. */
  rate: string | null;
  allocation: AllocationMethod;
};

export type CostedLine = {
  id: string;
  quantity: number;
  /** What the products cost, in the main currency. */
  productCost: string;
  /** This line's share of the extra costs, in the main currency. */
  landedCost: string;
  totalCost: string;
  /** totalCost ÷ quantity, to 4 places. */
  unitCost: string;
};

export type Costing =
  | { ok: true; lines: CostedLine[]; productCost: string; landedCost: string; totalCost: string }
  | { ok: false; problem: string };

/** Converts an amount to the main currency, rounded to its minor units. */
function toBase(amount: string, currency: string, rate: string | null, base: string): bigint {
  const units = parseDecimal(amount);
  if (currency === base) return roundUnits(units, Math.min(minorUnits(base), AMOUNT_SCALE));
  if (!rate) throw new Error("rate needed");
  return convertUnits(units, rate, minorUnits(base));
}

/**
 * What each line of a delivery cost, landed, in the main currency `baseCurrency`. `rate` turns
 * the PO's currency into the main one (ignored when they're the same).
 */
export function costDelivery(input: {
  baseCurrency: string;
  poCurrency: string;
  rate: string | null;
  lines: readonly CostingLine[];
  extras: readonly CostingExtra[];
}): Costing {
  const { baseCurrency: base, poCurrency } = input;
  if (poCurrency !== base && !input.rate) {
    return { ok: false, problem: `Add the ${poCurrency} to ${base} exchange rate.` };
  }
  if (input.extras.some((extra) => extra.currency !== base && !extra.rate)) {
    return { ok: false, problem: "Add the exchange rate for each cost in another currency." };
  }
  const product = input.lines.map((line) =>
    toBase(
      purchaseLineTotal(line.quantity, line.unitCost, poCurrency),
      poCurrency,
      input.rate,
      base,
    ),
  );
  const landed = input.lines.map(() => 0n);
  for (const extra of input.extras) {
    let weights: bigint[];
    if (extra.allocation === "units") {
      weights = input.lines.map((line) => BigInt(line.quantity));
    } else if (extra.allocation === "value") {
      weights = product;
    } else {
      const missing = input.lines.find((line) => !line.unitWeight);
      if (missing) {
        return {
          ok: false,
          problem: `Add a weight to ${missing.name} (under Products) to split by weight.`,
        };
      }
      weights = input.lines.map(
        (line) => parseDecimal(line.unitWeight ?? "0") * BigInt(line.quantity),
      );
    }
    const shares = splitByWeights(
      toBase(extra.amount, extra.currency, extra.rate, base),
      weights,
      base,
    );
    if (!shares) {
      return {
        ok: false,
        problem:
          extra.allocation === "value"
            ? "These products cost nothing, so costs can't be split by value. Split by units."
            : "There's nothing to split this cost across.",
      };
    }
    shares.forEach((share, i) => {
      landed[i] = (landed[i] ?? 0n) + share;
    });
  }
  const lines = input.lines.map((line, i) => {
    const p = product[i] ?? 0n;
    const l = landed[i] ?? 0n;
    return {
      id: line.id,
      quantity: line.quantity,
      productCost: formatDecimal(p),
      landedCost: formatDecimal(l),
      totalCost: formatDecimal(p + l),
      unitCost: formatDecimal(divRound(p + l, BigInt(line.quantity))),
    };
  });
  const sum = (values: bigint[]) => values.reduce((a, v) => a + v, 0n);
  return {
    ok: true,
    lines,
    productCost: formatDecimal(sum(product)),
    landedCost: formatDecimal(sum(landed)),
    totalCost: formatDecimal(sum(product) + sum(landed)),
  };
}

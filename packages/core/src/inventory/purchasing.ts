import { minorUnits } from "../currency";
import { AMOUNT_SCALE, formatDecimal, parseDecimal, roundUnits } from "../money";

/**
 * Purchase orders (phase 5, slice 2): numbering, line and order totals in the PO's currency,
 * and what a delivery may receive. Amounts are exact decimals (BigInt), never floats.
 */

export type PurchaseOrderStatus = "draft" | "ordered" | "partial" | "received" | "cancelled";

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  partial: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
};

/** "PO-0007". */
export function purchaseOrderNumber(n: number): string {
  return `PO-${String(n).padStart(4, "0")}`;
}

/** quantity × unit cost, rounded to the currency's minor units ("12.5000" × 3 → "37.5000"). */
export function purchaseLineTotal(quantity: number, unitCost: string, currency: string): string {
  const units = parseDecimal(unitCost) * BigInt(quantity);
  return formatDecimal(roundUnits(units, Math.min(minorUnits(currency), AMOUNT_SCALE)));
}

/** The sum of the line totals. */
export function purchaseOrderTotal(
  lines: readonly { quantity: number; unitCost: string }[],
  currency: string,
): string {
  const total = lines.reduce(
    (sum, line) => sum + parseDecimal(purchaseLineTotal(line.quantity, line.unitCost, currency)),
    0n,
  );
  return formatDecimal(total);
}

/** Received so far against ordered: the status a non-draft, non-cancelled PO should show. */
export function receivingStatus(
  lines: readonly { quantity: number; received: number }[],
): "ordered" | "partial" | "received" {
  const received = lines.reduce((sum, line) => sum + line.received, 0);
  if (received === 0) return "ordered";
  return lines.every((line) => line.received >= line.quantity) ? "received" : "partial";
}

/**
 * Checks a delivery: each quantity a whole number from 0 up to what's still to come, and at
 * least one above 0. Returns an error per line id, or a form error.
 */
export function receiptProblems(
  lines: readonly { id: string; quantity: number; received: number }[],
  receiving: Readonly<Record<string, number>>,
): { form?: string; lines: Record<string, string> } {
  const problems: Record<string, string> = {};
  let any = false;
  for (const line of lines) {
    const qty = receiving[line.id] ?? 0;
    const open = line.quantity - line.received;
    if (!Number.isInteger(qty) || qty < 0) problems[line.id] = "Use a whole number.";
    else if (qty > open) {
      problems[line.id] = open === 0 ? "All of these have arrived." : `Only ${open} still to come.`;
    } else if (qty > 0) any = true;
  }
  for (const id of Object.keys(receiving)) {
    if (!lines.some((line) => line.id === id)) problems[id] = "This line isn't on the order.";
  }
  return Object.keys(problems).length || any
    ? { lines: problems }
    : { form: "Enter how many arrived of at least one product.", lines: problems };
}

import { formatDecimal, parseDecimal } from "../money";

/**
 * Amazon refunds (Finances API v0, financial events): what was given back to buyers, per order
 * item. Amazon lists events by the day they posted, for the whole seller account; each refund
 * names its order, so it's kept against the order it belongs to. Nothing here touches the
 * ledger: refunds reach the books through settlements.
 */

export type AmazonRefund = {
  orderId: string;
  /** Amazon's ID for this adjustment (or one made from the event, when Amazon gives none). */
  adjustmentId: string;
  /** ISO timestamp (UTC). */
  postedAt: string;
  sku: string | null;
  /** Units refunded (0 when Amazon refunded money without units, e.g. a goodwill credit). */
  quantity: number;
  /** Given back to the buyer: price, shipping and tax refunded, less promotions clawed back. Positive. */
  amount: string;
  currency: string | null;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** A Finances Currency ({ CurrencyCode, CurrencyAmount }) as a decimal, or 0. */
function amountOf(v: unknown): bigint {
  const raw = record(v).CurrencyAmount;
  const value = typeof raw === "number" ? String(raw) : text(raw);
  if (!value) return 0n;
  try {
    return parseDecimal(value);
  } catch {
    return 0n;
  }
}

/** Parses one page of GET /finances/v0/financialEvents: its refunds, item by item. */
export function parseRefundEventsPage(json: unknown): {
  refunds: AmazonRefund[];
  nextToken: string | null;
} {
  const payload = record(record(json).payload);
  const events = record(payload.FinancialEvents);
  if (!Object.keys(payload).length) throw new Error("Unexpected response from Amazon.");
  const refunds = list(events.RefundEventList).flatMap((raw, e): AmazonRefund[] => {
    const event = record(raw);
    const orderId = text(event.AmazonOrderId);
    const postedAt = text(event.PostedDate);
    if (!orderId || !postedAt) return [];
    return list(event.ShipmentItemAdjustmentList).flatMap((rawItem, i): AmazonRefund[] => {
      const item = record(rawItem);
      // Charges come back negative (taken off the seller); promotions clawed back positive.
      const charges = list(item.ItemChargeAdjustmentList).reduce<bigint>(
        (t, c) => t + amountOf(record(c).ChargeAmount),
        0n,
      );
      const promotions = list(item.PromotionAdjustmentList).reduce<bigint>(
        (t, p) => t + amountOf(record(p).PromotionAmount),
        0n,
      );
      const refunded = -(charges + promotions);
      if (refunded === 0n) return [];
      const currency =
        [...list(item.ItemChargeAdjustmentList), ...list(item.PromotionAdjustmentList)]
          .map((c) => {
            const r = record(c);
            return text(record(r.ChargeAmount ?? r.PromotionAmount).CurrencyCode);
          })
          .find(Boolean) ?? null;
      const quantity = item.QuantityShipped;
      return [
        {
          orderId,
          adjustmentId:
            text(item.OrderAdjustmentItemId) || `${postedAt}:${text(item.SellerSKU)}:${e}:${i}`,
          postedAt,
          sku: text(item.SellerSKU) || null,
          quantity:
            typeof quantity === "number" && Number.isFinite(quantity) ? Math.trunc(quantity) : 0,
          amount: formatDecimal(refunded),
          currency,
        },
      ];
    });
  });
  return { refunds, nextToken: text(payload.NextToken) || null };
}

/** Re-read this far back each time: Amazon posts some events a day or two late. */
export const REFUND_SYNC_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;
/** Amazon answers at most 180 days of events per query; stay inside it. */
const REFUND_SYNC_MAX_MS = 179 * 24 * 60 * 60 * 1000;
/** Amazon wants PostedBefore at least two minutes in the past. */
const REFUND_SYNC_LAG_MS = 3 * 60 * 1000;

/**
 * The window of the next refunds query: from the last sync (less two days), or the orders' start
 * date the first time, up to a few minutes ago, at most 179 days at once (a long history takes
 * several windows, one after another).
 */
export function refundSyncWindow(input: { from: string; syncedThrough: Date | null; now: Date }): {
  after: string;
  before: string;
} {
  const start = new Date(`${input.from}T00:00:00Z`).getTime();
  const latest = input.now.getTime() - REFUND_SYNC_LAG_MS;
  const after = Math.min(
    input.syncedThrough
      ? Math.max(start, input.syncedThrough.getTime() - REFUND_SYNC_OVERLAP_MS)
      : start,
    latest - 1000,
  );
  return {
    after: new Date(after).toISOString(),
    before: new Date(Math.min(latest, after + REFUND_SYNC_MAX_MS)).toISOString(),
  };
}

export type RefundState = "refunded" | "partly_refunded";

/** Whether an order was refunded in full (everything it cost) or in part. */
export function refundState(total: string | null, refunded: string | null): RefundState | null {
  if (!refunded || parseDecimal(refunded) <= 0n) return null;
  if (total === null) return "partly_refunded";
  return parseDecimal(refunded) >= parseDecimal(total) ? "refunded" : "partly_refunded";
}

export const REFUND_LABELS: Record<RefundState, { label: string; hint: string }> = {
  refunded: { label: "Refunded", hint: "The buyer got everything they paid back." },
  partly_refunded: { label: "Partly refunded", hint: "The buyer got some of what they paid back." },
};

import { ORDER_STATUS_GROUPS, REFUND_LABELS, refundState } from "@bookalyze/core";

/** Badge colour for an order status: shipped green, waiting to ship amber, cancelled plain. */
export const statusVariant = (status: string) =>
  (ORDER_STATUS_GROUPS.shipped as readonly string[]).includes(status)
    ? "success"
    : (ORDER_STATUS_GROUPS.cancelled as readonly string[]).includes(status)
      ? "outline"
      : status === "Unshipped" || status === "PartiallyShipped"
        ? "warning"
        : "secondary";

/** "Refunded" or "Partly refunded" (shown in red), or null when nothing was given back. */
export function refundBadge(total: string | null, refunded: string | null) {
  const state = refundState(total, refunded);
  return state ? REFUND_LABELS[state] : null;
}

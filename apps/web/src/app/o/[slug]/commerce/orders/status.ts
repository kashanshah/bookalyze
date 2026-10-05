import { ORDER_STATUS_GROUPS } from "@bookalyze/core";

/** Badge colour for an order status: shipped green, waiting to ship amber, cancelled plain. */
export const statusVariant = (status: string) =>
  (ORDER_STATUS_GROUPS.shipped as readonly string[]).includes(status)
    ? "success"
    : (ORDER_STATUS_GROUPS.cancelled as readonly string[]).includes(status)
      ? "outline"
      : status === "Unshipped" || status === "PartiallyShipped"
        ? "warning"
        : "secondary";

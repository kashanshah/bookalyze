import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from "@bookalyze/core";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<
  PurchaseOrderStatus,
  "secondary" | "primary" | "warning" | "success" | "outline"
> = {
  draft: "secondary",
  ordered: "primary",
  partial: "warning",
  received: "success",
  cancelled: "outline",
};

export function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge variant={VARIANT[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</Badge>;
}

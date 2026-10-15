import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { formOptions } from "../shared";
import { NewPurchaseOrder } from "./new-order";

export const metadata: Metadata = { title: "New purchase order" };

/** "Order" on the Reorder page: `?add=productId:quantity`, once per product. */
function linesToAdd(add: string | string[] | undefined, productIds: Set<string>) {
  return [add ?? []]
    .flat()
    .map((part) => /^([0-9a-f-]{36}):(\d{1,7})$/i.exec(part))
    .filter((m): m is RegExpExecArray => Boolean(m?.[1] && productIds.has(m[1])))
    .map((m) => ({ productId: m[1] ?? "", quantity: Number(m[2]), unitCost: "" }))
    .filter((line) => line.quantity > 0);
}

export default async function NewPurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ add?: string | string[] }>;
}) {
  const { slug } = await params;
  const { add } = await searchParams;
  const ctx = await getInventoryContext(slug, "inventory.purchasing");
  const { baseCurrency, locale, timezone } = ctx.profile;
  const options = await inOrg(ctx, (tx) => formOptions(tx, baseCurrency));
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Purchase orders"
        title="New purchase order"
        description="What you're buying from a supplier, and at what cost. It stays a draft until you mark it as sent; then you can record deliveries as they arrive."
      />
      <NewPurchaseOrder
        slug={slug}
        locale={locale}
        {...options}
        defaults={{
          supplierId: "",
          currency: baseCurrency,
          orderDate: nowIn(timezone).date,
          expectedDate: null,
          reference: null,
          notes: null,
          lines: linesToAdd(add, new Set(options.products.map((p) => p.id))),
        }}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { PurchaseOrderForm } from "../po-form";
import { formOptions } from "../shared";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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
      <PurchaseOrderForm
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
          lines: [],
        }}
      />
    </div>
  );
}

import { purchaseOrderNumber } from "@bookalyze/core";
import { getPurchaseOrder } from "@bookalyze/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { PurchaseOrderForm } from "../../po-form";
import { formOptions } from "../../shared";

export const metadata: Metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getInventoryContext(slug, "inventory.purchasing");
  const { baseCurrency, locale } = ctx.profile;
  const { po, options } = await inOrg(ctx, async (tx) => ({
    po: await getPurchaseOrder(tx, id),
    options: await formOptions(tx, baseCurrency),
  }));
  if (!po) notFound();
  // Only a draft changes; a sent order goes back to its page.
  if (po.status !== "draft") redirect(`/o/${slug}/inventory/purchase-orders/${id}`);
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Purchase orders"
        title={`Edit ${purchaseOrderNumber(po.number)}`}
        description="Change the supplier, dates or products while it's still a draft."
      />
      <PurchaseOrderForm
        slug={slug}
        id={id}
        locale={locale}
        {...options}
        defaults={{
          supplierId: po.supplierId,
          currency: po.currency,
          orderDate: po.orderDate,
          expectedDate: po.expectedDate,
          reference: po.reference,
          notes: po.notes,
          lines: po.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitCost: line.unitCost,
          })),
        }}
      />
    </div>
  );
}

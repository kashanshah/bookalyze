import { purchaseOrderNumber } from "@bookalyze/core";
import { formatEntryNumber, getDeliveryCosting, schema, supplierOptions } from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { formatDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { currencyOptions } from "../../../shared";
import { DeliveryCostsForm } from "./costs-form";
import { DeliveryDateDialog } from "./delivery-date-dialog";

export const metadata: Metadata = { title: "Landed cost" };

export default async function DeliveryCostsPage({
  params,
}: {
  params: Promise<{ slug: string; id: string; receiptId: string }>;
}) {
  const { slug, id, receiptId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(receiptId).success) notFound();
  const ctx = await getInventoryContext(slug, "inventory.purchasing");
  const { locale, baseCurrency } = ctx.profile;
  const { delivery, vendors, orderDate } = await inOrg(ctx, async (tx) => {
    const [po] = await tx
      .select({ orderDate: schema.purchaseOrders.orderDate })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, id));
    return {
      delivery: await getDeliveryCosting(tx, receiptId),
      vendors: await supplierOptions(tx),
      orderDate: po?.orderDate ?? null,
    };
  });
  if (!delivery || delivery.purchaseOrderId !== id) notFound();
  const number = purchaseOrderNumber(delivery.purchaseOrderNumber);
  const units = delivery.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="grid gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link href={`/o/${slug}/inventory/purchase-orders/${id}`}>
          <ArrowLeft className="rtl:rotate-180" />
          {number}
        </Link>
      </Button>
      <PageHeader
        eyebrow={`${number} · ${delivery.supplierName}`}
        title={`Landed cost of the ${formatDate(delivery.receivedOn, locale)} delivery`}
        description={`What these ${new Intl.NumberFormat(locale).format(units)} units really cost: the order price plus freight, duty and anything else it took to get them to you. Each product becomes a stock lot at this cost, and sales use the oldest lots first.`}
        actions={
          orderDate ? (
            <DeliveryDateDialog
              slug={slug}
              receiptId={receiptId}
              receivedOn={delivery.receivedOn}
              orderDate={orderDate}
              today={nowIn(ctx.profile.timezone).date}
            />
          ) : null
        }
      />
      <DeliveryCostsForm
        slug={slug}
        receiptId={receiptId}
        purchaseOrderId={id}
        receivedOn={delivery.receivedOn}
        poCurrency={delivery.poCurrency}
        baseCurrency={baseCurrency}
        locale={locale}
        currencies={currencyOptions(baseCurrency)}
        costed={delivery.costed}
        exchangeRate={delivery.exchangeRate}
        lines={delivery.lines.map((line) => ({
          id: line.receiptLineId,
          name: line.productName,
          sku: line.productSku,
          quantity: line.quantity,
          unitCost: line.unitCost,
          unitWeight: line.unitWeight,
        }))}
        vendors={vendors}
        costs={delivery.costs.map((cost) => ({
          contactId: cost.contactId ?? "",
          kind: cost.kind,
          description: cost.description ?? "",
          amount: cost.amount,
          currency: cost.currency,
          exchangeRate: cost.exchangeRate ?? "",
          allocation: cost.allocation,
          id: cost.id,
          paymentId: cost.paymentId ?? "",
          paidBy: cost.paidBy
            ? {
                date: cost.paidBy.date,
                entryNumber: formatEntryNumber(cost.paidBy.entryNumber),
                journalEntryId: cost.paidBy.journalEntryId,
              }
            : null,
        }))}
      />
    </div>
  );
}

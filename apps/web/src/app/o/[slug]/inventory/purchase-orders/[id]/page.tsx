import {
  isMoneyAccountSubtype,
  LANDED_COST_KIND_LABELS,
  purchaseOrderNumber,
} from "@bookalyze/core";
import {
  deliveryCostSummary,
  formatEntryNumber,
  getPurchaseOrder,
  getPurchaseSettings,
  listPurchasePayments,
  orderDeposits,
  orderInBooks,
  schema,
  supplierOptions,
  unpaidDeliveryCosts,
} from "@bookalyze/db";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, ChevronRight, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { formatDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { PurchaseOrderActions } from "../po-controls";
import { currencyOptions } from "../shared";
import { StatusBadge } from "../status-badge";
import { PurchasePayments } from "./payments";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  /** `pay`: a delivery cost to pay or link (from the landed cost page). */
  searchParams: Promise<{ pay?: string }>;
}) {
  const { slug, id } = await params;
  const { pay } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getInventoryContext(slug, "inventory.purchasing");
  const { locale, timezone } = ctx.profile;
  const found = await inOrg(ctx, async (tx) => {
    const po = await getPurchaseOrder(tx, id);
    if (!po) return null;
    const costs = await deliveryCostSummary(
      tx,
      po.receipts.map((receipt) => receipt.id),
    );
    const payments = await listPurchasePayments(tx, po.id);
    const unpaid = await unpaidDeliveryCosts(tx, po.id);
    const vendors = await supplierOptions(tx);
    const accounts = await tx
      .select()
      .from(schema.accounts)
      .orderBy(asc(schema.accounts.code), asc(schema.accounts.name));
    const inBooks = orderInBooks(po.orderDate, await getPurchaseSettings(tx));
    const deposits = inBooks
      ? await orderDeposits(tx, { orgId: ctx.org.id, purchaseOrderId: po.id })
      : null;
    const settlement = deposits?.settlementEntryId
      ? (
          await tx
            .select({ n: schema.journalEntries.entryNumber })
            .from(schema.journalEntries)
            .where(eq(schema.journalEntries.id, deposits.settlementEntryId))
        )[0]?.n
      : undefined;
    return { po, costs, payments, unpaid, vendors, accounts, deposits, settlement };
  });
  if (!found) notFound();
  const { po, costs, payments, unpaid, vendors, accounts, deposits, settlement } = found;
  const { baseCurrency } = ctx.profile;
  const moneyAccounts = accounts
    .filter((a) => isMoneyAccountSubtype(a.subtype) && !a.isArchived)
    .map((a) => ({
      id: a.id,
      label: a.code ? `${a.code} · ${a.name}` : a.name,
      currency: a.currency ?? baseCurrency,
    }));
  const number = purchaseOrderNumber(po.number);
  const names = new Map(po.lines.map((line) => [line.id, line.productName]));
  const units = po.lines.reduce((sum, line) => sum + line.quantity, 0);
  const arrived = po.lines.reduce((sum, line) => sum + line.received, 0);
  const n = new Intl.NumberFormat(locale);
  const base = `/o/${slug}/inventory/purchase-orders`;

  return (
    <div className="grid gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link href={base}>
          <ArrowLeft className="rtl:rotate-180" />
          Purchase orders
        </Link>
      </Button>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            Purchase order <StatusBadge status={po.status} />
          </span>
        }
        title={`${number} · ${po.supplierName}`}
        description={
          po.status === "draft"
            ? "A draft: change it as you like, then mark it as sent once the supplier has it."
            : po.status === "cancelled"
              ? "Cancelled. Nothing was received against it."
              : po.status === "received"
                ? "Everything on this order has arrived."
                : `${n.format(arrived)} of ${n.format(units)} units have arrived. Record each delivery as it comes in.`
        }
        actions={
          <PurchaseOrderActions
            slug={slug}
            id={po.id}
            number={number}
            status={po.status}
            today={nowIn(timezone).date}
            orderDate={po.orderDate}
            currency={po.currency}
            baseCurrency={ctx.profile.baseCurrency}
            locale={locale}
            lines={po.lines.map((line) => ({
              id: line.id,
              name: line.productName,
              quantity: line.quantity,
              received: line.received,
            }))}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid h-fit min-w-0 gap-6">
          <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <div className="hidden grid-cols-[minmax(0,1fr)_6rem_7rem_8rem_8rem] gap-3 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
              <span>Product</span>
              <span className="text-end">Ordered</span>
              <span className="text-end">Arrived</span>
              <span className="text-end">Cost of one</span>
              <span className="text-end">Total</span>
            </div>
            <ul className="divide-y">
              {po.lines.map((line) => (
                <li
                  key={line.id}
                  aria-label={line.productName}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_6rem_7rem_8rem_8rem] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{line.productName}</p>
                    {line.productSku ? (
                      <p className="text-muted-foreground text-xs">Your SKU {line.productSku}</p>
                    ) : null}
                  </div>
                  <p className="text-end text-sm tabular-nums md:order-none">
                    <span className="text-muted-foreground md:hidden">Ordered </span>
                    {n.format(line.quantity)}
                  </p>
                  <p className="text-sm tabular-nums md:text-end">
                    <span className="text-muted-foreground md:hidden">Arrived </span>
                    <span className={line.received >= line.quantity ? "text-success" : undefined}>
                      {n.format(line.received)}
                    </span>
                  </p>
                  <p className="text-end text-muted-foreground text-sm">
                    <Amount value={line.unitCost} currency={po.currency} locale={locale} />
                  </p>
                  <p className="col-span-2 text-end text-sm md:col-span-1">
                    <Amount value={line.total} currency={po.currency} locale={locale} />
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-3 border-t bg-muted/20 px-5 py-3 text-sm">
              <span className="text-muted-foreground">Total</span>
              <Amount
                value={po.total}
                currency={po.currency}
                locale={locale}
                className="font-semibold"
              />
            </div>
          </section>
          {po.status === "draft" ? null : (
            <PurchasePayments
              slug={slug}
              locale={locale}
              baseCurrency={baseCurrency}
              today={nowIn(timezone).date}
              po={{
                id: po.id,
                number,
                status: po.status,
                currency: po.currency,
                total: po.total,
                supplierId: po.supplierId,
                supplierName: po.supplierName,
              }}
              plan={po.paymentPlan}
              payments={payments.map((p) => ({
                id: p.id,
                receiptId: p.receiptId,
                costId: p.costId,
                contactId: p.contactId,
                contactName: p.contactName,
                label: p.label,
                amount: p.amount,
                currency: p.currency,
                journalEntryId: p.journalEntryId,
                entryNumber: formatEntryNumber(p.entryNumber),
                date: p.date,
                removed: p.removed,
                bank: p.bank ? { amount: p.bank.amount, currency: p.bank.currency } : null,
              }))}
              payFor={(() => {
                const cost = pay ? unpaid.find((c) => c.id === pay) : undefined;
                return cost
                  ? {
                      receiptId: cost.receiptId,
                      costId: cost.id,
                      contactId: cost.contactId,
                      amount: cost.amount,
                      currency: cost.currency,
                      label: cost.description ?? LANDED_COST_KIND_LABELS[cost.kind],
                    }
                  : null;
              })()}
              deliveries={po.receipts.map((r) => ({
                id: r.id,
                label: `Delivery of ${formatDate(r.receivedOn, locale)}`,
                unpaidCosts: unpaid
                  .filter((c) => c.receiptId === r.id)
                  .map((c) => ({
                    id: c.id,
                    kind: c.kind,
                    description: c.description,
                    amount: c.amount,
                    currency: c.currency,
                    contactId: c.contactId,
                  })),
              }))}
              moneyAccounts={moneyAccounts}
              vendors={vendors}
              currencies={currencyOptions(baseCurrency)}
              books={
                deposits
                  ? {
                      paidIn: deposits.paidIn,
                      intoStock: deposits.intoStock,
                      left: deposits.left,
                      settlementEntryId: deposits.settlementEntryId,
                      settlementNumber: settlement ? formatEntryNumber(settlement) : null,
                    }
                  : null
              }
            />
          )}
        </div>

        <aside className="grid h-fit min-w-0 gap-4">
          <section className="rounded-2xl border bg-card p-5 text-sm shadow-xs">
            <dl className="grid gap-3">
              <div>
                <dt className="text-muted-foreground text-xs">Ordered on</dt>
                <dd>{formatDate(po.orderDate, locale, "long")}</dd>
              </div>
              {po.expectedDate ? (
                <div>
                  <dt className="text-muted-foreground text-xs">Expected</dt>
                  <dd>{formatDate(po.expectedDate, locale, "long")}</dd>
                </div>
              ) : null}
              {po.reference ? (
                <div>
                  <dt className="text-muted-foreground text-xs">Supplier's reference</dt>
                  <dd className="[overflow-wrap:anywhere]">{po.reference}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground text-xs">Currency</dt>
                <dd>{po.currency}</dd>
              </div>
              {po.notes ? (
                <div>
                  <dt className="text-muted-foreground text-xs">Notes</dt>
                  <dd className="whitespace-pre-line [overflow-wrap:anywhere]">{po.notes}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-xs">
            <h2 className="font-medium text-sm">Deliveries</h2>
            {po.receipts.length === 0 ? (
              <p className="mt-2 text-muted-foreground text-sm">
                {po.status === "draft" || po.status === "cancelled"
                  ? "None."
                  : "Nothing has arrived yet."}
              </p>
            ) : (
              <ol className="mt-3 grid gap-3">
                {po.receipts.map((receipt) => {
                  const cost = costs.get(receipt.id);
                  return (
                    <li key={receipt.id} className="border-success/50 border-s-2 ps-3">
                      <p className="flex items-center gap-1.5 font-medium text-sm">
                        <Truck className="size-3.5 text-muted-foreground" />
                        {formatDate(receipt.receivedOn, locale)}
                      </p>
                      <ul className="mt-1 text-muted-foreground text-xs">
                        {receipt.lines.map((line) => (
                          <li key={line.purchaseOrderLineId}>
                            {n.format(line.quantity)} × {names.get(line.purchaseOrderLineId)}
                          </li>
                        ))}
                      </ul>
                      {receipt.notes ? (
                        <p className="mt-1 text-xs [overflow-wrap:anywhere]">{receipt.notes}</p>
                      ) : null}
                      <Link
                        href={`${base}/${po.id}/deliveries/${receipt.id}`}
                        aria-label={`Landed cost of the delivery on ${formatDate(receipt.receivedOn, locale)}`}
                        className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
                      >
                        {cost ? (
                          <span>
                            Landed{" "}
                            <Amount
                              value={cost.totalCost}
                              currency={cost.currency}
                              locale={locale}
                              className="font-medium"
                            />
                            {Number(cost.landedCost) > 0 ? null : (
                              <span className="text-muted-foreground"> · add freight, duty…</span>
                            )}
                          </span>
                        ) : (
                          <span className="font-medium">Not costed yet</span>
                        )}
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

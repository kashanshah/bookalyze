import {
  formatDecimal,
  orderStatusLabel,
  parseDecimal,
  sellerCentralOrderUrl,
} from "@bookalyze/core";
import { getOrder } from "@bookalyze/db";
import { ArrowLeft, ExternalLink, Package, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { refundBadge, statusVariant } from "../status";

export const metadata: Metadata = { title: "Order" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sum = (values: (string | null)[]) =>
  formatDecimal(values.reduce((t, v) => t + (v ? parseDecimal(v) : 0n), 0n));

export default async function OrderPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getCommerceContext(slug);
  const found = await inOrg(ctx, (tx) => getOrder(tx, id));
  if (!found) notFound();
  const { order, channel, items, refunds } = found;
  const refund = refundBadge(order.total, order.refunded);
  const { locale, timezone } = ctx.profile;
  const currency = order.currency ?? channel.currency;
  const status = orderStatusLabel(order.status);
  const link = sellerCentralOrderUrl(channel.name, order.externalId);
  const placed = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(order.purchasedAt);
  const refundDay = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone });

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Placed", value: placed },
    { label: "Marketplace", value: channel.name },
    {
      label: "Shipped by",
      value:
        order.fulfillment === "amazon"
          ? "Amazon (Fulfilled by Amazon)"
          : "You (merchant fulfilled)",
    },
    {
      label: "Ships to",
      value: [order.shipRegion, order.shipCountry].filter(Boolean).join(", ") || "Not given",
    },
    {
      label: "Items",
      value: `${order.itemsShipped} shipped${order.itemsUnshipped ? `, ${order.itemsUnshipped} to ship` : ""}`,
    },
  ];
  if (order.latestDelivery) {
    facts.push({ label: "Delivery promised by", value: formatDate(order.latestDelivery, locale) });
  }
  const flags = [
    order.isPrime && "Prime",
    order.isBusiness && "Business order",
    order.isReplacement && "Replacement",
  ].filter((f): f is string => Boolean(f));

  const totals = [
    { label: "Items", value: sum(items.map((i) => i.itemPrice)) },
    { label: "Shipping", value: sum(items.map((i) => i.shippingPrice)) },
    { label: "Tax collected", value: sum(items.flatMap((i) => [i.itemTax, i.shippingTax])) },
    { label: "Discounts", value: `-${sum(items.map((i) => i.promotionDiscount))}` },
  ].filter((t) => parseDecimal(t.value) !== 0n);

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/orders`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Orders
      </Link>
      <PageHeader
        title={<span className="tabular">Order {order.externalId}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(order.status)}>{status.label}</Badge>
            {refund ? <Badge variant="destructive">{refund.label}</Badge> : null}
            <span>{refund ? refund.hint : status.hint}</span>
          </span>
        }
        actions={
          link ? (
            <Button asChild variant="outline">
              <a href={link} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open in Seller Central
              </a>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <h2 className="border-b px-5 py-3 font-medium text-sm">What was ordered</h2>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-muted-foreground text-sm">
              <Package className="size-6" />
              {order.itemsSyncedAt
                ? "Amazon didn't list any items for this order."
                : "Item details come in with the next sync, once Amazon has priced the order."}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3.5"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-sm">{i.title ?? i.sku ?? i.asin}</span>
                    <span className="block text-muted-foreground text-xs">
                      {[i.sku && `SKU ${i.sku}`, i.asin && `ASIN ${i.asin}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="text-end text-sm">
                    <Amount value={i.itemPrice} currency={currency} locale={locale} />
                    <span className="block text-muted-foreground text-xs">
                      × {i.quantityOrdered}
                      {i.quantityShipped !== i.quantityOrdered
                        ? ` (${i.quantityShipped} shipped)`
                        : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid gap-2 border-t bg-muted/20 px-5 py-4 text-sm">
            {totals.map((t) => (
              <div key={t.label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t.label}</dt>
                <dd>
                  <Amount value={t.value} currency={currency} locale={locale} />
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 font-semibold">
              <dt>Order total</dt>
              <dd>
                <Amount value={order.total} currency={currency} locale={locale} />
              </dd>
            </div>
            {order.refunded ? (
              <div className="flex justify-between gap-4 font-medium text-destructive">
                <dt>Refunded</dt>
                <dd>
                  <Amount value={`-${order.refunded}`} currency={currency} locale={locale} />
                </dd>
              </div>
            ) : null}
          </dl>
          {refunds.length ? (
            <div className="border-t">
              <h3 className="flex items-center gap-2 px-5 pt-4 pb-1 font-medium text-sm">
                <Undo2 className="size-4 text-destructive" />
                Refunds
              </h3>
              <ul className="divide-y">
                {refunds.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-4 px-5 py-3">
                    <span className="min-w-0 text-sm">
                      <span className="block">{refundDay.format(r.postedAt)}</span>
                      <span className="block text-muted-foreground text-xs">
                        {[
                          r.sku && `SKU ${r.sku}`,
                          r.quantity
                            ? `${r.quantity} ${r.quantity === 1 ? "unit" : "units"}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Money back, no units returned"}
                      </span>
                    </span>
                    <span className="text-destructive text-sm">
                      <Amount
                        value={`-${r.amount}`}
                        currency={r.currency ?? currency}
                        locale={locale}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="h-fit rounded-2xl border bg-card p-5 shadow-xs">
          <dl className="grid gap-3.5 text-sm">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-muted-foreground text-xs">{f.label}</dt>
                <dd className="mt-0.5">{f.value}</dd>
              </div>
            ))}
          </dl>
          {flags.length ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {flags.map((f) => (
                <Badge key={f} variant="primary">
                  {f}
                </Badge>
              ))}
            </div>
          ) : null}
          <p className="mt-5 border-t pt-4 text-muted-foreground text-xs leading-relaxed">
            Buyer names and addresses stay in Seller Central: Bookalyze doesn't ask Amazon for them.
          </p>
        </aside>
      </div>
    </div>
  );
}

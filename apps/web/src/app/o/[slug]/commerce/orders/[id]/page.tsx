import {
  addDaysIso,
  BUYER_CLAIMS,
  type BuyerClaim,
  can,
  formatDecimal,
  formatInvoiceNumber,
  ORDER_STATUS_GROUPS,
  orderStatusLabel,
  parseDecimal,
  REVIEW_STATUS_LABELS,
  reviewWindow,
  sellerCentralOrderUrl,
} from "@bookalyze/core";
import { getOrder, getOrderInvoice, getReviewRequest } from "@bookalyze/db";
import { ArrowLeft, Download, ExternalLink, FileText, Package, Star, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatPurchaseDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { AskOneButton, EligibilityCheck } from "../../../reviews/review-rows";
import { refundBadge, statusVariant } from "../status";
import { InvoiceDialog } from "./invoice-dialog";

/** Review requests and the invoice lookup talk to Amazon from this page. */
export const maxDuration = 60;

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
  const reviewsOn = can(ctx.plan, ctx.enabledModules, "reviews.manual");
  const found = await inOrg(ctx, async (tx) => {
    const row = await getOrder(tx, id);
    if (!row) return null;
    return {
      ...row,
      request: reviewsOn ? await getReviewRequest(tx, id) : null,
      invoice: await getOrderInvoice(tx, id),
    };
  });
  if (!found) notFound();
  const { order, channel, items, refunds, request, replaces, replacedBy, invoice } = found;
  const claim = order.buyerClaim ? BUYER_CLAIMS[order.buyerClaim as BuyerClaim] : null;
  const ordersBase = `/o/${slug}/commerce/orders`;
  const refund = refundBadge(order.total, order.refunded);
  const { locale, timezone } = ctx.profile;
  const today = nowIn(timezone).date;
  const reviewDays = reviewWindow({
    ...order,
    purchasedOn: order.purchasedAt.toISOString().slice(0, 10),
  });
  const currency = order.currency ?? channel.currency;
  const status = orderStatusLabel(order.status);
  const link = sellerCentralOrderUrl(channel.name, order.externalId);
  const placed = formatPurchaseDate(order.purchasedAt, locale, timezone);
  const refundDay = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone });

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Purchase date", value: <span className="tabular">{placed}</span> },
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
  const flags = [order.isPrime && "Prime", order.isBusiness && "Business order"].filter(
    (f): f is string => Boolean(f),
  );

  const review = reviewsOn ? reviewSummary() : null;
  /**
   * The review card: the request if there is one, otherwise what Amazon said when last asked
   * (FBA orders have no delivery dates, so Amazon's answer is what counts), else the window.
   */
  function reviewSummary(): {
    badge: { text: string; variant: "success" | "outline" | "secondary" } | null;
    text: string;
    reason: string | null;
    canAsk: boolean;
    check: "auto" | "button" | null;
  } {
    const moment = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    });
    const shipped = (ORDER_STATUS_GROUPS.shipped as readonly string[]).includes(order.status);
    const last = reviewDays ? addDaysIso(reviewDays.closes, -1) : null;
    const closed = Boolean(last && today > last);
    const eligible = order.reviewEligible;
    const checked = order.reviewCheckedAt;
    const stale = !checked || Date.now() - checked.getTime() > 60 * 60 * 1000;
    const checkable = shipped && !closed;
    const check = checkable ? (stale ? "auto" : "button") : null;
    const checkedNote = checked ? ` Checked ${moment.format(checked)}.` : "";
    const estimateNote = reviewDays?.estimated
      ? "Amazon doesn't share delivery dates for orders it ships (FBA): it takes a request from 5 days after delivery."
      : null;

    if (request?.status === "sent") {
      return {
        badge: { text: REVIEW_STATUS_LABELS.sent.label, variant: "success" },
        text: request.sentAt ? moment.format(request.sentAt) : "",
        reason: null,
        canAsk: false,
        check: null,
      };
    }
    if (request && request.status !== "scheduled") {
      return {
        badge: { text: REVIEW_STATUS_LABELS[request.status].label, variant: "outline" },
        text: "",
        reason: request.reason,
        canAsk: false,
        check: null,
      };
    }
    if (!shipped || !reviewDays || !last) {
      return {
        badge: null,
        text: "Can be asked once Amazon has shipped it.",
        reason: null,
        canAsk: false,
        check: null,
      };
    }
    if (closed) {
      return {
        badge: null,
        text: `Amazon's window closed ${reviewDays.estimated ? "around" : "on"} ${formatDate(last, locale)}.`,
        reason: null,
        canAsk: false,
        check: null,
      };
    }
    const scheduled =
      request?.status === "scheduled" && request.dueAt
        ? `Goes out automatically ${moment.format(request.dueAt)}. `
        : "";
    if (eligible === true) {
      return {
        badge: { text: "Ready to ask", variant: "success" },
        text: `${scheduled}Amazon is taking a review request for this order now.${checkedNote}`,
        reason: request?.reason ?? null,
        canAsk: true,
        check,
      };
    }
    if (eligible === false) {
      return {
        badge: { text: "Not yet", variant: "secondary" },
        text: `${scheduled}Amazon isn't taking a review request for this order yet.${checkedNote}`,
        reason:
          estimateNote ??
          "If it was already asked from Seller Central, Amazon won't take another request.",
        canAsk: false,
        check,
      };
    }
    const range = `${formatDate(reviewDays.opens, locale)} to ${formatDate(last, locale)}`;
    return {
      badge: request ? { text: REVIEW_STATUS_LABELS.scheduled.label, variant: "secondary" } : null,
      text: `${scheduled}${
        reviewDays.estimated
          ? `Likely from ${range}. Checking with Amazon…`
          : today < reviewDays.opens
            ? `Can be asked from ${range}.`
            : `Not asked yet. Amazon takes a request until ${formatDate(last, locale)}.`
      }`,
      reason: estimateNote,
      canAsk: today >= reviewDays.opens,
      check,
    };
  }

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
            {refund ? (
              <Badge variant="destructive" title={refund.hint}>
                {refund.label}
              </Badge>
            ) : null}
            {claim ? (
              <Badge variant="destructive" title={claim.hint}>
                {claim.label}
              </Badge>
            ) : null}
            {replacedBy.length ? (
              <Badge variant="warning" title="Amazon sent the buyer a replacement for this order">
                Replaced
              </Badge>
            ) : null}
            {order.isReplacement ? (
              <Badge variant="warning" title="Sent to replace another order">
                Replacement
              </Badge>
            ) : null}
            <span>{claim ? claim.hint : refund ? refund.hint : status.hint}</span>
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
      {replaces || replacedBy.length ? (
        <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-warning/10 px-4 py-2.5 text-sm">
          {replaces ? (
            <span>
              Replacement for order{" "}
              {replaces.id ? (
                <Link
                  href={`${ordersBase}/${replaces.id}`}
                  className="tabular font-medium underline-offset-4 hover:underline"
                >
                  {replaces.externalId}
                </Link>
              ) : (
                <span className="tabular font-medium">{replaces.externalId}</span>
              )}
            </span>
          ) : null}
          {replacedBy.map((r) => (
            <span key={r.id}>
              Replaced by order{" "}
              <Link
                href={`${ordersBase}/${r.id}`}
                className="tabular font-medium underline-offset-4 hover:underline"
              >
                {r.externalId}
              </Link>
            </span>
          ))}
        </div>
      ) : null}

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

        <div className="grid h-fit gap-6">
          <aside className="rounded-2xl border bg-card p-5 shadow-xs">
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
              The order itself doesn't keep the buyer's name or address. A customer invoice can
              include the name and tax number, and you can add an address.
            </p>
          </aside>
          {invoice || isOrgAdmin(ctx) ? (
            <section className="rounded-2xl border bg-card p-5 shadow-xs">
              <h2 className="flex items-center gap-2 font-medium text-sm">
                <FileText className="size-4 text-primary" />
                Customer invoice
              </h2>
              {invoice ? (
                <>
                  <p className="mt-2 text-sm">
                    <span className="tabular font-medium">
                      {formatInvoiceNumber(invoice.invoiceNumber)}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                    Upload this file in Seller Central, on the buyer's invoice request. Sending it
                    from here comes later.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <a href={`/api/o/${slug}/invoices/${invoice.id}?download=1`}>
                        <Download />
                        Download
                      </a>
                    </Button>
                    {isOrgAdmin(ctx) ? (
                      <InvoiceDialog
                        slug={slug}
                        orderId={order.id}
                        locale={locale}
                        mode="correct"
                      />
                    ) : null}
                  </div>
                </>
              ) : items.length === 0 || order.total == null ? (
                <p className="mt-2 text-muted-foreground text-sm">
                  You can create an invoice once Amazon has priced this order.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                    A PDF for the buyer, from this order. Upload it in Seller Central on their
                    invoice request. Sending it from here comes later.
                  </p>
                  <div className="mt-4">
                    <InvoiceDialog slug={slug} orderId={order.id} locale={locale} mode="create" />
                  </div>
                </>
              )}
            </section>
          ) : null}
          {review ? (
            <section className="rounded-2xl border bg-card p-5 shadow-xs">
              <h2 className="flex items-center gap-2 font-medium text-sm">
                <Star className="size-4 text-primary" />
                Review request
              </h2>
              <p className="mt-2 text-sm">
                {review.badge ? (
                  <Badge variant={review.badge.variant} className="me-2">
                    {review.badge.text}
                  </Badge>
                ) : null}
                {review.text}
              </p>
              {review.reason ? (
                <p className="mt-1 text-muted-foreground text-xs">{review.reason}</p>
              ) : null}
              {(review.canAsk && isOrgAdmin(ctx)) || review.check ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {review.canAsk && isOrgAdmin(ctx) ? (
                    <AskOneButton slug={slug} orderId={order.id} />
                  ) : null}
                  {review.check ? (
                    <EligibilityCheck
                      slug={slug}
                      orderId={order.id}
                      auto={review.check === "auto"}
                    />
                  ) : null}
                </div>
              ) : null}
              <Link
                href={`/o/${slug}/reviews`}
                className="mt-4 block text-primary text-xs underline-offset-4 hover:underline"
              >
                All review requests
              </Link>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

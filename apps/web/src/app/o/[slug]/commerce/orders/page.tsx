import {
  fiscalYearFor,
  ORDER_STATUS_GROUPS,
  type OrderStatusGroup,
  orderStatusLabel,
  parseDecimal,
} from "@bookalyze/core";
import {
  countOrdersNeedingItems,
  hasOrders,
  listAmazonConnections,
  listOrders,
  orderSyncChannels,
} from "@bookalyze/db";
import { ArrowLeft, ArrowRight, ChevronRight, PackageSearch, Search, Store, X } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isIsoDate, nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { fiscalConfigOf, isOrgAdmin } from "@/server/org";
import { MarketplaceFilter } from "./order-filters";
import { IncludeChannels, StartOrders, SyncOrdersButton } from "./order-sync";
import { refundBadge, statusVariant } from "./status";

export const metadata: Metadata = { title: "Orders" };
/** "Bring in new orders" runs inside this page's server actions. */
export const maxDuration = 60;

const PER_PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS: { key: "" | OrderStatusGroup | "refunded"; label: string }[] = [
  { key: "", label: "All orders" },
  { key: "open", label: "Open" },
  { key: "shipped", label: "Shipped" },
  { key: "cancelled", label: "Cancelled" },
  { key: "refunded", label: "Refunded" },
];

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    status?: string;
    channel?: string;
    q?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getCommerceContext(slug);
  const { locale, timezone } = ctx.profile;
  const today = nowIn(timezone).date;
  const status = TABS.some((t) => t.key === sp.status)
    ? (sp.status as OrderStatusGroup | "refunded")
    : "";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const from = isIsoDate(sp.from) ? sp.from : "";
  const to = isIsoDate(sp.to) ? sp.to : "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const data = await inOrg(ctx, async (tx) => {
    const connections = (await listAmazonConnections(tx)).filter(
      (c) => c.status !== "disconnected",
    );
    const channels = connections.flatMap((c) => c.channels.filter((ch) => ch.isActive));
    const syncing = await orderSyncChannels(tx);
    const channel = sp.channel && UUID.test(sp.channel) ? sp.channel : "";
    const list = await listOrders(tx, {
      channelId: channel || null,
      statuses: status && status !== "refunded" ? ORDER_STATUS_GROUPS[status] : null,
      refunded: status === "refunded",
      search: q || null,
      from: from || null,
      to: to || null,
      timezone,
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    });
    return {
      connections,
      channels,
      syncing,
      channel,
      list,
      any: list.count > 0 || (await hasOrders(tx)),
      waiting: syncing.length ? await countOrdersNeedingItems(tx) : 0,
    };
  });
  const { connections, channels, syncing, channel, list, any, waiting } = data;
  const notStarted = channels.filter((ch) => !syncing.some((s) => s.id === ch.id));
  const canManage = isOrgAdmin(ctx);

  const base = `/o/${slug}/commerce/orders`;
  const href = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    const values = { status, channel, q, from, to, page: 1, ...over };
    for (const [k, v] of Object.entries(values)) {
      if (v && !(k === "page" && v === 1)) p.set(k, String(v));
    }
    return `${base}${p.size ? `?${p}` : ""}`;
  };
  const filtered = Boolean(status || channel || q || from || to);
  /** Filters beyond the status tab, which "Clear filters" resets. */
  const narrowed = Boolean(channel || q || from || to);
  const clearHref = href({ channel: "", q: "", from: "", to: "" });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone });
  const lastSynced = syncing
    .map((s) => s.ordersSyncedThrough)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const header = (
    <PageHeader
      eyebrow="Commerce"
      title="Orders"
      description="Every order from your marketplaces, kept up to date every few minutes. Orders don't change your books: Amazon's settlements do."
      actions={syncing.length ? <SyncOrdersButton slug={slug} /> : null}
    />
  );

  if (!connections.length || !channels.length) {
    return (
      <div className="grid gap-8">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Store className="size-6" />
          </span>
          <p className="font-medium">
            {connections.length ? "No marketplace is switched on" : "Connect a marketplace first"}
          </p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {connections.length
              ? "Switch on the marketplaces you sell in, and their orders can come in."
              : "Connect Amazon Seller Central, and your orders can come in here."}
          </p>
          <Button asChild variant="outline">
            <Link href={`/o/${slug}/commerce/channels`}>Go to Channels</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!syncing.length) {
    const fy = fiscalYearFor(today, fiscalConfigOf(ctx.profile));
    const earliest = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
    return (
      <div className="grid gap-8">
        {header}
        <StartOrders
          slug={slug}
          defaultFrom={fy.start < earliest ? earliest : fy.start}
          earliest={earliest}
          today={today}
          locale={locale}
          channels={channels.map((c) => c.name)}
          canManage={canManage}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {header}

      <p className="-mt-2 text-muted-foreground text-sm">
        {[
          lastSynced
            ? `Up to date as of ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(lastSynced)}`
            : "The first orders are on their way",
          waiting
            ? `item details still coming for ${waiting} ${waiting === 1 ? "order" : "orders"}, on their own (Amazon allows about 30 a minute)`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {notStarted.length ? (
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary/5 px-4 py-3 text-sm">
          <span>
            {notStarted.map((c) => c.name).join(", ")} {notStarted.length === 1 ? "was" : "were"}{" "}
            switched on later and {notStarted.length === 1 ? "isn't" : "aren't"} bringing orders in
            yet.
          </span>
          {canManage ? (
            <IncludeChannels
              slug={slug}
              from={
                syncing
                  .map((s) => s.ordersFrom)
                  .filter((d): d is string => Boolean(d))
                  .sort()[0] ?? today
              }
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Filter orders"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href({ status: t.key })}
              scroll={false}
              aria-current={t.key === status ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                t.key === status
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Form
          key={`${channel}|${q}|${from}|${to}`}
          className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap"
          action={base}
          scroll={false}
        >
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {channels.length > 1 ? (
            <MarketplaceFilter
              channels={channels.map((c) => ({ id: c.id, name: c.name }))}
              value={channel}
            />
          ) : null}
          <Input
            type="date"
            name="from"
            defaultValue={from}
            aria-label="Placed from"
            className="h-9 sm:w-[9.5rem]"
          />
          <span className="hidden text-muted-foreground text-sm sm:inline">to</span>
          <Input
            type="date"
            name="to"
            defaultValue={to}
            aria-label="Placed to"
            className="h-9 sm:w-[9.5rem]"
          />
          <div className="relative col-span-2 row-start-1 min-w-0 sm:row-start-auto sm:w-64">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Order number, SKU or product"
              aria-label="Search orders"
              className="h-9 ps-9"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" className="col-span-2 h-9">
            Show
          </Button>
          {narrowed ? (
            <Button asChild variant="ghost" size="sm" className="col-span-2 h-9">
              <Link href={clearHref} scroll={false}>
                <X />
                Clear filters
              </Link>
            </Button>
          ) : null}
        </Form>
      </div>

      {list.totals.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.totals.map((t) => {
            const active = channel === t.channelId;
            const clickable = channels.length > 1;
            const body = (
              <>
                <p className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                  <span>
                    {t.channelName} sales, not counting cancelled
                    {list.totals.some((o) => o.channelId === t.channelId && o !== t)
                      ? ` (${t.currency})`
                      : ""}
                  </span>
                  {active ? <X className="size-3.5 shrink-0" aria-hidden /> : null}
                </p>
                <p className="mt-1 font-semibold text-xl tracking-tight">
                  <Amount value={t.sales} currency={t.currency} locale={locale} />
                </p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {t.sold} {t.sold === 1 ? "order" : "orders"} · {t.units}{" "}
                  {t.units === 1 ? "unit" : "units"}
                  {parseDecimal(t.refunded) > 0n ? (
                    <>
                      {" · "}
                      <span className="text-destructive">
                        <Amount value={t.refunded} currency={t.currency} locale={locale} /> refunded
                      </span>
                    </>
                  ) : null}
                </p>
              </>
            );
            const card = "rounded-2xl border bg-card px-5 py-4 shadow-xs";
            return clickable ? (
              <Link
                key={`${t.channelId}:${t.currency}`}
                href={href({ channel: active ? "" : t.channelId })}
                scroll={false}
                aria-current={active ? "true" : undefined}
                title={active ? "Show every marketplace" : `Show only ${t.channelName}`}
                className={cn(
                  card,
                  "transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-md",
                  active && "border-primary/50 ring-2 ring-primary/15",
                )}
              >
                {body}
              </Link>
            ) : (
              <div key={`${t.channelId}:${t.currency}`} className={card}>
                {body}
              </div>
            );
          })}
        </div>
      ) : null}

      {list.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <PackageSearch className="size-6" />
          </span>
          <p className="font-medium">{filtered && any ? "No orders match." : "No orders yet"}</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {filtered && any
              ? "Try another search, dates or tab."
              : "Orders placed since the start date show up here as they come in."}
          </p>
          {narrowed && any ? (
            <Button asChild variant="outline" size="sm">
              <Link href={clearHref} scroll={false}>
                Clear filters
              </Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[7rem_minmax(0,1fr)_8rem_7rem_8rem_1.25rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
            <span>Placed</span>
            <span>Order</span>
            <span>Status</span>
            <span>Shipped by</span>
            <span className="text-end">Total</span>
            <span />
          </div>
          <ul className="divide-y">
            {list.rows.map((o, i) => {
              const cancelled = (ORDER_STATUS_GROUPS.cancelled as readonly string[]).includes(
                o.status,
              );
              const refund = refundBadge(o.total, o.refunded);
              const what = o.firstTitle
                ? `${o.firstTitle}${o.lines > 1 ? ` + ${o.lines - 1} more` : ""}`
                : cancelled
                  ? "Cancelled order"
                  : o.units
                    ? `${o.units} ${o.units === 1 ? "item" : "items"}`
                    : "Order";
              return (
                <li
                  key={o.id}
                  className="fade-in-0 animate-in fill-mode-both"
                  style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                >
                  <Link
                    href={`${base}/${o.id}`}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5 md:grid-cols-[7rem_minmax(0,1fr)_8rem_7rem_8rem_1.25rem]"
                  >
                    <span className="hidden text-muted-foreground text-sm md:block">
                      {day.format(o.purchasedAt)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-sm">{what}</span>
                      <span className="block truncate text-muted-foreground text-xs">
                        <span className="md:hidden">{day.format(o.purchasedAt)} · </span>
                        <span className="tabular">{o.externalId}</span>
                        {channels.length > 1 ? ` · ${o.channelName}` : ""}
                      </span>
                    </span>
                    <span className="col-start-1 flex flex-wrap gap-1 md:col-start-auto">
                      <Badge variant={statusVariant(o.status)}>
                        {orderStatusLabel(o.status).label}
                      </Badge>
                      {refund ? (
                        <Badge variant="destructive" title={refund.hint}>
                          {refund.label}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="hidden text-muted-foreground text-sm md:block">
                      {o.fulfillment === "amazon" ? "Amazon (FBA)" : "You"}
                    </span>
                    <span
                      className={cn(
                        "col-start-2 row-span-2 row-start-1 text-end font-medium text-sm md:col-start-auto md:row-span-1 md:row-start-auto",
                        cancelled && "text-muted-foreground line-through",
                      )}
                    >
                      <Amount value={o.total} currency={o.currency} locale={locale} />
                    </span>
                    <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block rtl:rotate-180" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {list.count > PER_PAGE ? (
        <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
          <span>
            {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, list.count)} of {list.count}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: page - 1 })}>
                  <ArrowLeft className="rtl:rotate-180" />
                  Newer
                </Link>
              </Button>
            ) : null}
            {page * PER_PAGE < list.count ? (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: page + 1 })}>
                  Older
                  <ArrowRight className="rtl:rotate-180" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { PURCHASE_ORDER_STATUS_LABELS, purchaseOrderNumber } from "@bookalyze/core";
import { listPurchaseOrders, type PurchaseOrderStatus } from "@bookalyze/db";
import { ClipboardList, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { StatusBadge } from "./status-badge";

export const metadata: Metadata = { title: "Purchase orders" };

const TABS = [
  { key: "open", label: "Open" },
  { key: "received", label: "Received" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function PurchaseOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.status) ? (sp.status as Tab) : "open";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const ctx = await getInventoryContext(slug, "inventory.purchasing");
  const { locale } = ctx.profile;
  const rows = await inOrg(ctx, (tx) =>
    listPurchaseOrders(tx, {
      ...(tab === "all" ? {} : { status: tab as PurchaseOrderStatus | "open" }),
      ...(q ? { search: q } : {}),
    }),
  );
  const base = `/o/${slug}/inventory/purchase-orders`;
  const href = (status: Tab) => {
    const p = new URLSearchParams();
    if (status !== "open") p.set("status", status);
    if (q) p.set("q", q);
    return `${base}${p.size ? `?${p}` : ""}`;
  };
  const number = new Intl.NumberFormat(locale);

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Inventory"
        title="Purchase orders"
        description="What you've ordered from suppliers, and what has arrived. Record each delivery when it comes in, so you always know what's still on its way."
        actions={
          <Button asChild>
            <Link href={`${base}/new`}>
              <Plus />
              New purchase order
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Purchase order status" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href(t.key)}
              scroll={false}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                tab === t.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form className="relative w-full sm:w-72" action={base}>
          {tab !== "open" ? <input type="hidden" name="status" value={tab} /> : null}
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Supplier, reference or PO number"
            aria-label="Search purchase orders"
            className="ps-9"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="size-6" />
          </span>
          <p className="font-medium">
            {q ? "No purchase orders match." : tab === "open" ? "Nothing on order" : "None here"}
          </p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {q
              ? "Try another supplier, reference or number."
              : "Create a purchase order when you buy stock from a supplier. Its products come from your Products list."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[7rem_minmax(0,1.4fr)_8rem_9rem_minmax(0,1fr)] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
            <span>Number</span>
            <span>Supplier</span>
            <span>Ordered</span>
            <span>Arrived</span>
            <span className="text-end">Total</span>
          </div>
          <ul className="divide-y">
            {rows.map((po, i) => (
              <li
                key={po.id}
                className="fade-in-0 animate-in fill-mode-both"
                style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
              >
                <Link
                  href={`${base}/${po.id}`}
                  aria-label={`${purchaseOrderNumber(po.number)}, ${po.supplierName}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-accent/40 sm:px-5 md:grid-cols-[7rem_minmax(0,1.4fr)_8rem_9rem_minmax(0,1fr)]"
                >
                  <span className="font-medium font-mono text-sm">
                    {purchaseOrderNumber(po.number)}
                  </span>
                  <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-2 md:col-span-1 md:row-start-auto">
                    <span className="truncate text-sm">{po.supplierName}</span>
                    {po.reference ? (
                      <span className="truncate text-muted-foreground text-xs">{po.reference}</span>
                    ) : null}
                  </span>
                  <span className="hidden text-muted-foreground text-sm md:block">
                    {formatDate(po.orderDate, locale)}
                  </span>
                  <span className="col-span-2 row-start-3 flex items-center gap-2 md:col-span-1 md:row-start-auto">
                    <StatusBadge status={po.status} />
                    {po.status === "partial" ? (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {number.format(po.received)} of {number.format(po.units)}
                      </span>
                    ) : null}
                  </span>
                  <span className="col-start-2 row-start-1 text-end text-sm md:col-start-auto md:row-start-auto">
                    <Amount value={po.total} currency={po.currency} locale={locale} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {PURCHASE_ORDER_STATUS_LABELS.partial} means some of the order has arrived. Costs come into
        your books with the next step (landed costs and stock lots).
      </p>
    </div>
  );
}

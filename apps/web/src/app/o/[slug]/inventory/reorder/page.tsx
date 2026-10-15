import { can, planReorder, type ReorderStatus } from "@bookalyze/core";
import { getReorderSettings, reorderProducts } from "@bookalyze/db";
import { ClipboardList, PackageSearch, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { isOrgAdmin } from "@/server/org";
import { ProductReorderDialog, ReorderSettingsDialog } from "./reorder-settings";

export const metadata: Metadata = { title: "Reorder" };

const STATUS: Record<
  ReorderStatus,
  { label: string; variant: "destructive" | "warning" | "success" | "outline"; rank: number }
> = {
  order_now: { label: "Order now", variant: "destructive", rank: 0 },
  order_soon: { label: "Order soon", variant: "warning", rank: 1 },
  ok: { label: "Enough stock", variant: "success", rank: 2 },
  no_sales: { label: "Not selling", variant: "outline", rank: 3 },
};

export default async function ReorderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getInventoryContext(slug, "inventory.reorder");
  const { locale, timezone } = ctx.profile;
  const today = nowIn(timezone).date;
  const { settings, rows } = await inOrg(ctx, async (tx) => ({
    settings: await getReorderSettings(tx),
    rows: await reorderProducts(tx, { timezone, today }),
  }));
  const canOrder = can(ctx.plan, ctx.enabledModules, "inventory.purchasing");
  const base = `/o/${slug}/inventory`;

  const planned = rows
    .map((row) => {
      const leadTimeDays = row.leadTimeDays ?? settings.leadTimeDays;
      return {
        row,
        leadTimeDays,
        plan: planReorder({
          today,
          dailyUnits: row.dailyUnits,
          inStock: row.inStock,
          onOrder: row.onOrder,
          leadTimeDays,
          coverDays: settings.coverDays,
          minimumOrder: row.minimumOrder,
          casePack: row.casePack,
        }),
      };
    })
    .sort(
      (a, b) =>
        STATUS[a.plan.status].rank - STATUS[b.plan.status].rank ||
        (a.plan.orderBy ?? "9").localeCompare(b.plan.orderBy ?? "9") ||
        a.row.name.localeCompare(b.row.name),
    );
  const now = planned.filter((p) => p.plan.status === "order_now").length;
  const soon = planned.filter((p) => p.plan.status === "order_soon").length;
  const n = new Intl.NumberFormat(locale);
  const rate = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const day = (iso: string | null) => (iso ? formatDate(iso, locale, "medium") : "—");

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Inventory"
        title="Reorder"
        description={`When each product runs out at the pace it's selling, and how many to order by when so new stock arrives first. Lead time ${settings.leadTimeDays} days, each order lasting ${settings.coverDays} days.`}
        actions={
          isOrgAdmin(ctx) ? (
            <ReorderSettingsDialog
              slug={slug}
              leadTimeDays={settings.leadTimeDays}
              coverDays={settings.coverDays}
            />
          ) : null
        }
      />

      {planned.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <PackageSearch className="size-6" />
          </span>
          <p className="font-medium">Nothing to plan yet</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            Products show here once their marketplace SKUs are linked and they're selling, in stock,
            or on order.
          </p>
          <Button asChild variant="outline">
            <Link href={`${base}/products`}>Go to Products</Link>
          </Button>
        </div>
      ) : (
        <>
          <p
            className={cn(
              "flex items-start gap-2 rounded-xl px-4 py-3 text-sm",
              now ? "bg-destructive/10" : soon ? "bg-warning/10" : "bg-success/10",
            )}
          >
            <ClipboardList className="mt-0.5 size-4 shrink-0" />
            <span>
              {now || soon
                ? [
                    now ? `${n.format(now)} to order now` : null,
                    soon ? `${n.format(soon)} to order in the next two weeks` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Every product has enough stock for now."}
            </span>
          </p>

          <section
            aria-label="Products to reorder"
            className="overflow-hidden rounded-2xl border bg-card shadow-xs"
          >
            <ul className="divide-y">
              {planned.map(({ row, plan, leadTimeDays }, i) => (
                <li
                  key={row.productId}
                  aria-label={row.name}
                  className="fade-in-0 grid animate-in gap-3 fill-mode-both px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{row.name}</span>
                      <Badge variant={STATUS[plan.status].variant}>
                        {STATUS[plan.status].label}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {row.sku ? `${row.sku} · ` : ""}
                      Lead time {leadTimeDays} days
                      {row.leadTimeDays !== null ? " (its own)" : ""}
                      {row.minimumOrder ? ` · minimum ${n.format(row.minimumOrder)}` : ""}
                      {row.casePack ? ` · cartons of ${n.format(row.casePack)}` : ""}
                    </p>
                    <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-sm sm:grid-cols-6">
                      <Stat label="Sells a day" value={rate.format(plan.velocity)} />
                      <Stat label="In stock" value={n.format(row.inStock)} />
                      <Stat label="On order" value={n.format(row.onOrder)} />
                      <Stat
                        label="Runs out"
                        value={day(plan.runsOutOn)}
                        tone={plan.daysLeft !== null && plan.daysLeft < leadTimeDays}
                      />
                      <Stat label="Order by" value={day(plan.orderBy)} />
                      <Stat
                        label="Order"
                        value={plan.orderQuantity ? n.format(plan.orderQuantity) : "—"}
                        strong={plan.orderQuantity > 0}
                      />
                    </dl>
                  </div>
                  <div className="flex items-center gap-1 sm:justify-end">
                    {canOrder && plan.orderQuantity > 0 ? (
                      <Button
                        asChild
                        size="sm"
                        variant={plan.status === "order_now" ? "default" : "outline"}
                      >
                        <Link
                          href={`${base}/purchase-orders/new?add=${row.productId}:${plan.orderQuantity}`}
                        >
                          <ShoppingCart />
                          Order {n.format(plan.orderQuantity)}
                        </Link>
                      </Button>
                    ) : null}
                    <ProductReorderDialog
                      slug={slug}
                      companyLeadTime={settings.leadTimeDays}
                      product={{
                        id: row.productId,
                        name: row.name,
                        leadTimeDays: row.leadTimeDays,
                        minimumOrder: row.minimumOrder,
                        casePack: row.casePack,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-muted-foreground text-xs leading-relaxed">
            <strong className="font-medium text-foreground">How it's worked out.</strong> Sells a
            day weighs the last week most, then the last month and the last three months. In stock
            is what's left in your stock lots, less what's shipped since cost of goods sold was last
            posted. Each plan keeps a little extra for uneven weeks (safety stock), and orders
            enough to last the lead time plus {settings.coverDays} days, less what's in stock and on
            order.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={cn(
          "truncate tabular-nums",
          tone && "text-destructive",
          strong && "font-semibold",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

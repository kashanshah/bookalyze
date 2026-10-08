import { ledgerByMonth, ledgerChannels, stockComparison } from "@bookalyze/db";
import { ArrowLeftRight, CheckCircle2, Clock } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { SyncLedgerButton, UploadLedgerButton } from "./ledger-buttons";

export const metadata: Metadata = { title: "Stock movements" };

function monthName(month: string, locale: string) {
  return new Date(`${month}-15T00:00:00Z`).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const COLUMNS = [
  { key: "shipped", label: "Shipped", hint: "To customers" },
  { key: "returned", label: "Returned", hint: "By customers" },
  { key: "adjusted", label: "Lost or found", hint: "Net adjustments" },
  { key: "removed", label: "Removed", hint: "Sent back to you" },
  { key: "received", label: "Received", hint: "At Amazon" },
] as const;

export default async function MovementsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getInventoryContext(slug, "inventory.cogs");
  const { locale } = ctx.profile;
  const { channels, months, compare } = await inOrg(ctx, async (tx) => ({
    channels: await ledgerChannels(tx),
    months: await ledgerByMonth(tx, { months: 6 }),
    compare: await stockComparison(tx),
  }));
  const active = channels.filter((c) => c.isActive);
  const names = new Map(channels.map((c) => [c.id, c.name]));
  const monthKeys = [...new Set(months.map((m) => m.month))];
  const n = new Intl.NumberFormat(locale, { signDisplay: "exceptZero" });
  const plain = new Intl.NumberFormat(locale);

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Inventory"
        title="Stock movements"
        description="Amazon's FBA inventory ledger: every unit shipped, returned, lost, found, removed or received. Returns go back into your stock lots and losses are written off when each month's cost of goods sold is posted."
        actions={
          active.length ? (
            <div className="flex flex-wrap gap-2">
              <UploadLedgerButton
                slug={slug}
                channels={active.map((c) => ({ id: c.id, name: c.name }))}
              />
              <SyncLedgerButton slug={slug} />
            </div>
          ) : null
        }
      />

      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ArrowLeftRight className="size-6" />
          </span>
          <p className="font-medium">Connect Amazon first</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            Stock movements come from Amazon's inventory ledger, once a marketplace is connected
            under Commerce → Channels.
          </p>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((c) => (
              <div key={c.id} className="rounded-2xl border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm">{c.name}</p>
                  {c.reportId ? (
                    <Badge variant="secondary">
                      <Clock />
                      Amazon is making a report
                    </Badge>
                  ) : c.through ? (
                    <Badge variant="success">
                      <CheckCircle2 />
                      Brought in
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-muted-foreground text-sm">
                  {c.through
                    ? `In through ${formatDate(c.through, locale, "long")} · ${plain.format(c.events)} movements`
                    : "Not brought in yet. It comes in every night, or press Bring in from Amazon."}
                </p>
              </div>
            ))}
          </section>

          {compare.length ? (
            <section
              aria-labelledby="compare-title"
              className="overflow-hidden rounded-2xl border bg-card shadow-xs"
            >
              <div className="border-b px-5 py-3">
                <h2 id="compare-title" className="font-medium text-sm">
                  Your stock against Amazon's
                </h2>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  Units left in your stock lots, and what Amazon holds to sell now (from Check
                  Amazon for all SKUs on Products). Some difference is normal: units on their way
                  in, reserved for orders, or with you.
                </p>
              </div>
              <ul className="divide-y">
                {compare.map((row) => {
                  const diff = row.atAmazon === null ? null : row.inLots - row.atAmazon;
                  return (
                    <li
                      key={row.productId}
                      aria-label={row.productName}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-3 text-sm"
                    >
                      <span className="truncate">{row.productName}</span>
                      <span className="text-end tabular-nums">
                        <span className="block text-muted-foreground text-xs">In your lots</span>
                        {plain.format(row.inLots)}
                      </span>
                      <span className="w-28 text-end tabular-nums">
                        <span className="block text-muted-foreground text-xs">At Amazon</span>
                        {row.atAmazon === null ? "—" : plain.format(row.atAmazon)}
                        {diff ? (
                          <span
                            className={cn(
                              "ms-1.5 text-xs",
                              diff > 0 ? "text-muted-foreground" : "text-destructive",
                            )}
                          >
                            ({n.format(-diff)})
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {monthKeys.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground text-sm">
              No movements yet. Bring the ledger in from Amazon, or upload it from Seller Central →
              Reports → Fulfillment → Inventory Ledger (Detailed view).
            </p>
          ) : (
            monthKeys.map((month) => (
              <section
                key={month}
                aria-label={`Movements in ${monthName(month, locale)}`}
                className="fade-in-0 animate-in overflow-hidden rounded-2xl border bg-card shadow-xs"
              >
                <h2 className="border-b px-5 py-3 font-medium">{monthName(month, locale)}</h2>
                <div className="hidden grid-cols-[minmax(0,1fr)_repeat(5,5.5rem)] gap-3 border-b bg-muted/30 px-5 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
                  <span>SKU</span>
                  {COLUMNS.map((c) => (
                    <span key={c.key} className="text-end" title={c.hint}>
                      {c.label}
                    </span>
                  ))}
                </div>
                <ul className="divide-y">
                  {months
                    .filter((m) => m.month === month)
                    .map((m) => (
                      <li
                        key={`${m.channelId}:${m.sku}`}
                        aria-label={m.sku}
                        className="grid grid-cols-2 gap-x-3 gap-y-1 px-5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_repeat(5,5.5rem)] md:items-center"
                      >
                        <div className="col-span-2 min-w-0 md:col-span-1">
                          <p className="truncate font-medium">{m.sku}</p>
                          <p className="truncate text-muted-foreground text-xs">
                            {m.productName ?? "Not linked to a product"}
                            {channels.length > 1 ? ` · ${names.get(m.channelId) ?? ""}` : ""}
                          </p>
                        </div>
                        {COLUMNS.map((c) => (
                          <p
                            key={c.key}
                            className="flex justify-between tabular-nums md:block md:text-end"
                          >
                            <span className="text-muted-foreground text-xs md:hidden">
                              {c.label}
                            </span>
                            <span className={m[c.key] ? undefined : "text-muted-foreground"}>
                              {m[c.key] ? n.format(m[c.key]) : "·"}
                            </span>
                          </p>
                        ))}
                      </li>
                    ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

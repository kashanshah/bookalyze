import { type StockOverviewRow, stockOverview } from "@bookalyze/db";
import { Boxes } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { RemoveStockCount, StockCountDialog } from "./stock-count";

export const metadata: Metadata = { title: "Stock" };

const MONTH = (m: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

export default async function StockPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getInventoryContext(slug, "inventory.cogs");
  const { locale, timezone } = ctx.profile;
  const today = nowIn(timezone).date;
  const overview = await inOrg(ctx, (tx) => stockOverview(tx, { timezone }));
  const n = new Intl.NumberFormat(locale);
  const base = `/o/${slug}/inventory`;
  const notPosted = overview.monthsNotPosted;
  const totals = overview.rows.reduce(
    (t, r) => ({
      expected: t.expected + r.expected,
      amazon: t.amazon + (r.amazon?.total ?? 0),
      noon: t.noon + (r.noon?.total ?? 0),
      atHand: t.atHand + (r.atHand?.quantity ?? 0),
      difference: t.difference + r.difference,
    }),
    { expected: 0, amazon: 0, noon: 0, atHand: 0, difference: 0 },
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Inventory"
        title="Stock"
        description="Every product in one place: what your books say you own, against what Amazon and Noon hold and what you counted at hand. A difference is stock the books have that nobody holds (or the other way round)."
      />

      <div className="grid gap-1 text-muted-foreground text-sm">
        <p>
          {overview.amazonAt
            ? `Amazon: its FBA inventory as of ${formatDate(overview.amazonAt.slice(0, 10), locale)} (Check Amazon for all SKUs on `
            : "Amazon: not brought in yet (Check Amazon for all SKUs on "}
          <Link
            href={`${base}/products`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Products
          </Link>
          ).
        </p>
        <p>
          {overview.noonDay
            ? `Noon: its FBN summary for ${formatDate(overview.noonDay, locale)} (`
            : "Noon: no FBN summary uploaded yet ("}
          <Link
            href={`${base}/movements`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Stock movements
          </Link>
          ).
        </p>
        {notPosted.length ? (
          <p>
            In the books takes off what sold in {notPosted.map((m) => MONTH(m, locale)).join(", ")},
            not posted to{" "}
            <Link href={`${base}/cogs`} className="text-primary underline-offset-4 hover:underline">
              cost of goods sold
            </Link>{" "}
            yet.
          </p>
        ) : null}
      </div>

      {overview.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Boxes className="size-6" />
          </span>
          <p className="font-medium">No stock yet</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            Record a delivery on a purchase order, or add opening stock, and it shows here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider lg:grid">
            <span>Product</span>
            <span className="text-end">In the books</span>
            <span className="text-end">Amazon</span>
            <span className="text-end">Noon</span>
            <span className="text-end">At hand</span>
            <span className="text-end">Difference</span>
          </div>
          <ul className="divide-y">
            {overview.rows.map((row, i) => (
              <li
                key={row.productId}
                className="fade-in-0 animate-in fill-mode-both"
                style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
              >
                <StockRow row={row} slug={slug} locale={locale} today={today} n={n} />
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t bg-muted/30 px-5 py-3 font-medium text-sm lg:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]">
            <span className="col-span-2 lg:col-span-1">All products</span>
            <Cell label="In the books" value={n.format(totals.expected)} />
            <Cell label="Amazon" value={n.format(totals.amazon)} />
            <Cell label="Noon" value={n.format(totals.noon)} />
            <Cell label="At hand" value={n.format(totals.atHand)} />
            <Cell label="Difference" value={signed(totals.difference, n)} />
          </div>
        </div>
      )}
    </div>
  );
}

function signed(value: number, n: Intl.NumberFormat) {
  return value > 0 ? `+${n.format(value)}` : n.format(value);
}

/** A number with its label on small screens (the header names it on large ones). */
function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2 lg:block lg:text-end">
      <span className="text-muted-foreground text-xs lg:hidden">{label}</span>
      <span className="text-end">
        <span className="tabular-nums">{value}</span>
        {hint ? <span className="block text-muted-foreground text-xs">{hint}</span> : null}
      </span>
    </span>
  );
}

function StockRow({
  row,
  slug,
  locale,
  today,
  n,
}: {
  row: StockOverviewRow;
  slug: string;
  locale: string;
  today: string;
  n: Intl.NumberFormat;
}) {
  const amazon = row.amazon;
  const amazonHint = amazon
    ? [
        amazon.reserved ? `${n.format(amazon.reserved)} reserved` : null,
        amazon.inbound ? `${n.format(amazon.inbound)} inbound` : null,
        amazon.unsellable ? `${n.format(amazon.unsellable)} unsellable` : null,
        amazon.researching ? `${n.format(amazon.researching)} being looked for` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const booksHint =
    row.notPosted !== 0
      ? `${n.format(row.inLots)} in lots, ${row.notPosted > 0 ? "less" : "plus"} ${n.format(Math.abs(row.notPosted))} not posted`
      : undefined;
  return (
    <div className="grid grid-cols-2 items-start gap-x-4 gap-y-1.5 px-5 py-3.5 text-sm lg:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]">
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <p className="truncate font-medium">{row.productName}</p>
        {row.productSku ? (
          <p className="truncate text-muted-foreground text-xs">Your SKU {row.productSku}</p>
        ) : null}
      </div>
      <Cell label="In the books" value={n.format(row.expected)} hint={booksHint} />
      <Cell
        label="Amazon"
        value={amazon ? n.format(amazon.total) : "—"}
        hint={amazon ? amazonHint || undefined : undefined}
      />
      <Cell
        label="Noon"
        value={row.noon ? n.format(row.noon.total) : "—"}
        hint={row.noon?.other ? `${n.format(row.noon.other)} not sellable` : undefined}
      />
      <span className="flex items-center justify-between gap-2 lg:justify-end">
        <span className="text-muted-foreground text-xs lg:hidden">At hand</span>
        <span className="flex items-center gap-1">
          {row.atHand ? (
            <span className="text-end">
              <span className="tabular-nums">{n.format(row.atHand.quantity)}</span>
              <span className="block text-muted-foreground text-xs">
                {formatDate(row.atHand.countedOn, locale)}
              </span>
            </span>
          ) : null}
          <StockCountDialog
            slug={slug}
            productId={row.productId}
            productName={row.productName}
            today={today}
            current={row.atHand?.quantity ?? null}
          />
          {row.atHand ? (
            <RemoveStockCount
              slug={slug}
              productId={row.productId}
              countId={row.atHand.id}
              label={`${row.productName} on ${formatDate(row.atHand.countedOn, locale)}`}
            />
          ) : null}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 lg:justify-end">
        <span className="text-muted-foreground text-xs lg:hidden">Difference</span>
        {row.difference === 0 ? (
          <Badge variant="success">Matches</Badge>
        ) : (
          <Badge
            variant={Math.abs(row.difference) <= 2 ? "outline" : "warning"}
            title={
              row.difference > 0
                ? "The books have more than Amazon, Noon and your count hold"
                : "Amazon, Noon and your count hold more than the books have"
            }
          >
            {signed(row.difference, n)}
          </Badge>
        )}
      </span>
    </div>
  );
}

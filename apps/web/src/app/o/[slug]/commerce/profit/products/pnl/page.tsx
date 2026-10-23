import { can } from "@bookalyze/core";
import { AlertTriangle, ArrowLeft, Check, FileUp, Megaphone, PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getCommerceContext } from "@/server/commerce";
import { fiscalConfigOf } from "@/server/org";
import { readChannelIds, skuProfitAndLoss } from "@/server/sku-pnl";
import { resolveRange } from "../../../../accounting/reports/periods";
import { RangeControls } from "../../../../accounting/reports/report-controls";
import { ActualShare, isNegative, pct, SkuPnlTable, Stat } from "./pnl-parts";

export const metadata: Metadata = { title: "Profit and loss by product" };

/**
 * Channel profit → By product → Profit and loss: every SKU's exact profit and loss for any
 * period, from the marketplaces' own rows, each amount marked when it's estimated. All channels,
 * or the ones ticked, in the main currency (each amount at its day's rate); one channel ticked
 * shows in its own currency. docs/ADS.md §6b.
 */
export default async function SkuPnlPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    from?: string;
    to?: string;
    channel?: string | string[];
    brands?: string;
  }>;
}) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const sp = await searchParams;
  const { locale, timezone, baseCurrency } = ctx.profile;
  const today = nowIn(timezone).date;
  const { from, to, presets } = resolveRange(sp, today, fiscalConfigOf(ctx.profile));
  const asked = readChannelIds(sp.channel);
  const allocateBrands = sp.brands === "shared";
  const data = await skuProfitAndLoss(ctx, { from, to, allocateBrands, channelIds: asked });
  // The ticked channels that have something in the period, in the list's order.
  const chosen = data.channels.filter((c) => asked.includes(c.channelId));
  const chosenIds = chosen.map((c) => c.channelId);
  const channel = chosen.length === 1 ? chosen[0] : undefined;
  const view = channel
    ? { rows: channel.rows, total: channel.total, currency: channel.currency }
    : { ...data.summary, currency: baseCurrency };

  const base = `/o/${slug}/commerce/profit/products/pnl`;
  const query = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams({ from, to });
    const merged = {
      channel: chosenIds.join(",") || null,
      brands: allocateBrands ? "shared" : null,
      ...extra,
    };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `?${q}`;
  };
  const csvHref = `/api/o/${slug}/commerce/sku-pnl${query({})}`;
  const shown = chosen.length ? chosen : data.channels;
  /** The selection with one channel ticked or unticked, in the list's order. */
  const toggled = (id: string) =>
    data.channels
      .map((c) => c.channelId)
      .filter((c) => (c === id ? !chosenIds.includes(id) : chosenIds.includes(c)))
      .join(",") || null;
  const missingDetail = shown.filter((c) => c.missingDetail > 0);
  const noAds = shown.filter((c) => !c.hasAds);
  const sold = (c: (typeof shown)[number]) => c.total.unitsSold > 0;
  const keep = shown.filter((c) => c.mode === "keep" && !c.feesUnknown && sold(c));
  const unknown = shown.filter((c) => c.feesUnknown && sold(c));
  // A switched-off or disconnected channel's settlements can't be brought in again.
  const refillable = missingDetail.filter((c) => c.isActive);
  const uploadOnly = missingDetail.filter((c) => !c.isActive);
  const { total } = view;

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/profit/products${query({ brands: null })}`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Profit by product
      </Link>
      <PageHeader
        eyebrow="Commerce"
        title="Profit and loss by product"
        description="What every product really made or lost in the period, line by line: sales, refunds, each marketplace fee, what the units cost you and their ads. Amounts the marketplace hasn't settled yet are estimated and marked ≈."
      />
      <RangeControls from={from} to={to} presets={presets} csvHref={csvHref} />

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {data.channels.length ? (
          <nav aria-label="Channels" className="flex flex-wrap gap-2">
            {[{ channelId: null, name: "All channels" }, ...data.channels].map((c) => {
              const active = c.channelId ? chosenIds.includes(c.channelId) : !chosenIds.length;
              return (
                <Link
                  key={c.channelId ?? "all"}
                  href={`${base}${query({ channel: c.channelId ? toggled(c.channelId) : null })}`}
                  role="checkbox"
                  aria-checked={active}
                  title={
                    c.channelId
                      ? active
                        ? `Leave ${c.name} out`
                        : `Add ${c.name}`
                      : "Every channel together"
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {c.channelId ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-3.5 items-center justify-center rounded-[4px] border",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/50",
                      )}
                    >
                      {active ? <Check className="size-2.5" strokeWidth={3} /> : null}
                    </span>
                  ) : null}
                  {c.name}
                </Link>
              );
            })}
          </nav>
        ) : (
          <span />
        )}
        <fieldset
          aria-label="Sponsored Brands"
          className="m-0 flex min-w-0 items-center gap-1 rounded-full border p-0.5 text-sm"
          title="Brand ads have no spend per product: keep them as their own line, or share them by each product's ad sales"
        >
          <span className="ps-2.5 pe-1 text-muted-foreground text-xs">Sponsored Brands</span>
          {[
            { key: null, label: "Own line" },
            { key: "shared", label: "Shared by ad sales" },
          ].map((o) => {
            const active = (o.key === "shared") === allocateBrands;
            return (
              <Link
                key={o.label}
                href={`${base}${query({ brands: o.key })}`}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "rounded-full px-2.5 py-0.5 transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </Link>
            );
          })}
        </fieldset>
      </div>

      {view.rows.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Profit"
              hint={`After the marketplace's fees, what the units cost and their ads, in ${view.currency}`}
              tone={isNegative(total.profit) ? "bad" : "good"}
              value={<Amount value={total.profit} currency={view.currency} locale={locale} />}
              sub={
                total.unitsSold === 0
                  ? "No sales in the period"
                  : total.margin === null
                    ? "Shows once products have a cost and their fees are known"
                    : `${pct(total.margin, locale)} of sales`
              }
            />
            <Stat
              label="Sales"
              hint="Item price buyers paid, less promotions"
              value={<Amount value={total.sales} currency={view.currency} locale={locale} />}
              sub={`${total.unitsSold.toLocaleString(locale)} units sold, ${total.unitsReturned.toLocaleString(locale)} returned`}
            />
            <Stat
              label="Ad spend"
              hint="From the ads reports (and the books' advertising where there are none)"
              value={
                <Amount
                  value={total.ads.replace(/^-/, "")}
                  currency={view.currency}
                  locale={locale}
                />
              }
              sub={total.tacos === null ? "No sales" : `TACOS ${pct(total.tacos, locale)}`}
            />
            <Stat
              label="Actual"
              hint="The share of the period's amounts that are the marketplaces' own; the rest is estimated"
              value={total.actualShare === null ? "—" : pct(total.actualShare, locale)}
              sub={<ActualShare share={total.actualShare} locale={locale} />}
            />
          </div>

          <section className="fade-in-0 grid animate-in overflow-hidden rounded-2xl border bg-card shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
              <h2 className="flex flex-wrap items-center gap-2 font-semibold">
                {chosen.length ? chosen.map((c) => c.name).join(" + ") : "All channels"}
                <span className="font-normal text-muted-foreground text-sm">{view.currency}</span>
                {channel && !channel.isActive ? (
                  <Badge variant="outline">Switched off</Badge>
                ) : null}
              </h2>
              <p className="text-muted-foreground text-xs">
                {channel
                  ? "In the channel's own currency."
                  : chosen.length
                    ? `These channels in ${baseCurrency}, each amount at its day's rate. Tick one alone for its own currency.`
                    : `Every channel in ${baseCurrency}, each amount at its day's rate. Tick one alone for its own currency.`}{" "}
                Worst first. Open a product for its waterfall.
              </p>
            </div>
            <SkuPnlTable
              rows={view.rows}
              total={total}
              currency={view.currency}
              locale={locale}
              hrefFor={(sku) => `${base}/${encodeURIComponent(sku)}${query({ channel: null })}`}
            />
          </section>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <PackageSearch className="size-6" />
          </span>
          <p className="font-medium">No sales in this period</p>
          <p className="max-w-md text-muted-foreground text-sm">
            Choose another period. Products show here once their orders come in.
          </p>
        </div>
      )}

      {missingDetail.length || noAds.length || keep.length || unknown.length || data.unconverted ? (
        <div className="grid gap-2 rounded-2xl border bg-muted/20 px-5 py-4 text-sm">
          {missingDetail.length ? (
            <p className="flex gap-2">
              <FileUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                {missingDetail
                  .map(
                    (c) =>
                      `${c.name}: ${c.missingDetail} ${c.missingDetail === 1 ? "settlement" : "settlements"}`,
                  )
                  .join(", ")}{" "}
                in this period came in before Bookalyze kept settlements by product, so their
                orders' fees are estimated.{" "}
                {refillable.length ? (
                  <>
                    On{" "}
                    <Link href={`/o/${slug}/commerce/settlements`} className="underline">
                      Settlements
                    </Link>
                    , Bring in settlements fills the ones Amazon still lists (about 90 days); for
                    older ones, upload their flat files again.{" "}
                  </>
                ) : null}
                {uploadOnly.length ? (
                  <>
                    {uploadOnly.map((c) => c.name).join(", ")}{" "}
                    {uploadOnly.length === 1 ? "is" : "are"} switched off or disconnected, so
                    {uploadOnly.length === 1 ? " its" : " their"} settlements can only be filled by
                    uploading their flat files (Seller Central → Payments → All statements → “Flat
                    File V2”).{" "}
                  </>
                ) : null}
                Nothing in your books changes.
              </span>
            </p>
          ) : null}
          {unknown.length ? (
            <p className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                {unknown.map((c) => c.name).join(", ")}: no settlements or transactions to learn the
                marketplace's fees from, in this period or the 90 days before
                {unknown.some((c) => !c.isActive)
                  ? " (a switched-off channel's settlements aren't counted)"
                  : ""}
                , so {unknown.length === 1 ? "its" : "their"} products' fees and profit show as —.
              </span>
            </p>
          ) : null}
          {keep.length ? (
            <p className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                {keep.map((c) => c.name).join(", ")}: nothing settled by product in this period, so
                fees come from the share of sales the marketplace leaves (the keep rate).
              </span>
            </p>
          ) : null}
          {noAds.length ? (
            <p className="flex gap-2">
              <Megaphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                Ad cost isn't connected yet for {noAds.map((c) => c.name).join(", ")}
                {noAds.some((c) => c.kind === "amazon")
                  ? ": connect Amazon Ads on the Amazon channel's page to see each product's ad spend"
                  : ""}
                . Advertising in their settlements shows as its own line, not split by product.
              </span>
            </p>
          ) : null}
          {data.unconverted ? (
            <p className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                {data.unconverted} {data.unconverted === 1 ? "amount is" : "amounts are"} left out
                of the {baseCurrency} figures: there's no exchange rate for their day yet.
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 text-muted-foreground text-xs">
        <p>
          <strong className="font-medium text-foreground">How it's worked out.</strong> A product's
          period is its order lines bought in it (cancelled orders left out), and every amount on
          those orders counts there, even a refund or fee settled later. Fees, refunds and
          promotions come from the marketplaces' own rows: Amazon's settlements by SKU and order,
          Noon's transactions, Walmart's settlement reports and eBay's finances (shared over an
          order's products by item price). Orders not settled yet are estimated at the fee rates the
          product's settled orders show. Storage, the selling plan and other fees on no product are
          shared by units. Cost of goods is the cost posted for the month, else the next unit's
          landed cost. Ads come from the ads reports by day; the last 14 days are estimated, because
          the marketplace can still give them sales.
        </p>
      </div>
    </div>
  );
}

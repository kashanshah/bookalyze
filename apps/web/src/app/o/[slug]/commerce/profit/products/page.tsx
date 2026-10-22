import {
  AD_TYPE_LABELS,
  can,
  formatDecimal,
  formatMoney,
  parseDecimal,
  SKU_KEEP_MIN_UNITS,
} from "@bookalyze/core";
import {
  AlertTriangle,
  ArrowLeft,
  CircleDollarSign,
  ListTree,
  Megaphone,
  PackageSearch,
  TrendingDown,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getCommerceContext } from "@/server/commerce";
import { fiscalConfigOf } from "@/server/org";
import { productProfit } from "@/server/product-profit";
import { resolveRange } from "../../../accounting/reports/periods";
import { RangeControls } from "../../../accounting/reports/report-controls";
import { ProductTable } from "./product-table";

export const metadata: Metadata = { title: "Profit by product" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Channel profit → By product: each product's real profit after the marketplace's fees, its cost
 * and its ads, per channel; the products losing money first. docs/ADS.md §6.
 */
export default async function ProductProfitPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; channel?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const sp = await searchParams;
  const { locale, timezone, baseCurrency } = ctx.profile;
  const today = nowIn(timezone).date;
  const { from, to, presets } = resolveRange(sp, today, fiscalConfigOf(ctx.profile));
  const channelId = sp.channel && UUID.test(sp.channel) ? sp.channel : null;
  const everything = await productProfit(ctx, { from, to });
  const shown = channelId
    ? everything.channels.filter((c) => c.channelId === channelId)
    : everything.channels;
  const { all } = everything;
  const base = `/o/${slug}/commerce/profit/products`;
  const query = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams({ from, to });
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return `?${q}`;
  };
  const csvHref = `/api/o/${slug}/commerce/product-profit${query({ channel: channelId })}`;
  const anyAds = everything.channels.some((c) => c.hasAds);
  const negative = (v: string | null) => v !== null && parseDecimal(v) < 0n;

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/profit${query({})}`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Channel profit
      </Link>
      <PageHeader
        eyebrow="Commerce"
        title="Profit by product"
        description="Each product's real profit after the marketplace's fees, what it cost you and its ads. The products losing money come first, with how much each can spend on ads before it stops paying."
        actions={
          <Button asChild variant="outline">
            <Link href={`${base}/pnl${query({ channel: channelId })}`}>
              <ListTree />
              Profit and loss, line by line
            </Link>
          </Button>
        }
      />
      <RangeControls from={from} to={to} presets={presets} csvHref={csvHref} />

      {everything.channels.length > 1 ? (
        <nav aria-label="Channels" className="flex flex-wrap gap-2 print:hidden">
          {[{ channelId: null, name: "All channels" }, ...everything.channels].map((c) => {
            const active = (c.channelId ?? null) === channelId;
            return (
              <Link
                key={c.channelId ?? "all"}
                href={`${base}${query({ channel: c.channelId })}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {c.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {everything.channels.length ? (
        <>
          {!channelId ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                icon={<CircleDollarSign />}
                label="Profit after ads"
                hint={`All channels, in ${baseCurrency}, for the products with a cost`}
                tone={negative(all.profitAfterAds) ? "bad" : "good"}
                value={
                  <Amount value={all.profitAfterAds} currency={baseCurrency} locale={locale} />
                }
                sub={
                  <>
                    on <Amount value={all.sales} currency={baseCurrency} locale={locale} /> of sales
                  </>
                }
              />
              <Stat
                icon={<Megaphone />}
                label="Ad spend"
                hint="TACOS: ad spend over all sales. Under 10% is light; over 20% means sales lean hard on ads"
                value={<Amount value={all.adSpend} currency={baseCurrency} locale={locale} />}
                sub={
                  all.tacos === null
                    ? "No sales yet"
                    : `TACOS ${all.tacos.toLocaleString(locale, { maximumFractionDigits: 1 })}%`
                }
              />
              <Stat
                icon={<TrendingDown />}
                label="Products losing money"
                hint="After their ads, in the period"
                tone={all.losing ? "bad" : "good"}
                value={all.losing.toLocaleString(locale)}
                sub={
                  all.losing ? (
                    <>
                      They lost <Amount value={all.lost} currency={baseCurrency} locale={locale} />
                    </>
                  ) : (
                    "None in this period"
                  )
                }
              />
              <Stat
                icon={<PackageSearch />}
                label="Ads with no sales"
                hint="Spent on products whose ads sold nothing in the period"
                tone={parseDecimal(all.wasted) > 0n ? "warn" : "good"}
                value={<Amount value={all.wasted} currency={baseCurrency} locale={locale} />}
                sub={
                  all.costMissing
                    ? `${all.costMissing} ${all.costMissing === 1 ? "product has" : "products have"} no cost yet`
                    : "Every product has a cost"
                }
              />
            </div>
          ) : null}

          {shown.map((c) => (
            <section
              key={c.channelId}
              aria-labelledby={`channel-${c.channelId}`}
              className="fade-in-0 grid animate-in overflow-hidden rounded-2xl border bg-card shadow-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                <div className="min-w-0">
                  <h2
                    id={`channel-${c.channelId}`}
                    className="flex flex-wrap items-center gap-2 font-semibold"
                  >
                    {c.name}
                    <span className="font-normal text-muted-foreground text-sm">{c.currency}</span>
                    {!c.isActive ? <Badge variant="outline">Switched off</Badge> : null}
                    {c.summary.losing ? (
                      <Badge variant="destructive">{c.summary.losing} losing money</Badge>
                    ) : null}
                  </h2>
                  <p className="max-w-prose text-muted-foreground text-xs leading-relaxed">
                    {c.keepRate === null
                      ? "No sales in its settlements or transactions to learn the marketplace's fees from, in this period or the 90 days before its end: profit shows once some are in."
                      : `${c.ownRates ? `Products with ${SKU_KEEP_MIN_UNITS} or more settled units use what the marketplace left on their own orders; the rest use ` : "The marketplace left "}${keepPercent(c.keepRate, locale)} of each sale on its orders before ads${c.keepRateFrom === "trailing" ? " over the last 90 days (none in this period yet)" : " in this period"}: referral and fulfilment fees, refunds and the rest.`}{" "}
                    {c.keepRate !== null && parseDecimal(c.accountCosts.amount) !== 0n
                      ? "Storage, the selling plan and other costs on no order are their own line, not shared by sales."
                      : ""}{" "}
                    {c.settledThrough && parseDecimal(c.unsettledSales) > 0n
                      ? `Settled through ${formatDate(c.settledThrough, locale)}: ${formatMoney(c.unsettledSales, c.currency, locale)} of sales after that are estimated at the same rates.`
                      : ""}{" "}
                    {c.hasAds
                      ? c.adsThrough
                        ? `Ads in through ${formatDate(c.adsThrough, locale)}.`
                        : c.adsPending
                          ? "The first ads reports are being made."
                          : ""
                      : c.kind === "amazon"
                        ? "Connect Amazon Ads on its channel page to see each product's ad spend."
                        : "Ad spend for this marketplace isn't brought in yet: its advertising in your books is shown below, not split by product."}
                  </p>
                </div>
                {c.summary.profitAfterAds !== null ? (
                  <div className="text-end">
                    <p className="text-muted-foreground text-xs">Profit after ads</p>
                    <p
                      className={cn(
                        "font-semibold text-lg",
                        negative(c.summary.profitAfterAds) ? "text-destructive" : "text-success",
                      )}
                    >
                      <Amount
                        value={c.summary.profitAfterAds}
                        currency={c.currency}
                        locale={locale}
                      />
                    </p>
                  </div>
                ) : null}
              </div>
              <ProductTable
                rows={c.rows}
                currency={c.currency}
                locale={locale}
                unallocated={c.unallocated}
                accountCosts={c.accountCosts}
                unallocatedLabel={
                  c.hasAds
                    ? {
                        title: "Sponsored Brands",
                        hint: "Not tied to one product: counted in the total, not in any product",
                      }
                    : {
                        title: "Advertising in your books",
                        hint: "No ads reports for this marketplace yet, so it isn't split by product",
                      }
                }
                footer={{
                  sales: c.summary.sales,
                  units: c.summary.units,
                  adSpend: c.summary.adSpend,
                  tacos: c.summary.tacos,
                  acos: c.summary.acos,
                  profitBeforeAds: c.summary.profitBeforeAds,
                  profitAfterAds: c.summary.profitAfterAds,
                }}
              />
              <Reconcile
                currency={c.currency}
                locale={locale}
                books={c.booksAdvertising}
                reports={c.summary.adSpend}
                hasAds={c.hasAds}
                byType={c.byType.map((t) => ({ label: AD_TYPE_LABELS[t.adType], spend: t.spend }))}
              />
            </section>
          ))}
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <PackageSearch className="size-6" />
          </span>
          <p className="font-medium">No sales or ads in this period</p>
          <p className="max-w-md text-muted-foreground text-sm">
            Choose another period. Products show here once their orders come in
            {anyAds
              ? ""
              : ", and their ad spend once Amazon Ads is connected on an Amazon channel's page"}
            .
          </p>
        </div>
      )}

      <div className="grid gap-2 text-muted-foreground text-xs">
        <p>
          <strong className="font-medium text-foreground">How it's worked out.</strong> Sales are
          each product's order lines bought in the period (cancelled orders left out), less
          promotions. What the marketplace leaves before ads comes from the amounts on orders in its
          settlements and transactions in the period (referral and fulfilment fees, refunds and the
          rest, with the advertising taken out): a product with {SKU_KEEP_MIN_UNITS} or more units
          in Amazon's settlements uses its own orders' share, the others the channel's. Orders not
          settled yet are estimated at that share. Storage, the selling plan, inbound placement,
          Vine and other costs on no order don't grow with each unit sold, so they're their own
          line, in full, rather than shared by sales. Product cost is the units sold × the next
          unit's landed cost (bundles add up their products). Ad spend is each day's spend from the
          ads reports, so ads count once: from the reports, never also from the settlements.
        </p>
        <p>
          <strong className="font-medium text-foreground">Break-even ACOS</strong> is profit before
          ads over sales: an ACOS above it means each sale from ads loses money.{" "}
          <strong className="font-medium text-foreground">TACOS</strong> is ad spend over all sales.
          Amazon counts a sale as from an ad up to 7 days after the click (14 for Sponsored Brands),
          so ads late in a period can claim sales from the next. Sponsored Brands has no spend per
          product, so it's its own line.
        </p>
        {all.unconverted.length ? (
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            {all.unconverted.join(", ")} {all.unconverted.length === 1 ? "isn't" : "aren't"} in the{" "}
            {baseCurrency} summary: there's no exchange rate for {formatDate(to, locale)} yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function keepPercent(rate: string, locale: string) {
  const value = Number(formatDecimal(parseDecimal(rate, 10) / 10n ** 6n, 4)) * 100;
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

function Stat({
  icon,
  label,
  hint,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div
      className="fade-in-0 grid animate-in gap-1 rounded-2xl border bg-card px-5 py-4 shadow-xs"
      title={hint}
    >
      <p className="flex items-center gap-2 text-muted-foreground text-sm [&_svg]:size-4">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "font-semibold text-2xl",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-foreground",
          tone === "warn" && "text-[oklch(0.5_0.12_70)] dark:text-warning",
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground text-xs">{sub}</p>
    </div>
  );
}

/** The books' advertising next to the ads reports', and why they differ. */
function Reconcile({
  currency,
  locale,
  books,
  reports,
  hasAds,
  byType,
}: {
  currency: string;
  locale: string;
  books: string;
  reports: string;
  hasAds: boolean;
  byType: { label: string; spend: string }[];
}) {
  const difference = formatDecimal(parseDecimal(reports) - parseDecimal(books));
  if (!hasAds && parseDecimal(books) === 0n) return null;
  return (
    <div className="grid gap-1 border-t bg-muted/20 px-5 py-3 text-xs">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          Advertising in your books:{" "}
          <Amount value={books} currency={currency} locale={locale} className="font-medium" />
        </span>
        {hasAds ? (
          <>
            <span>
              In the ads reports:{" "}
              <Amount value={reports} currency={currency} locale={locale} className="font-medium" />
              {byType.length > 1
                ? ` (${byType.map((t) => `${t.label} ${formatMoney(t.spend, currency, locale)}`).join(", ")})`
                : ""}
            </span>
            <span>
              Difference:{" "}
              <Amount
                value={difference}
                currency={currency}
                locale={locale}
                className="font-medium"
              />
            </span>
          </>
        ) : null}
      </p>
      <p className="text-muted-foreground">
        {hasAds
          ? "They rarely match day for day: Amazon charges ads when a threshold is reached or monthly, and ads paid by card aren't in settlements at all (count that card's advertising category against this channel in Your own costs). Profit here uses the reports' daily spend."
          : "Without ads reports, this advertising isn't split by product, and the products' profit after ads above doesn't take it off. Channel profit counts it in full."}
      </p>
    </div>
  );
}

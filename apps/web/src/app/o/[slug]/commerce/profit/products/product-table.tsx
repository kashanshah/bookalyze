"use client";

import {
  type AccountCosts,
  AD_VERDICT_LABELS,
  type AdVerdict,
  formatDecimal,
  formatMoney,
  type GiveawayCosts,
  type KeepRateSource,
  parseDecimal,
  type SkuProfit,
} from "@bookalyze/core";
import { ChevronDown } from "lucide-react";
import { Fragment, useState } from "react";
import { Amount } from "@/components/accounting/amount";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const KEEP_SOURCE: Record<KeepRateSource, string> = {
  sku: "its own orders",
  estimate: "Amazon's fee estimate",
  period: "the channel's orders",
  trailing: "the channel's last 90 days",
};

const TONE: Record<AdVerdict, "destructive" | "warning" | "success" | "outline"> = {
  losing: "destructive",
  ads_eat_profit: "destructive",
  ads_no_sales: "warning",
  ads_above_break_even: "warning",
  cost_missing: "outline",
  healthy: "success",
  no_activity: "outline",
};

export function VerdictBadge({ verdict }: { verdict: AdVerdict }) {
  const v = AD_VERDICT_LABELS[verdict];
  return (
    <Badge variant={TONE[verdict]} className="font-normal" title={v.hint}>
      {v.label}
    </Badge>
  );
}

/**
 * One channel's products: the figures that matter in the row, the rest a click away. Rows come
 * worst first (losing money, then ads problems), so what needs fixing is at the top.
 */
export function ProductTable({
  rows,
  currency,
  locale,
  unallocated,
  accountCosts,
  giveaways,
  unallocatedLabel,
  footer,
}: {
  rows: SkuProfit[];
  currency: string;
  locale: string;
  unallocated: { spend: string; sales: string };
  /** Storage, the selling plan and other costs on no order: their own line. */
  accountCosts: AccountCosts;
  /** Units given away (Vine, 100% off): their cost and the marketplace's fees, their own line. */
  giveaways: GiveawayCosts;
  /** What the spend tied to no product is: Sponsored Brands, or the books' ads. */
  unallocatedLabel: { title: string; hint: string };
  footer: {
    sales: string;
    units: number;
    adSpend: string;
    tacos: number | null;
    acos: number | null;
    profitBeforeAds: string | null;
    profitAfterAds: string | null;
  };
}) {
  const [open, setOpen] = useState<string | null>(null);
  const pct = (v: number | null) =>
    v === null ? "—" : `${v.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
  /** A product that loses money before ads can't afford any: its break-even is below zero. */
  const breakEven = (v: number | null) => (v !== null && v <= 0 ? "no room for ads" : pct(v));
  const money = (v: string | null, className?: string) => (
    <Amount value={v} currency={currency} locale={locale} className={className} />
  );
  const negative = (v: string | null) => Boolean(v?.startsWith("-"));
  const hasUnallocated = !/^0(\.0+)?$/.test(unallocated.spend);
  const hasAccountCosts = parseDecimal(accountCosts.amount) !== 0n;
  const keep = (r: SkuProfit) => {
    if (r.keepRate === null) return "—";
    const value = Number(formatDecimal(parseDecimal(r.keepRate, 10) / 10n ** 6n, 4)) * 100;
    const share = `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
    return r.keepRateSource ? `${share} · ${KEEP_SOURCE[r.keepRateSource]}` : share;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
            <th className="px-4 py-3 text-start font-medium">Product</th>
            <th className="px-3 py-3 text-end font-medium">Units</th>
            <th className="px-3 py-3 text-end font-medium">Sales</th>
            <th
              className="px-3 py-3 text-end font-medium"
              title="What's left after the marketplace's fees and the product's cost, before ads"
            >
              Profit before ads
            </th>
            <th className="px-3 py-3 text-end font-medium">Ad spend</th>
            <th
              className="px-3 py-3 text-end font-medium"
              title="ACOS: ad spend over the sales the ads brought. Break-even: the most ACOS can be before each ad sale loses money"
            >
              ACOS / break-even
            </th>
            <th
              className="px-3 py-3 text-end font-medium"
              title="TACOS: ad spend over all the product's sales, from ads or not"
            >
              TACOS
            </th>
            <th className="px-3 py-3 text-end font-medium">Profit after ads</th>
            <th className="w-10 px-2 py-3">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expanded = open === r.sku;
            const over = r.acos !== null && r.breakEvenAcos !== null && r.acos > r.breakEvenAcos;
            return (
              <Fragment key={r.sku}>
                <tr
                  className={cn(
                    "cursor-pointer border-b transition-colors hover:bg-muted/30",
                    expanded && "bg-muted/20",
                  )}
                  onClick={() => setOpen(expanded ? null : r.sku)}
                >
                  <td className="max-w-[18rem] px-4 py-2.5">
                    <span className="block truncate font-medium" title={r.label ?? r.sku}>
                      {r.label ?? r.sku}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                      <span className="truncate">{r.sku}</span>
                      <VerdictBadge verdict={r.verdict} />
                    </span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-end">{r.units.toLocaleString(locale)}</td>
                  <td className="px-3 py-2.5 text-end">{money(r.sales)}</td>
                  <td className="px-3 py-2.5 text-end">
                    {money(
                      r.profitBeforeAds,
                      negative(r.profitBeforeAds) ? "text-destructive" : "",
                    )}
                    {r.profitBeforeAdsPerUnit !== null ? (
                      <span className="block text-muted-foreground text-xs">
                        {money(r.profitBeforeAdsPerUnit)} each
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-end">{money(r.adSpend)}</td>
                  <td className={cn("tabular px-3 py-2.5 text-end", over && "text-destructive")}>
                    {pct(r.acos)}
                    <span className="block text-muted-foreground text-xs">
                      of {breakEven(r.breakEvenAcos)}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-end">{pct(r.tacos)}</td>
                  <td className="px-3 py-2.5 text-end font-medium">
                    {money(
                      r.profitAfterAds,
                      negative(r.profitAfterAds) ? "text-destructive" : "text-success",
                    )}
                    {r.profitAfterAdsPerUnit !== null ? (
                      <span className="block font-normal text-muted-foreground text-xs">
                        {money(r.profitAfterAdsPerUnit)} each · {pct(r.marginAfterAds)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Hide" : "Show"} details for ${r.sku}`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(expanded ? null : r.sku);
                      }}
                    >
                      <ChevronDown
                        className={cn("size-4 transition-transform", expanded && "rotate-180")}
                      />
                    </button>
                  </td>
                </tr>
                {expanded ? (
                  <tr className="border-b bg-muted/10">
                    <td colSpan={9} className="px-4 py-4">
                      <div className="fade-in-0 grid animate-in gap-4 sm:grid-cols-3">
                        <Detail
                          title="Where the money went"
                          items={[
                            ["Sales", money(r.sales)],
                            ["Average price", money(r.averagePrice)],
                            ["Marketplace leaves", keep(r)],
                            ["Left after the marketplace", money(r.netBeforeAds)],
                            ["Product cost", money(r.productCost)],
                            ["Profit before ads", money(r.profitBeforeAds)],
                            ["Ads", money(r.adSpend)],
                            ["Profit after ads", money(r.profitAfterAds)],
                          ]}
                        />
                        <Detail
                          title="What the ads did"
                          items={[
                            ["Sales from ads", money(r.adSales)],
                            ["Orders from ads", r.adOrders.toLocaleString(locale)],
                            [
                              "Return on ad spend",
                              r.roas === null ? "—" : `${r.roas.toLocaleString(locale)}×`,
                            ],
                            ["Sales without ads", pct(r.organicShare)],
                            ["Clicks", r.clicks.toLocaleString(locale)],
                            ["Impressions", r.impressions.toLocaleString(locale)],
                          ]}
                        />
                        <Detail
                          title="How far ads can go"
                          items={[
                            ["ACOS", pct(r.acos)],
                            ["Break-even ACOS", breakEven(r.breakEvenAcos)],
                            ["Cost per click", money(r.cpc)],
                            ["Break-even cost per click", money(r.breakEvenCpc)],
                            ["Clicks that buy", pct(r.conversion)],
                          ]}
                        />
                      </div>
                      <p className="mt-3 max-w-prose text-muted-foreground text-xs">
                        {AD_VERDICT_LABELS[r.verdict].hint}
                      </p>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {hasUnallocated ? (
            <tr className="border-b">
              <td className="px-4 py-2.5">
                <span className="block font-medium">{unallocatedLabel.title}</span>
                <span className="text-muted-foreground text-xs">{unallocatedLabel.hint}</span>
              </td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-end">{money(unallocated.spend)}</td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-end">
                {money(`-${unallocated.spend}`, "text-destructive")}
              </td>
              <td />
            </tr>
          ) : null}
          {hasAccountCosts ? (
            <tr className="border-b">
              <td className="px-4 py-2.5">
                <span className="block font-medium">Storage, selling plan and account costs</span>
                <span className="text-muted-foreground text-xs">
                  On no order, so not shared by sales:{" "}
                  {accountCosts.items
                    .slice(0, 4)
                    .map((i) => `${i.label} ${formatMoney(i.amount, currency, locale)}`)
                    .join(", ")}
                  {accountCosts.items.length > 4 ? ", and more" : ""}
                </span>
              </td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-end">
                {money(
                  formatDecimal(-parseDecimal(accountCosts.amount)),
                  parseDecimal(accountCosts.amount) > 0n ? "text-destructive" : "text-success",
                )}
              </td>
              <td />
            </tr>
          ) : null}
          {giveaways.units > 0 ? (
            <tr className="border-b">
              <td className="px-4 py-2.5">
                <span className="block font-medium">Units given away</span>
                <span className="text-muted-foreground text-xs">
                  Vine and other 100%-off orders: their cost{" "}
                  {formatMoney(giveaways.productCost, currency, locale)} and the marketplace's fees{" "}
                  {formatMoney(giveaways.fees, currency, locale)}
                  {giveaways.feesUnknown ? " (some not settled yet)" : ""}
                  {giveaways.costMissing ? `; ${giveaways.costMissing} with no cost yet` : ""}
                </span>
              </td>
              <td className="tabular px-3 py-2.5 text-end">
                {giveaways.units.toLocaleString(locale)}
              </td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-end">
                {money(formatDecimal(-parseDecimal(giveaways.amount)), "text-destructive")}
              </td>
              <td />
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr className="bg-primary/5 font-semibold">
            <th scope="row" className="px-4 py-3 text-start">
              Total
            </th>
            <td className="tabular px-3 py-3 text-end">{footer.units.toLocaleString(locale)}</td>
            <td className="px-3 py-3 text-end">{money(footer.sales)}</td>
            <td className="px-3 py-3 text-end">{money(footer.profitBeforeAds)}</td>
            <td className="px-3 py-3 text-end">{money(footer.adSpend)}</td>
            <td className="tabular px-3 py-3 text-end">{pct(footer.acos)}</td>
            <td className="tabular px-3 py-3 text-end">{pct(footer.tacos)}</td>
            <td className="px-3 py-3 text-end">
              {money(
                footer.profitAfterAds,
                negative(footer.profitAfterAds) ? "text-destructive" : "text-success",
              )}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Detail({ title, items }: { title: string; items: [string, React.ReactNode][] }) {
  return (
    <div className="grid gap-1.5 text-sm">
      <p className="mb-0.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </p>
      <dl className="grid gap-1.5">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular text-end">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

import { formatDecimal, parseDecimal, SKU_PNL_LINES, type SkuPnl } from "@bookalyze/core";

const ALL_LINES = [...SKU_PNL_LINES];

import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { cn } from "@/lib/utils";

/** Shared pieces of the SKU profit and loss pages (docs/ADS.md §6b). */

export const pct = (v: number | null, locale: string) =>
  v === null ? "—" : `${v.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;

export const isNegative = (v: string | null) => v !== null && parseDecimal(v) < 0n;

/** "≈" beside an amount whose `estimated` part isn't zero, with what it means. */
export function Estimated({ estimated }: { estimated: string | null | undefined }) {
  if (!estimated || parseDecimal(estimated) === 0n) return null;
  return (
    <abbr
      title="Estimated: not settled by the marketplace yet, shared out, or still changing"
      className="ms-1 text-[oklch(0.5_0.12_70)] no-underline dark:text-warning"
    >
      ≈
    </abbr>
  );
}

/** How much of a period's amounts are actual: a thin bar and the percent. */
export function ActualShare({
  share,
  locale,
  className,
}: {
  share: number | null;
  locale: string;
  className?: string;
}) {
  if (share === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className="h-1.5 w-12 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${pct(share, locale)} actual`}
      >
        <span
          className="block h-full rounded-full bg-success"
          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
        />
      </span>
      <span className="tabular text-xs">{pct(share, locale)}</span>
    </span>
  );
}

export function Stat({
  label,
  hint,
  value,
  sub,
  tone,
}: {
  label: string;
  hint: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  tone?: "good" | "bad";
}) {
  return (
    <div
      className="fade-in-0 grid animate-in gap-1 rounded-2xl border bg-card px-5 py-4 shadow-xs"
      title={hint}
    >
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className={cn("font-semibold text-2xl", tone === "bad" && "text-destructive")}>{value}</p>
      <p className="text-muted-foreground text-xs">{sub}</p>
    </div>
  );
}

/** Every SKU's row: the figures that matter, each SKU opening its own page. */
export function SkuPnlTable({
  rows,
  total,
  currency,
  locale,
  hrefFor,
}: {
  rows: SkuPnl[];
  total: SkuPnl;
  currency: string;
  locale: string;
  hrefFor: (sku: string) => string;
}) {
  /** An amount, and ≈ when part of it is estimated. */
  const money = (amount: string | null, estimated?: string) => (
    <>
      <Amount value={amount} currency={currency} locale={locale} />
      {amount === null ? null : <Estimated estimated={estimated} />}
    </>
  );
  const cell = "px-3 py-2.5 text-end";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
            <th className="min-w-56 px-4 py-3 text-start font-medium">Product</th>
            <th className="px-3 py-3 text-end font-medium" title="Units sold, and returned">
              Units
            </th>
            <th className="px-3 py-3 text-end font-medium" title="Item price less promotions">
              Sales
            </th>
            <th
              className="px-3 py-3 text-end font-medium"
              title="Refunds, the marketplace's fees, shipping buyers paid, storage and reimbursements: everything between sales and what the marketplace pays you"
            >
              Fees and refunds
            </th>
            <th className="px-3 py-3 text-end font-medium">Cost of goods</th>
            <th className="px-3 py-3 text-end font-medium">Ads</th>
            <th className="px-3 py-3 text-end font-medium">Profit</th>
            <th className="px-3 py-3 text-end font-medium">Margin</th>
            <th className="px-3 py-3 text-end font-medium">Per unit</th>
            <th className="px-3 py-3 text-end font-medium" title="Ad spend over sales">
              TACOS
            </th>
            <th
              className="px-4 py-3 text-end font-medium"
              title="The share of its amounts that are the marketplace's own, not estimated"
            >
              Actual
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const marketplace = {
              amount: feesAndRefunds(r),
              estimated: sumEstimated(r, [
                "refunds",
                "referral",
                "fulfilment",
                "otherFees",
                "marketplaceEstimate",
                "reimbursements",
                "other",
                "accountFees",
                "shipping",
              ]),
            };
            const ads = {
              amount: r.ads,
              estimated: sumEstimated(r, ["ads", "sponsoredBrands", "booksAdvertising"]),
            };
            return (
              <tr key={r.sku || "none"} className="border-b last:border-b-0 hover:bg-muted/20">
                <td className="min-w-56 max-w-80 px-4 py-2.5">
                  {r.sku ? (
                    <Link
                      href={hrefFor(r.sku)}
                      className="group grid min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="truncate font-medium group-hover:underline">
                        {r.label ?? r.sku}
                      </span>
                      <span className="truncate text-muted-foreground text-xs">
                        {r.label ? r.sku : "Not linked to a product"}
                        {r.costMissing ? " · cost missing" : ""}
                      </span>
                    </Link>
                  ) : (
                    <span className="grid">
                      <span className="font-medium">Not tied to one product</span>
                      <span className="text-muted-foreground text-xs">
                        Sponsored Brands, or advertising in your books
                      </span>
                    </span>
                  )}
                </td>
                <td className={cell}>
                  <span className="tabular">{r.unitsSold.toLocaleString(locale)}</span>
                  {r.unitsReturned ? (
                    <span className="block text-muted-foreground text-xs">
                      {r.unitsReturned.toLocaleString(locale)} back
                    </span>
                  ) : null}
                </td>
                <td className={cell}>
                  {money(r.sales, sumEstimated(r, ["grossSales", "promotions"]))}
                </td>
                <td className={cell} title={r.feesUnknown ? "No fees to go by yet" : undefined}>
                  {money(r.feesUnknown ? null : marketplace.amount, marketplace.estimated)}
                </td>
                <td className={cell}>{money(r.lines.cogs.amount, r.lines.cogs.estimated)}</td>
                <td className={cell}>{money(ads.amount, ads.estimated)}</td>
                <td
                  className={cn(
                    cell,
                    "font-medium",
                    isNegative(r.profit) ? "text-destructive" : r.profit ? "text-success" : "",
                  )}
                >
                  {money(r.profit, sumEstimated(r, ALL_LINES))}
                </td>
                <td className={cell}>{pct(r.margin, locale)}</td>
                <td className={cell}>{money(r.profitPerUnit, sumEstimated(r, ALL_LINES))}</td>
                <td className={cell}>{pct(r.tacos, locale)}</td>
                <td className="px-4 py-2.5 text-end">
                  <ActualShare share={r.actualShare} locale={locale} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 font-medium">
            <td className="px-4 py-3">Total</td>
            <td className={cell}>
              <span className="tabular">{total.unitsSold.toLocaleString(locale)}</span>
            </td>
            <td className={cell}>{money(total.sales)}</td>
            <td className={cell}>
              {/* No product's fees known (a channel with nothing to go by): not 0.00. */}
              {money(rows.some((r) => r.sku && !r.feesUnknown) ? feesAndRefunds(total) : null)}
            </td>
            <td className={cell}>{money(total.cogs)}</td>
            <td className={cell}>{money(total.ads)}</td>
            <td className={cn(cell, isNegative(total.profit) && "text-destructive")}>
              {money(total.profit, sumEstimated(total, ALL_LINES))}
            </td>
            <td className={cell}>{pct(total.margin, locale)}</td>
            <td className={cell}>{money(total.profitPerUnit)}</td>
            <td className={cell}>{pct(total.tacos, locale)}</td>
            <td className="px-4 py-3 text-end">
              <ActualShare share={total.actualShare} locale={locale} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Everything between sales and profit before cost of goods and ads, so the columns add up. */
export function feesAndRefunds(r: SkuPnl): string {
  return formatDecimal(
    parseDecimal(r.revenue) - parseDecimal(r.sales) + parseDecimal(r.marketplace),
  );
}

function sumEstimated(r: SkuPnl, keys: (keyof SkuPnl["lines"])[]): string {
  const units = keys.reduce((t, k) => t + parseDecimal(r.lines[k].estimated), 0n);
  return formatDecimal(units);
}

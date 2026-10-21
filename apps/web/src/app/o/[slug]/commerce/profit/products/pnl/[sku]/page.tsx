import {
  can,
  parseDecimal,
  SKU_PNL_LABELS,
  SKU_PNL_LINES,
  type SkuPnl,
  skuWaterfall,
} from "@bookalyze/core";
import { ArrowLeft } from "lucide-react";
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
import { skuProfitAndLoss } from "@/server/sku-pnl";
import { resolveRange } from "../../../../../accounting/reports/periods";
import { RangeControls } from "../../../../../accounting/reports/report-controls";
import { ActualShare, Estimated, isNegative, pct, Stat } from "../pnl-parts";

export const metadata: Metadata = { title: "Product profit and loss" };

/**
 * One SKU's profit and loss for any period: a waterfall from gross sales to profit in the main
 * currency (every channel, each amount at its day's rate), then each channel in its own currency.
 * docs/ADS.md §6b.
 */
export default async function SkuPnlDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; sku: string }>;
  searchParams: Promise<{ from?: string; to?: string; brands?: string }>;
}) {
  const { slug, sku: raw } = await params;
  const sku = decodeURIComponent(raw);
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const sp = await searchParams;
  const { locale, timezone, baseCurrency } = ctx.profile;
  const today = nowIn(timezone).date;
  const { from, to, presets } = resolveRange(sp, today, fiscalConfigOf(ctx.profile));
  const allocateBrands = sp.brands === "shared";
  const data = await skuProfitAndLoss(ctx, { from, to, allocateBrands });
  const row = data.summary.rows.find((r) => r.sku === sku);
  const channels = data.channels.flatMap((c) => {
    const r = c.rows.find((x) => x.sku === sku);
    return r ? [{ channel: c, row: r }] : [];
  });
  const q = new URLSearchParams({ from, to });
  if (allocateBrands) q.set("brands", "shared");
  const back = `/o/${slug}/commerce/profit/products/pnl?${q}`;
  const title = row?.label ?? sku;

  return (
    <div className="grid gap-6">
      <Link
        href={back}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Profit and loss by product
      </Link>
      <PageHeader
        eyebrow={row?.label ? sku : "Product profit and loss"}
        title={title}
        description="Every line between what buyers paid and what this product left you, in the period. Amounts marked ≈ are estimated: not settled by the marketplace yet, shared out, or still changing."
      />
      <RangeControls
        from={from}
        to={to}
        presets={presets}
        csvHref={`/api/o/${slug}/commerce/sku-pnl?${new URLSearchParams({ ...Object.fromEntries(q), sku })}`}
      />

      {row ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Profit"
              hint={`All channels, in ${baseCurrency}`}
              tone={isNegative(row.profit) ? "bad" : "good"}
              value={<Amount value={row.profit} currency={baseCurrency} locale={locale} />}
              sub={
                row.profit === null
                  ? row.costMissing
                    ? "Link it to a product with a cost to see it"
                    : "The marketplace's fees aren't known yet"
                  : `${pct(row.margin, locale)} of sales`
              }
            />
            <Stat
              label="Per unit"
              hint="Profit over units sold"
              tone={isNegative(row.profitPerUnit) ? "bad" : "good"}
              value={<Amount value={row.profitPerUnit} currency={baseCurrency} locale={locale} />}
              sub={`${row.unitsSold.toLocaleString(locale)} sold, ${row.unitsReturned.toLocaleString(locale)} returned`}
            />
            <Stat
              label="TACOS"
              hint="Ad spend over sales"
              value={pct(row.tacos, locale)}
              sub={
                <>
                  <Amount
                    value={row.ads.replace(/^-/, "")}
                    currency={baseCurrency}
                    locale={locale}
                  />{" "}
                  on ads
                </>
              }
            />
            <Stat
              label="Actual"
              hint="The share of its amounts that are the marketplaces' own; the rest is estimated"
              value={pct(row.actualShare, locale)}
              sub={<ActualShare share={row.actualShare} locale={locale} />}
            />
          </div>

          <section
            aria-labelledby="waterfall"
            className="fade-in-0 grid animate-in overflow-hidden rounded-2xl border bg-card shadow-xs"
          >
            <div className="border-b px-5 py-4">
              <h2 id="waterfall" className="font-semibold">
                From sales to profit{" "}
                <span className="font-normal text-muted-foreground text-sm">{baseCurrency}</span>
              </h2>
              <p className="text-muted-foreground text-xs">
                {channels.length > 1
                  ? `${channels.length} channels together, each amount at its day's rate.`
                  : "Each amount at its day's rate."}
              </p>
            </div>
            <Waterfall row={row} currency={baseCurrency} locale={locale} />
          </section>

          <section
            aria-labelledby="by-channel"
            className="fade-in-0 grid animate-in overflow-hidden rounded-2xl border bg-card shadow-xs"
          >
            <div className="border-b px-5 py-4">
              <h2 id="by-channel" className="font-semibold">
                By channel
              </h2>
              <p className="text-muted-foreground text-xs">
                Each channel in its own currency, the amounts as the marketplace has them.
              </p>
            </div>
            <ChannelBreakdown channels={channels} locale={locale} />
          </section>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <p className="font-medium">No sales of {sku} in this period</p>
          <p className="text-muted-foreground text-sm">Choose another period.</p>
        </div>
      )}
    </div>
  );
}

/** Each line as a bar from the running total before it to after it. */
function Waterfall({ row, currency, locale }: { row: SkuPnl; currency: string; locale: string }) {
  const steps = skuWaterfall(row);
  let running = 0n;
  const spans = steps.map((s) => {
    const units = parseDecimal(s.amount);
    const start = s.line === "profit" ? 0n : running;
    const end = s.line === "profit" ? units : running + units;
    if (s.line !== "profit") running = end;
    return { ...s, start, end, units };
  });
  const values = spans.flatMap((s) => [s.start, s.end]);
  const low = values.reduce((m, v) => (v < m ? v : m), 0n);
  const high = values.reduce((m, v) => (v > m ? v : m), 0n);
  const width = high - low || 1n;
  const at = (v: bigint) => Number(((v - low) * 10_000n) / width) / 100;
  return (
    <ol className="grid divide-y">
      {spans.map((s) => {
        const left = at(s.start < s.end ? s.start : s.end);
        const right = at(s.start < s.end ? s.end : s.start);
        const isProfit = s.line === "profit";
        const hint = s.line === "profit" ? null : SKU_PNL_LABELS[s.line].hint;
        return (
          <li
            key={s.line}
            className={cn(
              "grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 px-5 py-2.5 text-sm sm:grid-cols-[14rem_1fr_9rem]",
              isProfit && "bg-muted/30 font-medium",
            )}
          >
            <span className="min-w-0 truncate" title={hint ?? undefined}>
              {s.label}
            </span>
            <span className="relative h-3 rounded-sm bg-muted/40" aria-hidden>
              <span
                className={cn(
                  "absolute inset-y-0 rounded-sm",
                  isProfit
                    ? s.units < 0n
                      ? "bg-destructive"
                      : "bg-success"
                    : s.units < 0n
                      ? "bg-destructive/70"
                      : "bg-primary/70",
                  parseDecimal(s.estimated) !== 0n &&
                    "bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-background)_3px_5px)]",
                )}
                style={{ insetInlineStart: `${left}%`, width: `${Math.max(right - left, 0.5)}%` }}
              />
            </span>
            <span className="text-end">
              <Amount
                value={s.amount}
                currency={currency}
                locale={locale}
                className={cn(isProfit && s.units < 0n && "text-destructive")}
              />
              <Estimated value={s.estimated} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ChannelBreakdown({
  channels,
  locale,
}: {
  channels: {
    channel: { channelId: string; name: string; currency: string; mode: string; isActive: boolean };
    row: SkuPnl;
  }[];
  locale: string;
}) {
  const used = SKU_PNL_LINES.filter((l) =>
    channels.some((c) => parseDecimal(c.row.lines[l].amount) !== 0n),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
            <th className="px-5 py-3 text-start font-medium">Line</th>
            {channels.map(({ channel }) => (
              <th key={channel.channelId} className="px-4 py-3 text-end font-medium">
                {channel.name} <span className="font-normal">{channel.currency}</span>
                {!channel.isActive ? (
                  <Badge variant="outline" className="ms-1">
                    Off
                  </Badge>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="px-5 py-2">Units sold / returned</td>
            {channels.map(({ channel, row }) => (
              <td key={channel.channelId} className="tabular px-4 py-2 text-end">
                {row.unitsSold.toLocaleString(locale)} / {row.unitsReturned.toLocaleString(locale)}
              </td>
            ))}
          </tr>
          {used.map((l) => (
            <tr key={l} className="border-b">
              <td className="px-5 py-2" title={SKU_PNL_LABELS[l].hint}>
                {SKU_PNL_LABELS[l].label}
              </td>
              {channels.map(({ channel, row }) => (
                <td key={channel.channelId} className="px-4 py-2 text-end">
                  <Amount
                    value={row.lines[l].amount}
                    currency={channel.currency}
                    locale={locale}
                    muteZero
                  />
                  <Estimated value={row.lines[l]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/30 font-medium">
            <td className="px-5 py-3">Profit</td>
            {channels.map(({ channel, row }) => (
              <td
                key={channel.channelId}
                className={cn("px-4 py-3 text-end", isNegative(row.profit) && "text-destructive")}
              >
                <Amount value={row.profit} currency={channel.currency} locale={locale} />
                <span className="block font-normal text-muted-foreground text-xs">
                  {pct(row.margin, locale)} margin · {pct(row.actualShare, locale)} actual
                </span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

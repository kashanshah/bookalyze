import {
  formatMoney,
  GLANCE_RANGES,
  type GlanceRange,
  type SalesGlance as SalesGlanceData,
} from "@bookalyze/core";
import Link from "next/link";
import { TrendChart } from "@/components/commerce/trend-chart";
import { cn } from "@/lib/utils";

const RANGE_LABEL: Record<GlanceRange, string> = {
  7: "7 days",
  30: "30 days",
  90: "90 days",
};

function countLabel(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

/** Orders, units and sales for a quick look, when Commerce is switched on. */
export function SalesGlance({
  glance,
  range,
  locale,
  homeHref,
  ordersHref,
}: {
  glance: SalesGlanceData;
  range: GlanceRange;
  locale: string;
  homeHref: string;
  ordersHref: string;
}) {
  const quiet = glance.orders.total === 0;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">Recent orders</h2>
          <p className="text-muted-foreground text-sm">
            Placed in the last {RANGE_LABEL[range]}. Canceled orders are left out.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-1 text-sm">
            {GLANCE_RANGES.map((days) => (
              <Link
                key={days}
                href={days === 30 ? homeHref : `${homeHref}?glance=${days}`}
                className={cn(
                  "rounded-full px-2.5 py-1",
                  days === range
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={days === range ? "true" : undefined}
              >
                {RANGE_LABEL[days]}
              </Link>
            ))}
          </div>
          <Link
            href={ordersHref}
            className="whitespace-nowrap font-medium text-primary text-sm hover:underline"
          >
            Open orders
          </Link>
        </div>
      </div>

      {quiet ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground text-sm">
          No orders in the last {RANGE_LABEL[range]}.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          <GlanceCard label="Orders" hint="Orders placed">
            <p className="tabular font-semibold text-2xl tracking-tight">
              {countLabel(glance.orders.total, locale)}
            </p>
            <TrendChart
              values={glance.orders.points.map((point) => point.value)}
              label={`Orders each day for the last ${RANGE_LABEL[range]}`}
            />
          </GlanceCard>
          <GlanceCard label="Units" hint="Items on those orders">
            <p className="tabular font-semibold text-2xl tracking-tight">
              {countLabel(glance.units.total, locale)}
            </p>
            <TrendChart
              values={glance.units.points.map((point) => point.value)}
              label={`Units each day for the last ${RANGE_LABEL[range]}`}
            />
          </GlanceCard>
          {glance.sales.map((series) => (
            <GlanceCard key={series.currency} label="Sales" hint={`In ${series.currency}`}>
              <p className="tabular break-words font-semibold text-2xl tracking-tight">
                {formatMoney(series.total, series.currency, locale)}
              </p>
              <TrendChart
                amounts={series.points.map((point) => point.amount)}
                label={`Sales in ${series.currency} each day for the last ${RANGE_LABEL[range]}`}
              />
            </GlanceCard>
          ))}
        </div>
      )}
    </section>
  );
}

function GlanceCard({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_4px_16px_-8px_rgb(0_0_0/0.06)] sm:p-5">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="text-muted-foreground text-xs">{hint}</p>
      {children}
    </div>
  );
}

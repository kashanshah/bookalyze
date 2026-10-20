import { parseDecimal } from "@bookalyze/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getAccountingContext } from "@/server/accounting";
import { loadYourStake } from "../data";
import { DateControls } from "../report-controls";
import { BalanceCheck, ReportCard, ReportHeader } from "../report-parts";

export const metadata: Metadata = { title: "Your stake" };

const YEAR_GRID =
  "grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,auto))] items-baseline gap-x-4 sm:grid-cols-[minmax(0,1fr)_repeat(4,8.5rem)]";

export default async function YourStakePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const { date, presets, stake } = await loadYourStake(ctx, await searchParams);
  const money = (value: string) => <Amount value={value} currency={currency} locale={locale} />;
  const upOrDown = parseDecimal(stake.upOrDown);
  const abs = (value: string) => (value.startsWith("-") ? value.slice(1) : value);
  const linesHref = (from: string, to: string, way?: "in" | "out") =>
    `/o/${slug}/accounting/reports/your-stake/transactions?from=${from}&to=${to}&date=${date}${way ? `&way=${way}` : ""}`;
  /** An amount that opens the entries behind it. */
  const linked = (value: string, href: string, label: string) => (
    <Link
      href={href}
      aria-label={label}
      className="text-end tabular-nums underline-offset-4 hover:text-primary hover:underline"
    >
      {money(value)}
    </Link>
  );
  const firstDay = stake.years[0]?.from;

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Your stake"
        company={ctx.org.name}
        period={`As of ${formatDate(date, locale, "long")}`}
        description="The company in owner's terms: what you put in, what you took out, and what it's worth today. The difference is every year's profit or loss, the same as the profit and loss report."
      />
      <DateControls date={date} presets={presets} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="You put in" value={money(stake.putIn)} hint="Owner contributions" />
        <Tile label="You took out" value={money(stake.tookOut)} hint="Drawings and dividends" />
        <Tile
          label="Net put in"
          value={money(stake.net)}
          hint="Put in less taken out: your money still in the company"
        />
        <Tile
          label="Worth today"
          value={money(stake.worthTotal)}
          hint="What it owns less what it owes"
        />
      </div>

      <p
        className={cn(
          "rounded-2xl border px-5 py-4 text-sm",
          upOrDown > 0n
            ? "border-success/30 bg-success/8"
            : upOrDown < 0n
              ? "border-warning/40 bg-warning/10"
              : "bg-card",
        )}
      >
        {upOrDown === 0n ? (
          <>The company is worth exactly what you put in, net.</>
        ) : (
          <>
            You're <span className="font-semibold">{money(abs(stake.upOrDown))}</span>{" "}
            {upOrDown > 0n ? "up" : "down"} overall: the company is worth {money(stake.worthTotal)},
            against {money(stake.net)} you put in, net.
          </>
        )}
      </p>

      <ReportCard>
        <div
          className={`${YEAR_GRID} border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:px-6`}
        >
          <span>Financial year</span>
          <span className="text-end">Put in</span>
          <span className="text-end">Took out</span>
          <span className="hidden text-end sm:block">Net put in</span>
          <span className="text-end">Profit</span>
        </div>
        {stake.years.length === 0 ? (
          <p className="px-6 py-8 text-center text-muted-foreground text-sm">
            Nothing in the books yet.
          </p>
        ) : (
          stake.years.map((y) => (
            <div key={y.from} className={`${YEAR_GRID} border-b px-5 py-2.5 text-sm sm:px-6`}>
              <span className="min-w-0">
                <span className="font-medium">{y.label}</span>
                <span className="block text-muted-foreground text-xs">
                  {formatDate(y.from, locale)} – {formatDate(y.to, locale)}
                </span>
              </span>
              {linked(y.putIn, linesHref(y.from, y.to, "in"), `What you put in, ${y.label}`)}
              {linked(y.tookOut, linesHref(y.from, y.to, "out"), `What you took out, ${y.label}`)}
              <span className="hidden text-end tabular-nums sm:block">{money(y.net)}</span>
              <span className="text-end tabular-nums">{money(y.profit)}</span>
            </div>
          ))
        )}
        {parseDecimal(stake.earlierProfit) !== 0n ? (
          <div className={`${YEAR_GRID} border-b px-5 py-2.5 text-sm sm:px-6`}>
            <span className="text-muted-foreground">Before these years</span>
            <span />
            <span />
            <span className="hidden sm:block" />
            <span className="text-end tabular-nums">{money(stake.earlierProfit)}</span>
          </div>
        ) : null}
        <div className={`${YEAR_GRID} bg-primary/5 px-5 py-3.5 font-semibold text-sm sm:px-6`}>
          <span>All years</span>
          {firstDay ? (
            <>
              {linked(stake.putIn, linesHref(firstDay, date, "in"), "What you put in, all years")}
              {linked(
                stake.tookOut,
                linesHref(firstDay, date, "out"),
                "What you took out, all years",
              )}
            </>
          ) : (
            <>
              <span className="text-end tabular-nums">{money(stake.putIn)}</span>
              <span className="text-end tabular-nums">{money(stake.tookOut)}</span>
            </>
          )}
          <span className="hidden text-end tabular-nums sm:block">{money(stake.net)}</span>
          <span className="text-end tabular-nums">{money(stake.profit)}</span>
        </div>
      </ReportCard>

      <ReportCard>
        <div className="border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:px-6">
          What it's worth on {formatDate(date, locale)}
        </div>
        {stake.worth.map((g) => (
          <div
            key={g.key}
            className="flex items-baseline justify-between gap-4 border-b px-5 py-2.5 text-sm sm:px-6"
          >
            <span>{g.label}</span>
            <span className="tabular-nums">{money(g.amount)}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 bg-primary/5 px-5 py-3.5 font-semibold text-base sm:px-6">
          <span>Worth today</span>
          <span className="tabular-nums">{money(stake.worthTotal)}</span>
        </div>
      </ReportCard>

      <BalanceCheck
        balanced={stake.balanced}
        okText="Worth today equals what you put in, net, plus every year's profit."
        badText="Worth doesn't equal what you put in plus profit. Please contact support."
      />
      <p className="max-w-3xl text-muted-foreground text-xs leading-relaxed">
        Click an amount to see the entries behind it. Net put in is what you put in less what you
        took out: positive means more of your money went in than came back out. Took out counts
        everything that went from the company to you, in any form: money you withdrew, marketplace
        payouts kept in a personal account, the company's money spent on something that isn't the
        company's, stock you took or sold yourself. Stock is at what it cost; it becomes money only
        when it sells.
      </p>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="fade-in-0 animate-in rounded-2xl border bg-card px-4 py-3.5 shadow-xs">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-lg tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

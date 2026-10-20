import { formatMoney } from "@bookalyze/core";
import { formatEntryNumber } from "@bookalyze/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getAccountingContext } from "@/server/accounting";
import { ledgerLineDetails, loadStakeLines } from "../../data";
import { ReportCard, ReportHeader } from "../../report-parts";

export const metadata: Metadata = { title: "Put in and taken out" };

const LINE_GRID = "sm:grid sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,12rem)_9rem] sm:gap-x-4";

export default async function StakeTransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; date?: string; way?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const { from, to, date, way, lines, putIn, tookOut, truncated } = await loadStakeLines(
    ctx,
    await searchParams,
  );
  const money = { currency, locale };
  const base = `/o/${slug}/accounting/reports/your-stake`;
  const hrefFor = (w: "in" | "out" | null) =>
    `${base}/transactions?from=${from}&to=${to}&date=${date}${w ? `&way=${w}` : ""}`;
  const tabs = [
    { way: null, label: "Both", total: null },
    { way: "in" as const, label: "Put in", total: putIn },
    { way: "out" as const, label: "Took out", total: tookOut },
  ];

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Put in and taken out"
        company={ctx.org.name}
        period={`${formatDate(from, locale, "long")} – ${formatDate(to, locale, "long")}`}
        description="Every entry behind Your stake for these dates: money you put into the company, and what went from it to you. Open one to see the whole entry."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`${base}?date=${date}`}
          className="me-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          ← Your stake
        </Link>
        <nav aria-label="Which entries" className="flex flex-wrap gap-1 rounded-xl border p-1">
          {tabs.map((t) => (
            <Link
              key={t.label}
              href={hrefFor(t.way)}
              aria-current={way === t.way ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                way === t.way
                  ? "bg-primary/10 font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.total ? (
                <span className="ms-1.5 text-muted-foreground tabular-nums">
                  {formatMoney(t.total, currency, locale)}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </div>

      <ReportCard>
        <div
          className={`hidden border-b bg-muted/30 px-6 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider ${LINE_GRID}`}
        >
          <span>Date</span>
          <span>Details</span>
          <span>Account</span>
          <span className="text-end">
            {way === "out" ? "Took out" : way === "in" ? "Put in" : "Amount"}
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="px-6 py-8 text-center text-muted-foreground text-sm">
            Nothing {way === "out" ? "taken out" : way === "in" ? "put in" : "put in or taken out"}{" "}
            in these dates.
          </p>
        ) : (
          <ul className="divide-y">
            {lines.map((line) => (
              <li key={line.id}>
                <Link
                  href={`/o/${slug}/accounting/journal/${line.entryId}`}
                  className={`flex flex-col gap-1 px-5 py-2.5 text-sm transition-colors hover:bg-muted/40 sm:px-6 ${LINE_GRID}`}
                >
                  <span className="tabular text-muted-foreground sm:text-foreground">
                    {formatDate(line.date, locale)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{ledgerLineDetails(line)}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {formatEntryNumber(line.entryNumber)}
                      {line.reference ? ` · ${line.reference}` : ""}
                    </span>
                  </span>
                  <span className="truncate text-muted-foreground text-xs sm:text-sm">
                    {line.accountName}
                  </span>
                  <span className="flex items-baseline justify-between gap-3 sm:block sm:text-end">
                    <span className="text-muted-foreground text-xs sm:hidden">
                      {line.way === "in" ? "Put in" : "Took out"}
                    </span>
                    <span className="sm:flex sm:flex-col sm:items-end">
                      <Amount value={line.amount} {...money} className="tabular-nums" />
                      {way === null ? (
                        <span className="hidden text-muted-foreground text-xs sm:block">
                          {line.way === "in" ? "Put in" : "Took out"}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {truncated ? (
          <p className="border-t bg-warning/10 px-5 py-3 text-sm sm:px-6">
            Showing the first {lines.length.toLocaleString(locale)} entries, and the totals are for
            those only. Pick a single year from Your stake to see them all.
          </p>
        ) : null}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t bg-primary/5 px-5 py-3.5 font-semibold text-sm sm:px-6">
          <span>Total</span>
          <span className="flex flex-wrap gap-x-6 gap-y-1">
            {way !== "out" ? (
              <span>
                <span className="me-2 font-normal text-muted-foreground">Put in</span>
                <Amount value={putIn} {...money} />
              </span>
            ) : null}
            {way !== "in" ? (
              <span>
                <span className="me-2 font-normal text-muted-foreground">Took out</span>
                <Amount value={tookOut} {...money} />
              </span>
            ) : null}
          </span>
        </div>
      </ReportCard>
      <p className="max-w-3xl text-muted-foreground text-xs leading-relaxed">
        A negative amount is a correction the other way: a contribution taken back off, or money
        that came back to the company after it was counted as taken out.
      </p>
    </div>
  );
}

import { formatTaxRate, parseDecimal } from "@bookalyze/core";
import { Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getAccountingContext } from "@/server/accounting";
import { exportHref, loadSalesTax } from "../data";
import { RangeControls } from "../report-controls";
import { ReportCard, ReportHeader } from "../report-parts";

export const metadata: Metadata = { title: "Sales tax report" };

const COLUMNS = [
  { key: "sales", label: "Sales before tax" },
  { key: "taxCollected", label: "Tax collected" },
  { key: "purchases", label: "Purchases before tax" },
  { key: "taxPaid", label: "Tax paid" },
  { key: "net", label: "Net tax" },
] as const;

export default async function SalesTaxReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const { from, to, presets, rates, registration, summary } = await loadSalesTax(
    ctx,
    await searchParams,
  );
  const owing = parseDecimal(summary.netOwing);

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Sales tax"
        company={ctx.org.name}
        period={`${formatDate(from, locale)} – ${formatDate(to, locale)}`}
        description={
          registration
            ? `Tax collected and paid for each filing period, ready for your return to ${registration.authority}.`
            : "Tax collected and paid in this period, ready for your sales tax return."
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangeControls
          from={from}
          to={to}
          presets={presets}
          csvHref={rates.length ? exportHref(slug, "sales-tax", { from, to }) : undefined}
        />
        <Button asChild variant="ghost" className="print:hidden">
          <Link href={`/o/${slug}/accounting/sales-tax`}>
            <Settings2 />
            Rates and registrations
          </Link>
        </Button>
      </div>

      {rates.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <p className="font-medium">No sales tax set up yet.</p>
          <p className="mx-auto mt-1 max-w-md text-muted-foreground text-sm">
            If you're registered for GST/HST, VAT or another sales tax, add your rates and pick them
            on your transactions. This report then adds everything up for each filing period.
          </p>
          <Button asChild className="mt-4">
            <Link href={`/o/${slug}/accounting/sales-tax`}>Set up sales tax</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Tax you collected" index={0}>
              <Amount value={summary.totalCollected} currency={currency} locale={locale} />
            </SummaryCard>
            <SummaryCard label="Tax you can claim back" index={1}>
              <Amount value={summary.totalClaimable} currency={currency} locale={locale} />
            </SummaryCard>
            <SummaryCard label={owing < 0n ? "Refund due to you" : "You owe"} index={2} emphasis>
              <Amount
                value={summary.netOwing.replace("-", "")}
                currency={currency}
                locale={locale}
                className={cn(owing < 0n && "text-success")}
              />
            </SummaryCard>
          </div>

          <ReportCard>
            <div className="hidden grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))] gap-4 border-b bg-muted/30 px-6 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
              <span>Rate</span>
              {COLUMNS.map((c) => (
                <span key={c.key} className="text-end">
                  {c.label}
                </span>
              ))}
            </div>
            {summary.rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-muted-foreground text-sm sm:px-6">
                No taxed transactions in this period.
              </p>
            ) : (
              <ul className="divide-y">
                {summary.rows.map((row) => (
                  <li
                    key={row.taxRateId}
                    className="grid gap-2 px-5 py-3.5 text-sm sm:px-6 md:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))] md:items-baseline md:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{row.name}</span>
                      <span className="block text-muted-foreground text-xs">
                        {formatTaxRate(row.rate)}%
                        {row.isRecoverable
                          ? ""
                          : " · purchases include this tax, which can't be claimed back"}
                      </span>
                    </span>
                    {COLUMNS.map((c) => (
                      <span
                        key={c.key}
                        className="flex items-baseline justify-between gap-4 md:block md:text-end"
                      >
                        <span className="text-muted-foreground text-xs md:hidden">{c.label}</span>
                        <Amount
                          value={row[c.key]}
                          currency={currency}
                          locale={locale}
                          muteZero
                          className={cn(c.key === "net" && "font-medium")}
                        />
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-baseline justify-between gap-4 border-t bg-primary/5 px-5 py-3.5 font-semibold sm:px-6">
              <span>{owing < 0n ? "Refund due to you" : "Net tax owing"}</span>
              <Amount
                value={summary.netOwing.replace("-", "")}
                currency={currency}
                locale={locale}
              />
            </div>
          </ReportCard>

          <div className="grid gap-1.5 text-muted-foreground text-xs leading-relaxed">
            <p>
              Amounts are in {currency} and cover every transaction dated in this period. Edited or
              removed transactions are counted as they stand now.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  index,
  emphasis = false,
  children,
}: {
  label: string;
  index: number;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "fade-in-0 slide-in-from-bottom-2 grid animate-in gap-1 rounded-2xl border bg-card fill-mode-both p-4 shadow-xs sm:p-5",
        emphasis && "border-primary/30 bg-primary/[0.04]",
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={cn("font-semibold text-xl tracking-tight", emphasis && "text-2xl")}>
        {children}
      </span>
    </div>
  );
}

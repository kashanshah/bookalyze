import type { Metadata } from "next";
import { formatDate } from "@/lib/dates";
import { getAccountingContext } from "@/server/accounting";
import { exportHref, loadProfitAndLoss } from "../data";
import { RangeControls } from "../report-controls";
import { ReportCard, ReportHeader, ReportSectionRows, TotalRow } from "../report-parts";

export const metadata: Metadata = { title: "Profit and loss" };

export default async function ProfitAndLossPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const { from, to, presets, pnl } = await loadProfitAndLoss(ctx, await searchParams);
  const ledger = { slug, from, to };

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Profit and loss"
        company={ctx.org.name}
        period={`${formatDate(from, locale)} – ${formatDate(to, locale)}`}
        description="What the company earned and spent in this period. Also called an income statement."
      />
      <RangeControls
        from={from}
        to={to}
        presets={presets}
        csvHref={exportHref(slug, "profit-and-loss", { from, to })}
      />
      <ReportCard>
        <ReportSectionRows
          section={pnl.income}
          currency={currency}
          locale={locale}
          ledger={ledger}
        />
        <ReportSectionRows
          section={pnl.costOfSales}
          currency={currency}
          locale={locale}
          ledger={ledger}
          emptyText="No cost of goods sold in this period."
        />
        <TotalRow
          label="Gross profit"
          value={pnl.grossProfit}
          currency={currency}
          locale={locale}
        />
        <ReportSectionRows
          section={pnl.expenses}
          currency={currency}
          locale={locale}
          ledger={ledger}
        />
        <TotalRow
          label={pnl.netProfit.startsWith("-") ? "Net loss" : "Net profit"}
          value={pnl.netProfit}
          currency={currency}
          locale={locale}
          emphasis
        />
      </ReportCard>
    </div>
  );
}

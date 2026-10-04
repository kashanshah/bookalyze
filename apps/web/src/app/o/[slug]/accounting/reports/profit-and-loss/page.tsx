import { profitAndLoss } from "@bookalyze/core";
import { accountBalances } from "@bookalyze/db";
import type { Metadata } from "next";
import { formatDate, nowIn } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { fiscalConfigOf } from "@/server/org";
import { resolveRange } from "../periods";
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
  const today = nowIn(ctx.profile.timezone).date;
  const { from, to, presets } = resolveRange(
    await searchParams,
    today,
    fiscalConfigOf(ctx.profile),
  );
  const ledger = { slug, from, to };
  const pnl = profitAndLoss(await inOrg(ctx, (tx) => accountBalances(tx, { from, to })));

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Profit and loss"
        company={ctx.org.name}
        period={`${formatDate(from, locale)} – ${formatDate(to, locale)}`}
        description="What the company earned and spent in this period. Also called an income statement."
      />
      <RangeControls from={from} to={to} presets={presets} />
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

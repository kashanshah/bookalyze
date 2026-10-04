import { balanceSheet, fiscalYearFor } from "@bookalyze/core";
import { accountBalances } from "@bookalyze/db";
import type { Metadata } from "next";
import { formatDate, nowIn } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { fiscalConfigOf } from "@/server/org";
import { resolveDate } from "../periods";
import { DateControls } from "../report-controls";
import {
  BalanceCheck,
  ReportCard,
  ReportHeader,
  ReportSectionRows,
  TotalRow,
} from "../report-parts";

export const metadata: Metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const cfg = fiscalConfigOf(ctx.profile);
  const today = nowIn(ctx.profile.timezone).date;
  const { date, presets } = resolveDate(await searchParams, today, cfg);
  const fy = fiscalYearFor(date, cfg);
  // An account's lines this financial year, with everything before it as the opening balance.
  const ledger = { slug, from: fy.start, to: date };
  const bs = await inOrg(ctx, async (tx) =>
    balanceSheet(
      await accountBalances(tx, { to: date }),
      await accountBalances(tx, { from: fy.start, to: date }),
    ),
  );

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Balance sheet"
        company={ctx.org.name}
        period={`As of ${formatDate(date, locale, "long")}`}
        description={`What the company owns and owes on this date. Profit since ${formatDate(fy.start, locale)} (the start of ${fy.label}) is shown under equity.`}
      />
      <DateControls date={date} presets={presets} />
      <ReportCard>
        <ReportSectionRows
          section={bs.assets}
          currency={currency}
          locale={locale}
          ledger={ledger}
          emptyText="No assets yet."
        />
        <ReportSectionRows
          section={bs.liabilities}
          currency={currency}
          locale={locale}
          ledger={ledger}
          emptyText="No liabilities."
        />
        <ReportSectionRows
          section={bs.equity}
          currency={currency}
          locale={locale}
          ledger={ledger}
          emptyText="No equity yet."
        />
        <TotalRow
          label="Total liabilities and equity"
          value={bs.totalLiabilitiesAndEquity}
          currency={currency}
          locale={locale}
          emphasis
        />
      </ReportCard>
      <BalanceCheck
        balanced={bs.balanced}
        okText="Assets equal liabilities plus equity."
        badText="Assets don't equal liabilities plus equity. Please contact support."
      />
    </div>
  );
}

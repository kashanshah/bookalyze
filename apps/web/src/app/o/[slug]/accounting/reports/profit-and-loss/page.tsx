import {
  type ComparisonSection,
  type ComparisonTotal,
  comparisonPeriod,
  formatDecimal,
  formatMoney,
  parseDecimal,
  percentChange,
} from "@bookalyze/core";
import type { Metadata } from "next";
import { Amount } from "@/components/accounting/amount";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getAccountingContext } from "@/server/accounting";
import { exportHref, loadProfitAndLoss } from "../data";
import { RangeControls } from "../report-controls";
import {
  AccountCell,
  type LedgerLink,
  ledgerHref,
  ReportCard,
  ReportHeader,
  ReportSectionRows,
  TotalRow,
} from "../report-parts";
import { ComparePicker } from "./compare-picker";

export const metadata: Metadata = { title: "Profit and loss" };

type Money = { currency: string; locale: string };

export default async function ProfitAndLossPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const { from, to, presets, pnl, compare, comparison } = await loadProfitAndLoss(
    ctx,
    await searchParams,
  );
  const ledger = { slug, from, to };
  const money = { currency, locale };
  const range = (p: { from: string; to: string }) =>
    `${formatDate(p.from, locale)} – ${formatDate(p.to, locale)}`;

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Profit and loss"
        company={ctx.org.name}
        period={`${range({ from, to })}${comparison ? ` · compared with ${range(comparison)}` : ""}`}
        description="What the company earned and spent in this period. Also called an income statement."
      />
      <div className="grid gap-4">
        <ComparePicker
          value={compare}
          previous={range(comparisonPeriod(from, to, "previous"))}
          lastYear={range(comparisonPeriod(from, to, "last-year"))}
        />
        <RangeControls
          from={from}
          to={to}
          presets={presets}
          csvHref={exportHref(slug, "profit-and-loss", {
            from,
            to,
            ...(compare !== "none" ? { compare } : {}),
          })}
        />
      </div>
      {comparison ? (
        <ReportCard>
          <div
            className={`hidden border-b bg-muted/30 px-6 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider ${GRID}`}
          >
            <span>Account</span>
            <span className="text-end">This period</span>
            <span className="text-end">
              {compare === "last-year" ? "Last year" : "Previous period"}
            </span>
            <span className="text-end">Change</span>
          </div>
          <CompareSection section={comparison.income} money={money} ledger={ledger} />
          <CompareSection
            section={comparison.costOfSales}
            money={money}
            ledger={ledger}
            emptyText="No cost of goods sold in either period."
          />
          <CompareTotal label="Gross profit" total={comparison.grossProfit} money={money} />
          <CompareSection section={comparison.expenses} money={money} ledger={ledger} />
          <CompareTotal
            label={comparison.netProfit.amount.startsWith("-") ? "Net loss" : "Net profit"}
            total={comparison.netProfit}
            money={money}
            emphasis
          />
        </ReportCard>
      ) : (
        <ReportCard>
          <ReportSectionRows section={pnl.income} {...money} ledger={ledger} />
          <ReportSectionRows
            section={pnl.costOfSales}
            {...money}
            ledger={ledger}
            emptyText="No cost of goods sold in this period."
          />
          <TotalRow label="Gross profit" value={pnl.grossProfit} {...money} />
          <ReportSectionRows section={pnl.expenses} {...money} ledger={ledger} />
          <TotalRow
            label={pnl.netProfit.startsWith("-") ? "Net loss" : "Net profit"}
            value={pnl.netProfit}
            {...money}
            emphasis
          />
        </ReportCard>
      )}
    </div>
  );
}

const GRID =
  "sm:grid sm:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_9rem] sm:items-baseline sm:gap-4 print:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_7rem] print:gap-2";

/** "+$100.00 (+20%)": the change, signed, with the percentage when there was an earlier amount. */
function Change({ amount, prior, money }: { amount: string; prior: string; money: Money }) {
  const change = parseDecimal(amount) - parseDecimal(prior);
  if (change === 0n) return <span className="text-muted-foreground/60">—</span>;
  const abs = formatMoney(
    formatDecimal(change < 0n ? -change : change),
    money.currency,
    money.locale,
  );
  const pct = percentChange(amount, prior);
  return (
    <span className="tabular whitespace-nowrap">
      {change > 0n ? "+" : "−"}
      {abs}
      {pct ? <span className="ms-1 text-muted-foreground text-xs">({pct})</span> : null}
    </span>
  );
}

function CompareSection({
  section,
  money,
  ledger,
  emptyText = "Nothing in either period.",
}: {
  section: ComparisonSection;
  money: Money;
  ledger: LedgerLink;
  emptyText?: string;
}) {
  return (
    <div className="border-b last:border-b-0">
      <h3 className="bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:px-6">
        {section.label}
      </h3>
      {section.rows.length === 0 ? (
        <p className="px-5 py-3 text-muted-foreground text-sm sm:px-6">{emptyText}</p>
      ) : (
        <ul>
          {section.rows.map((row) => (
            <li
              key={row.accountId}
              className={`flex flex-col gap-0.5 px-5 py-2 text-sm sm:px-6 ${GRID}`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <AccountCell
                  code={row.code}
                  name={row.name}
                  href={ledgerHref(ledger, row.accountId)}
                />
                <Amount value={row.amount} {...money} className="sm:hidden" />
              </span>
              <Amount value={row.amount} {...money} className="hidden text-end sm:block" />
              <span className="text-muted-foreground text-xs sm:hidden">
                Was {formatMoney(row.prior, money.currency, money.locale)} ·{" "}
                <Change amount={row.amount} prior={row.prior} money={money} />
              </span>
              <Amount
                value={row.prior}
                {...money}
                muteZero
                className="hidden text-end text-muted-foreground sm:block"
              />
              <span className="hidden text-end sm:block">
                <Change amount={row.amount} prior={row.prior} money={money} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <CompareTotal
        label={`Total ${section.label.toLowerCase()}`}
        total={{ amount: section.total, prior: section.priorTotal, change: section.change }}
        money={money}
      />
    </div>
  );
}

function CompareTotal({
  label,
  total,
  money,
  emphasis = false,
}: {
  label: string;
  total: ComparisonTotal;
  money: Money;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        `flex flex-col gap-0.5 border-t px-5 py-2.5 font-semibold text-sm sm:px-6 ${GRID}`,
        emphasis && "bg-primary/5 py-3.5 text-base",
      )}
    >
      <span className="flex items-baseline justify-between gap-3">
        {label}
        <Amount value={total.amount} {...money} className="sm:hidden" />
      </span>
      <Amount value={total.amount} {...money} className="hidden text-end sm:block" />
      <span className="font-normal text-muted-foreground text-xs sm:hidden">
        Was {formatMoney(total.prior, money.currency, money.locale)} ·{" "}
        <Change amount={total.amount} prior={total.prior} money={money} />
      </span>
      <Amount
        value={total.prior}
        {...money}
        className="hidden text-end font-normal text-muted-foreground sm:block"
      />
      <span className="hidden text-end font-normal sm:block">
        <Change amount={total.amount} prior={total.prior} money={money} />
      </span>
    </div>
  );
}

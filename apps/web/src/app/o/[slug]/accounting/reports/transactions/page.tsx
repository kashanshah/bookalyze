import { parseDecimal } from "@bookalyze/core";
import { FileSpreadsheet, Info } from "lucide-react";
import type { Metadata } from "next";
import { Amount } from "@/components/accounting/amount";
import { formatDate } from "@/lib/dates";
import { getAccountingContext } from "@/server/accounting";
import { exportHref, loadTransactionsExport } from "../data";
import { RangeControls } from "../report-controls";
import { ReportCard, ReportHeader } from "../report-parts";

export const metadata: Metadata = { title: "Accounting transactions" };

const PREVIEW = 8;

export default async function TransactionsExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const { from, to, presets, lines } = await loadTransactionsExport(
    ctx,
    await searchParams,
    PREVIEW,
  );
  const money = { currency, locale };

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Accounting transactions"
        company={ctx.org.name}
        period={`${formatDate(from, locale)} – ${formatDate(to, locale)}`}
        description="Every line of every transaction, in the same columns as Wave's accounting transactions export. Send the file to your accountant for bookkeeping and tax filing."
      />
      <RangeControls
        from={from}
        to={to}
        presets={presets}
        csvHref={exportHref(slug, "transactions", { from, to })}
      />

      <div className="grid gap-3 rounded-2xl border bg-muted/30 p-5 text-sm sm:grid-cols-[auto_1fr] sm:gap-4">
        <FileSpreadsheet className="size-5 text-primary" />
        <div className="grid gap-2 text-muted-foreground leading-relaxed">
          <p>
            <span className="font-medium text-foreground">What's in the file:</span> one row per
            line, with the date, account, description, amount (one column and debit/credit columns),
            the other accounts in the transaction, customer or vendor, invoice or bill number, sales
            tax, and Wave's account group and type.
          </p>
          <p>
            Amounts are in {currency}. Lines in other currencies are converted at the rate used when
            they were recorded. A transaction that was edited or deleted within the period is left
            out together with its reversal, so the file adds up to your books.
          </p>
        </div>
      </div>

      <ReportCard>
        <div className="flex items-center gap-2 border-b px-5 py-3 font-medium text-sm sm:px-6">
          <Info className="size-4 text-muted-foreground" />
          {lines.length === 0 ? "Nothing to export" : "The first lines of the file"}
        </div>
        {lines.length === 0 ? (
          <p className="px-6 py-10 text-center text-muted-foreground text-sm">
            No transactions in this period. Pick another period above.
          </p>
        ) : (
          <ul className="divide-y">
            {lines.map((line) => {
              const amount = parseDecimal(line.amount);
              return (
                <li
                  key={line.lineId}
                  className="flex flex-col gap-0.5 px-5 py-2.5 text-sm sm:grid sm:grid-cols-[6.5rem_4.5rem_minmax(0,1fr)_8rem] sm:items-baseline sm:gap-4 sm:px-6"
                >
                  <span className="tabular text-muted-foreground sm:text-foreground">
                    {formatDate(line.date, locale)}
                  </span>
                  <span className="tabular text-muted-foreground text-xs">#{line.entryNumber}</span>
                  <span className="min-w-0 truncate">
                    {line.accountName}
                    {line.memo ? (
                      <span className="text-muted-foreground"> · {line.memo}</span>
                    ) : null}
                  </span>
                  <Amount
                    value={line.amount}
                    {...money}
                    className={amount < 0n ? "text-muted-foreground sm:text-end" : "sm:text-end"}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </ReportCard>
    </div>
  );
}

import {
  accountLedger,
  accountLedgerCsv,
  balanceSheetCsv,
  csvFileName,
  formatTaxRate,
  generalLedgerSummaryCsv,
  profitAndLossCsv,
  type ReportMeta,
  salesTaxCsv,
  trialBalanceCsv,
} from "@bookalyze/core";
import { formatEntryNumber } from "@bookalyze/db";
import {
  LEDGER_EXPORT_LIMIT,
  ledgerLineDetails,
  loadBalanceSheet,
  loadGeneralLedger,
  loadProfitAndLoss,
  loadSalesTax,
  loadTrialBalance,
  type ReportQuery,
} from "@/app/o/[slug]/accounting/reports/data";
import { getAccountingContext } from "@/server/accounting";

/**
 * A report as a CSV download, for the same URL parameters as its page. Members only: the
 * accounting context checks the session and membership, and the data is read inside withOrg().
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; report: string }> },
) {
  const { slug, report } = await params;
  const ctx = await getAccountingContext(slug);
  const search = new URL(request.url).searchParams;
  const query: ReportQuery = {};
  for (const key of ["from", "to", "date", "account"] as const) {
    const value = search.get(key);
    if (value) query[key] = value;
  }
  const company = ctx.org.name;
  const currency = ctx.profile.baseCurrency;
  const meta = (name: string, period: string): ReportMeta => ({
    company,
    report: name,
    period,
    currency,
  });
  const file = (csv: string, ...name: string[]) =>
    new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFileName(company, ...name)}"`,
        "Cache-Control": "private, no-store",
      },
    });

  switch (report) {
    case "profit-and-loss": {
      const { from, to, pnl } = await loadProfitAndLoss(ctx, query);
      return file(
        profitAndLossCsv(pnl, meta("Profit and loss", `${from} to ${to}`)),
        "profit and loss",
        from,
        "to",
        to,
      );
    }
    case "balance-sheet": {
      const { date, bs } = await loadBalanceSheet(ctx, query);
      return file(
        balanceSheetCsv(bs, meta("Balance sheet", `As of ${date}`)),
        "balance sheet",
        date,
      );
    }
    case "trial-balance": {
      const { date, tb } = await loadTrialBalance(ctx, query);
      return file(
        trialBalanceCsv(tb, meta("Trial balance", `As of ${date}`)),
        "trial balance",
        date,
      );
    }
    case "general-ledger": {
      const { from, to, data } = await loadGeneralLedger(ctx, query, LEDGER_EXPORT_LIMIT);
      const period = `${from} to ${to}`;
      if (data.kind === "summary") {
        return file(
          generalLedgerSummaryCsv(data.summary, meta("General ledger", period)),
          "general ledger",
          from,
          "to",
          to,
        );
      }
      const found = data.ledger;
      if (!found) return new Response("Not found", { status: 404 });
      const lines = found.lines.map((l) => ({
        id: l.id,
        amount: l.amount,
        date: l.date,
        entry: formatEntryNumber(l.entryNumber),
        reference: l.reference,
        details: ledgerLineDetails({ ...l, contactName: null }),
        contact: l.contactName,
        currency: l.currency,
        currencyAmount: l.currencyAmount,
      }));
      const ledger = accountLedger(found.account.type, found.opening, lines, {
        debits: found.debits,
        credits: found.credits,
      });
      const cut =
        found.lineCount > found.lines.length
          ? `First ${found.lines.length} of ${found.lineCount} lines. Totals and the closing balance cover the whole period; download a shorter period for the rest.`
          : undefined;
      return file(
        accountLedgerCsv(ledger, found.account, meta("General ledger", period), cut),
        "general ledger",
        found.account.code ?? "",
        found.account.name,
        from,
        "to",
        to,
      );
    }
    case "sales-tax": {
      const { from, to, summary } = await loadSalesTax(ctx, query);
      return file(
        salesTaxCsv(
          summary,
          meta("Sales tax", `${from} to ${to}`),
          (r) => `${r.name} ${formatTaxRate(r.rate)}%`,
        ),
        "sales tax",
        from,
        "to",
        to,
      );
    }
    default:
      return new Response("Not found", { status: 404 });
  }
}

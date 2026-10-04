import { minorUnits } from "../currency";
import { AMOUNT_SCALE, formatDecimal, parseDecimal, roundUnits } from "../money";
import type {
  AccountLedger,
  BalanceSheet,
  GeneralLedgerSummary,
  LedgerLineInput,
  ProfitAndLoss,
  ReportSection,
  TrialBalance,
} from "./reports";
import type { SalesTaxSummary } from "./tax";

/**
 * Reports as CSV for spreadsheets and accountants. Amounts are plain numbers in the main
 * currency, rounded to its minor units, with credits and losses negative where a column holds both
 * directions. Every file starts with the company, report, period and currency.
 */

export type CsvCell = string | null | undefined;

const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * RFC 4180 CSV with CRLF line ends and a byte-order mark, so Excel reads accents correctly. Text
 * that a spreadsheet would run as a formula (starting with =, +, -, @, tab or carriage return) is
 * prefixed with an apostrophe; plain numbers are left as they are.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  const cell = (value: CsvCell) => {
    let text = value ?? "";
    if (/^[=+\-@\t\r]/.test(text) && !NUMBER.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** "1234.5600" in CAD → "1234.56"; JPY → "1235". */
export function csvAmount(value: string | null | undefined, currency: string): string {
  if (value == null || value === "") return "";
  const decimals = Math.min(minorUnits(currency), AMOUNT_SCALE);
  const units = roundUnits(parseDecimal(value), decimals);
  return formatDecimal(units / 10n ** BigInt(AMOUNT_SCALE - decimals), decimals);
}

export type ReportMeta = {
  company: string;
  report: string;
  /** "2025-07-01 to 2026-06-30" or "As of 2026-06-30". */
  period: string;
  currency: string;
};

function header(meta: ReportMeta, columns: string[]): CsvCell[][] {
  return [
    ["Company", meta.company],
    ["Report", meta.report],
    ["Period", meta.period],
    ["Currency", meta.currency],
    [],
    columns,
  ];
}

function sectionRows(section: ReportSection, currency: string): CsvCell[][] {
  return [
    ...section.rows.map((r) => [section.label, r.code, r.name, csvAmount(r.amount, currency)]),
    [
      section.label,
      null,
      `Total ${section.label.toLowerCase()}`,
      csvAmount(section.total, currency),
    ],
  ];
}

export function profitAndLossCsv(pnl: ProfitAndLoss, meta: ReportMeta): string {
  const c = meta.currency;
  return toCsv([
    ...header(meta, ["Section", "Code", "Account", "Amount"]),
    ...sectionRows(pnl.income, c),
    ...sectionRows(pnl.costOfSales, c),
    [null, null, "Gross profit", csvAmount(pnl.grossProfit, c)],
    ...sectionRows(pnl.expenses, c),
    [
      null,
      null,
      pnl.netProfit.startsWith("-") ? "Net loss" : "Net profit",
      csvAmount(pnl.netProfit, c),
    ],
  ]);
}

export function balanceSheetCsv(bs: BalanceSheet, meta: ReportMeta): string {
  const c = meta.currency;
  return toCsv([
    ...header(meta, ["Section", "Code", "Account", "Amount"]),
    ...sectionRows(bs.assets, c),
    ...sectionRows(bs.liabilities, c),
    ...sectionRows(bs.equity, c),
    [null, null, "Total liabilities and equity", csvAmount(bs.totalLiabilitiesAndEquity, c)],
  ]);
}

export function trialBalanceCsv(tb: TrialBalance, meta: ReportMeta): string {
  const c = meta.currency;
  return toCsv([
    ...header(meta, ["Type", "Code", "Account", "Debit", "Credit"]),
    ...tb.groups.flatMap((g) =>
      g.rows.map((r) => [g.label, r.code, r.name, csvAmount(r.debit, c), csvAmount(r.credit, c)]),
    ),
    [null, null, "Total", csvAmount(tb.totalDebit, c), csvAmount(tb.totalCredit, c)],
  ]);
}

export function generalLedgerSummaryCsv(summary: GeneralLedgerSummary, meta: ReportMeta): string {
  const c = meta.currency;
  return toCsv([
    ...header(meta, ["Type", "Code", "Account", "Opening", "Debits", "Credits", "Closing"]),
    ...summary.groups.flatMap((g) =>
      g.rows.map((r) => [
        g.label,
        r.code,
        r.name,
        csvAmount(r.opening, c),
        csvAmount(r.debits, c),
        csvAmount(r.credits, c),
        csvAmount(r.closing, c),
      ]),
    ),
    [
      null,
      null,
      "Total posted in the period",
      null,
      csvAmount(summary.totalDebits, c),
      csvAmount(summary.totalCredits, c),
      null,
    ],
  ]);
}

export type LedgerCsvLine = LedgerLineInput & {
  date: string;
  entry: string;
  reference: string | null;
  details: string;
  contact: string | null;
  /** The line's own currency and amount, when it isn't the main currency. */
  currency: string;
  currencyAmount: string;
};

export function accountLedgerCsv(
  ledger: AccountLedger<LedgerCsvLine>,
  account: { code: string | null; name: string },
  meta: ReportMeta,
  note?: string,
): string {
  const c = meta.currency;
  const name = account.code ? `${account.code} ${account.name}` : account.name;
  return toCsv([
    ["Company", meta.company],
    ["Report", meta.report],
    ["Account", name],
    ["Period", meta.period],
    ["Currency", meta.currency],
    ...(note ? [["Note", note]] : []),
    [],
    [
      "Date",
      "Entry",
      "Reference",
      "Details",
      "Contact",
      "Debit",
      "Credit",
      "Balance",
      "Original currency",
      "Original amount",
    ],
    [
      null,
      null,
      null,
      "Opening balance",
      null,
      null,
      null,
      csvAmount(ledger.opening, c),
      null,
      null,
    ],
    ...ledger.lines.map((l) => [
      l.date,
      l.entry,
      l.reference,
      l.details,
      l.contact,
      csvAmount(l.debit, c),
      csvAmount(l.credit, c),
      csvAmount(l.balance, c),
      l.currency !== c ? l.currency : null,
      l.currency !== c ? csvAmount(l.currencyAmount, l.currency) : null,
    ]),
    [
      null,
      null,
      null,
      "Total for the period",
      null,
      csvAmount(ledger.totalDebit, c),
      csvAmount(ledger.totalCredit, c),
      null,
      null,
      null,
    ],
    [
      null,
      null,
      null,
      "Closing balance",
      null,
      null,
      null,
      csvAmount(ledger.closing, c),
      null,
      null,
    ],
  ]);
}

export function salesTaxCsv(
  summary: SalesTaxSummary,
  meta: ReportMeta,
  rateLabel: (row: SalesTaxSummary["rows"][number]) => string,
): string {
  const c = meta.currency;
  return toCsv([
    ...header(meta, [
      "Tax",
      "Sales before tax",
      "Tax collected",
      "Purchases before tax",
      "Tax paid",
      "Net tax",
      "Claimable",
    ]),
    ...summary.rows.map((r) => [
      rateLabel(r),
      csvAmount(r.sales, c),
      csvAmount(r.taxCollected, c),
      csvAmount(r.purchases, c),
      csvAmount(r.taxPaid, c),
      csvAmount(r.net, c),
      r.isRecoverable ? "Yes" : "No",
    ]),
    [],
    ["Total collected", csvAmount(summary.totalCollected, c)],
    ["Total claimable", csvAmount(summary.totalClaimable, c)],
    [
      parseDecimal(summary.netOwing) < 0n ? "Refund due" : "Net owing",
      csvAmount(summary.netOwing, c),
    ],
  ]);
}

/** A file name such as "maple-goods-profit-and-loss-2025-07-01-to-2026-06-30.csv". */
export function csvFileName(...parts: string[]): string {
  const slug = parts
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "report"}.csv`;
}

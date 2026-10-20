import "server-only";
import {
  type AccountBalance,
  balanceSheet,
  compareProfitAndLoss,
  comparisonPeriod,
  fiscalYearFor,
  formatDecimal,
  generalLedgerSummary,
  isCompareMode,
  ownerDirections,
  parseDecimal,
  profitAndLoss,
  salesTaxSummary,
  stakeLine,
  trialBalance,
  yourStake,
} from "@bookalyze/core";
import {
  accountBalances,
  accountLedgerLines,
  firstEntryDate,
  ledgerActivity,
  listTaxRates,
  listTaxRegistrations,
  ownerLines,
  salesTaxRows,
  transactionExportLines,
} from "@bookalyze/db";
import { nowIn } from "@/lib/dates";
import { type AccountingContext, inOrg } from "@/server/accounting";
import { fiscalConfigOf } from "@/server/org";
import { filingPeriods, resolveDate, resolveFilingRange, resolveRange } from "./periods";

/**
 * Report data, shared by the report pages and their CSV downloads so both always show the same
 * numbers for the same URL parameters.
 */

export type ReportQuery = {
  from?: string;
  to?: string;
  date?: string;
  account?: string;
  /** Profit and loss: "previous" or "last-year" adds comparison columns. */
  compare?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LEDGER_LINE_LIMIT = 1000;
/** Downloads aren't paged, but stay bounded so one request can't run away. */
export const LEDGER_EXPORT_LIMIT = 50_000;

function setup(ctx: AccountingContext) {
  return { today: nowIn(ctx.profile.timezone).date, cfg: fiscalConfigOf(ctx.profile) };
}

export async function loadProfitAndLoss(ctx: AccountingContext, query: ReportQuery) {
  const { today, cfg } = setup(ctx);
  const { from, to, presets } = resolveRange(query, today, cfg);
  const compare = isCompareMode(query.compare) ? query.compare : "none";
  const prior = compare === "none" ? null : comparisonPeriod(from, to, compare);
  const [pnl, priorPnl] = await inOrg(ctx, async (tx) => [
    profitAndLoss(await accountBalances(tx, { from, to })),
    prior ? profitAndLoss(await accountBalances(tx, prior)) : null,
  ]);
  const comparison =
    priorPnl && prior ? { ...prior, ...compareProfitAndLoss(pnl, priorPnl) } : null;
  return { from, to, presets, pnl, compare, comparison };
}

export async function loadBalanceSheet(ctx: AccountingContext, query: ReportQuery) {
  const { today, cfg } = setup(ctx);
  const { date, presets } = resolveDate(query, today, cfg);
  const fy = fiscalYearFor(date, cfg);
  const bs = await inOrg(ctx, async (tx) =>
    balanceSheet(
      await accountBalances(tx, { to: date }),
      await accountBalances(tx, { from: fy.start, to: date }),
    ),
  );
  return { date, presets, fy, bs };
}

/** Your stake on a day: put in, taken out, worth, by financial year from the first entry. */
export async function loadYourStake(ctx: AccountingContext, query: ReportQuery) {
  const { today, cfg } = setup(ctx);
  const { date, presets } = resolveDate(query, today, cfg);
  const stake = await inOrg(ctx, async (tx) => {
    const first = await firstEntryDate(tx);
    const years: { label: string; from: string; to: string; balances: AccountBalance[] }[] = [];
    if (first && first <= date) {
      let fy = fiscalYearFor(first, cfg);
      for (let guard = 0; guard < 100; guard++) {
        const to = fy.end < date ? fy.end : date;
        years.push({
          label: fy.label,
          from: fy.start,
          to,
          balances: await accountBalances(tx, { from: fy.start, to }),
        });
        if (fy.end >= date) break;
        fy = fiscalYearFor(nextDay(fy.end), cfg);
      }
    }
    return yourStake({ asOf: await accountBalances(tx, { to: date }), years });
  });
  return { date, presets, stake };
}

/**
 * The lines behind Your stake for a period: each owner-account line as put in or taken out (the
 * way its account counts on `date`, the stake's day), filtered to one way or both.
 */
export async function loadStakeLines(
  ctx: AccountingContext,
  query: ReportQuery & { way?: string },
  limit = LEDGER_LINE_LIMIT,
) {
  const { today, cfg } = setup(ctx);
  const { from, to, presets } = resolveRange(query, today, cfg);
  const { date } = resolveDate(query, today, cfg);
  const way = query.way === "in" || query.way === "out" ? query.way : null;
  const { lines, lineCount, asOf } = await inOrg(ctx, async (tx) => ({
    ...(await ownerLines(tx, { from, to }, limit)),
    asOf: await accountBalances(tx, { to: date }),
  }));
  const ways = ownerDirections(asOf);
  const all = lines.map((line) => ({
    ...line,
    ...stakeLine(ways.get(line.accountId), line.amount),
  }));
  const sum = (w: "in" | "out") =>
    formatDecimal(all.filter((l) => l.way === w).reduce((t, l) => t + parseDecimal(l.amount), 0n));
  return {
    from,
    to,
    date,
    presets,
    way,
    lines: way ? all.filter((l) => l.way === way) : all,
    putIn: sum("in"),
    tookOut: sum("out"),
    truncated: lineCount > lines.length,
  };
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function loadTrialBalance(ctx: AccountingContext, query: ReportQuery) {
  const { today, cfg } = setup(ctx);
  const { date, presets } = resolveDate(query, today, cfg);
  const fy = fiscalYearFor(date, cfg);
  const tb = trialBalance(await inOrg(ctx, (tx) => accountBalances(tx, { to: date })));
  return { date, presets, fy, tb };
}

export async function loadGeneralLedger(
  ctx: AccountingContext,
  query: ReportQuery,
  limit = LEDGER_LINE_LIMIT,
) {
  const { today, cfg } = setup(ctx);
  const { from, to, presets } = resolveRange(query, today, cfg);
  const accountId = query.account && UUID.test(query.account) ? query.account : null;
  const data = await inOrg(ctx, async (tx) =>
    accountId
      ? {
          kind: "account" as const,
          ledger: await accountLedgerLines(tx, accountId, { from, to }, limit),
        }
      : {
          kind: "summary" as const,
          summary: generalLedgerSummary(await ledgerActivity(tx, { from, to })),
        },
  );
  return { from, to, presets, accountId, data };
}

export async function loadSalesTax(ctx: AccountingContext, query: ReportQuery) {
  const { today, cfg } = setup(ctx);
  const { rates, registrations } = await inOrg(ctx, async (tx) => ({
    rates: await listTaxRates(tx, { includeArchived: true }),
    registrations: await listTaxRegistrations(tx),
  }));
  const registration = registrations.find((r) => r.isActive) ?? registrations[0];
  const frequency = registration?.filingFrequency ?? "quarterly";
  const presets = filingPeriods(today, cfg, frequency, ctx.profile.locale);
  const { from, to } = resolveFilingRange(query, presets);
  const summary = salesTaxSummary(await inOrg(ctx, (tx) => salesTaxRows(tx, { from, to })));
  return { from, to, presets, rates, registration, summary };
}

/** The accountant's export: every transaction line in the period, in Wave's layout. */
export const TRANSACTIONS_EXPORT_LIMIT = 200_000;
export async function loadTransactionsExport(
  ctx: AccountingContext,
  query: ReportQuery,
  limit = TRANSACTIONS_EXPORT_LIMIT,
) {
  const { today, cfg } = setup(ctx);
  const { from, to, presets } = resolveRange(query, today, cfg);
  const { lines, truncated } = await inOrg(ctx, (tx) =>
    transactionExportLines(tx, { from, to }, limit),
  );
  return { from, to, presets, lines, truncated };
}

/** Where a report's CSV download is, for the same parameters as the page. */
export function exportHref(
  slug: string,
  report:
    | "profit-and-loss"
    | "balance-sheet"
    | "trial-balance"
    | "general-ledger"
    | "sales-tax"
    | "transactions",
  params: Record<string, string>,
): string {
  return `/api/o/${slug}/reports/${report}?${new URLSearchParams(params)}`;
}

/** What a ledger line is about: its own description or the entry's, and who it was with. */
export function ledgerLineDetails(line: {
  description: string | null;
  memo: string | null;
  contactName: string | null;
}): string {
  const parts = [line.description || line.memo, line.contactName].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Journal entry";
}

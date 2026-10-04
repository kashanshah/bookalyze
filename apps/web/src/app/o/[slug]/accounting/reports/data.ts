import "server-only";
import {
  balanceSheet,
  fiscalYearFor,
  generalLedgerSummary,
  profitAndLoss,
  salesTaxSummary,
  trialBalance,
} from "@bookalyze/core";
import {
  accountBalances,
  accountLedgerLines,
  ledgerActivity,
  listTaxRates,
  listTaxRegistrations,
  salesTaxRows,
} from "@bookalyze/db";
import { nowIn } from "@/lib/dates";
import { type AccountingContext, inOrg } from "@/server/accounting";
import { fiscalConfigOf } from "@/server/org";
import { filingPeriods, resolveDate, resolveFilingRange, resolveRange } from "./periods";

/**
 * Report data, shared by the report pages and their CSV downloads so both always show the same
 * numbers for the same URL parameters.
 */

export type ReportQuery = { from?: string; to?: string; date?: string; account?: string };

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
  const pnl = profitAndLoss(await inOrg(ctx, (tx) => accountBalances(tx, { from, to })));
  return { from, to, presets, pnl };
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

/** Where a report's CSV download is, for the same parameters as the page. */
export function exportHref(
  slug: string,
  report: "profit-and-loss" | "balance-sheet" | "trial-balance" | "general-ledger" | "sales-tax",
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

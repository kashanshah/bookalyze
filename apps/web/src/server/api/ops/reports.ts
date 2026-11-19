import "server-only";
import { z } from "zod";
import {
  loadBalanceSheet,
  loadGeneralLedger,
  loadProfitAndLoss,
  loadSalesTax,
  loadTransactionsExport,
  loadTrialBalance,
  loadYourStake,
} from "@/app/o/[slug]/accounting/reports/data";
import { getAccountingContext } from "@/server/accounting";
import { defineOperation } from "../core";
import { company, isoDate } from "./shared";

/**
 * Reports, from the same loaders as Accounting → Reports (and their CSV downloads), so the API
 * always shows the numbers the screens do. Amounts are in the main currency.
 */

const range = {
  from: isoDate("First day (default: start of the current financial year).").optional(),
  to: isoDate("Last day (default: today).").optional(),
};
const asOf = { date: isoDate("As of this day (default: today).").optional() };

/** Drops the screen-only period shortcuts. */
function withoutPresets<T extends { presets?: unknown }>(value: T): Omit<T, "presets"> {
  const { presets: _, ...rest } = value;
  return rest;
}

export const reportOperations = [
  defineOperation({
    name: "profit_and_loss",
    title: "Profit and loss",
    description:
      "Income, cost of sales, gross profit, expenses and net profit for a period, by account. `compare` adds the previous period or the same period last year.",
    access: "read",
    http: "GET /companies/{company}/reports/profit-and-loss",
    input: z.object({
      company,
      ...range,
      compare: z.enum(["previous", "last-year"]).optional(),
    }),
    run: async ({ input }) =>
      withoutPresets(await loadProfitAndLoss(await getAccountingContext(input.company), input)),
  }),

  defineOperation({
    name: "balance_sheet",
    title: "Balance sheet",
    description:
      "Assets, liabilities and equity as of a day, with this year's profit and earlier years' profit folded into equity.",
    access: "read",
    http: "GET /companies/{company}/reports/balance-sheet",
    input: z.object({ company, ...asOf }),
    run: async ({ input }) =>
      withoutPresets(await loadBalanceSheet(await getAccountingContext(input.company), input)),
  }),

  defineOperation({
    name: "trial_balance",
    title: "Trial balance",
    description: "Every account's debit or credit balance as of a day; the totals agree.",
    access: "read",
    http: "GET /companies/{company}/reports/trial-balance",
    input: z.object({ company, ...asOf }),
    run: async ({ input }) =>
      withoutPresets(await loadTrialBalance(await getAccountingContext(input.company), input)),
  }),

  defineOperation({
    name: "general_ledger",
    title: "General ledger",
    description:
      "Without `accountId`: each account's opening balance, debits, credits and closing balance for the period. With `accountId`: that account's lines (up to 1,000) with a running balance.",
    access: "read",
    http: "GET /companies/{company}/reports/general-ledger",
    input: z.object({ company, ...range, accountId: z.uuid().optional() }),
    run: async ({ input }) =>
      withoutPresets(
        await loadGeneralLedger(await getAccountingContext(input.company), {
          ...input,
          account: input.accountId,
        }),
      ),
  }),

  defineOperation({
    name: "sales_tax_report",
    title: "Sales tax report",
    description:
      "Sales tax collected and paid (recoverable) by rate for a filing period, and what's owed, as on Reports → Sales tax.",
    access: "read",
    http: "GET /companies/{company}/reports/sales-tax",
    input: z.object({ company, ...range }),
    run: async ({ input }) =>
      withoutPresets(await loadSalesTax(await getAccountingContext(input.company), input)),
  }),

  defineOperation({
    name: "owner_stake",
    title: "Your stake",
    description:
      "The owners' view: what they put in, took out and what their stake is worth as of a day, year by year.",
    access: "read",
    http: "GET /companies/{company}/reports/your-stake",
    input: z.object({ company, ...asOf }),
    run: async ({ input }) =>
      withoutPresets(await loadYourStake(await getAccountingContext(input.company), input)),
  }),

  defineOperation({
    name: "transactions_report",
    title: "Account transactions (accountant's export)",
    description:
      "Every transaction line in a period in Wave's export layout (date, account, description, debit, credit, contact…), as Reports → Account transactions downloads. Up to 200,000 lines; `truncated` says if there were more.",
    access: "read",
    http: "GET /companies/{company}/reports/transactions",
    input: z.object({ company, ...range }),
    run: async ({ input }) =>
      withoutPresets(
        await loadTransactionsExport(await getAccountingContext(input.company), input),
      ),
  }),
];

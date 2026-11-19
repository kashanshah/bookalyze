import "server-only";
import { formatEntryNumber, type TransactionRow } from "@bookalyze/db";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";

/** Input pieces shared by the operations. Query strings arrive as text, so numbers coerce. */

export const company = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe('The company\'s slug, from list_companies (e.g. "kazomo-ca").');

export const id = (what: string) => z.uuid(`Not a valid ${what} ID.`).describe(`The ${what}'s ID.`);

export const isoDate = (description: string) =>
  z.string().refine(isIsoDate, "Use a date like 2026-11-30.").describe(description);

export const amount = (description: string) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,15}(\.\d{1,4})?$/, "Use a plain decimal like 1250.00 (no commas or symbols).")
    .describe(description);

export const boolish = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
);

export const page = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("How many to return (1–500, default 100)."),
  offset: z.coerce.number().int().min(0).default(0).describe("How many to skip, for paging."),
};

/** A transaction as the API shows it: what the Transactions screen shows for one row. */
export function transactionOut(row: TransactionRow) {
  return {
    id: row.id,
    number: formatEntryNumber(row.entryNumber),
    date: row.date,
    kind: row.view.kind,
    amount: row.view.amount,
    currency: row.currency,
    fxRate: row.fxRate,
    memo: row.memo,
    notes: row.notes,
    reference: row.reference,
    source: row.source,
    contactId: row.contactId,
    reviewed: row.reviewed,
    reconciledThrough: row.reconciledThrough,
    attachments: row.attachments,
    moneyAccountIds: row.view.moneyAccountIds,
    fromAccountId: row.view.fromAccountId ?? null,
    toAccountId: row.view.toAccountId ?? null,
    receivedAmount: row.view.receivedAmount ?? null,
    receivedCurrency: row.view.receivedCurrency ?? null,
    needsAccount: Boolean(row.view.needsAccount),
    splits: row.view.splits.map((s) => ({
      accountId: s.accountId,
      amount: s.amount,
      description: s.description ?? null,
      taxRateId: s.taxRateId ?? null,
    })),
  };
}

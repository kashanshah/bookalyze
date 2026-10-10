import { decimalPlaces, isDecimal } from "@bookalyze/core";
import { getCurrency } from "@bookalyze/core/reference-data";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => v || null);

const isoDate = (message: string) => z.string().refine(isIsoDate, message);

export const purchaseLineSchema = z.object({
  productId: z.uuid("Choose a product."),
  quantity: z.coerce
    .number({ message: "Enter how many." })
    .int("Use a whole number.")
    .min(1, "At least 1.")
    .max(10_000_000, "That's more than one order can hold."),
  unitCost: z
    .string()
    .trim()
    .refine((v) => isDecimal(v) && !v.startsWith("-"), "Enter the cost of one, e.g. 2.45.")
    .refine((v) => !isDecimal(v) || decimalPlaces(v) <= 10, "Use at most 10 decimal places."),
});

export const purchaseOrderSchema = z
  .object({
    supplierId: z.uuid("Choose a supplier."),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => Boolean(getCurrency(c)), "Choose a currency."),
    orderDate: isoDate("Choose the order date."),
    expectedDate: z
      .string()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || isIsoDate(v), "Choose a date, or leave it empty."),
    reference: optionalText(80, "Keep the reference under 80 characters."),
    notes: optionalText(2000, "Keep notes under 2,000 characters."),
    lines: z
      .array(purchaseLineSchema)
      .min(1, "Add at least one product.")
      .max(200, "Split this into two orders (200 lines at most)."),
  })
  .refine((v) => v.expectedDate === null || v.expectedDate >= v.orderDate, {
    path: ["expectedDate"],
    message: "Expected on or after the order date.",
  });
export type PurchaseOrderFormInput = z.input<typeof purchaseOrderSchema>;

/** "1 USD = 1.3650 CAD": optional (only asked for another currency), positive, 10 places. */
export const rateSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .refine(
    (v) => v === null || (isDecimal(v) && !v.startsWith("-") && Number(v) > 0),
    "Enter the rate, e.g. 1.365.",
  )
  .refine((v) => v === null || !isDecimal(v) || decimalPlaces(v) <= 10, "Use at most 10 decimals.");

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => Boolean(getCurrency(c)), "Choose a currency.");

export const receiveSchema = z.object({
  receivedOn: isoDate("Choose the day it arrived."),
  exchangeRate: rateSchema,
  notes: optionalText(500, "Keep the note under 500 characters."),
  quantities: z.record(
    z.uuid(),
    z.coerce.number().int("Use a whole number.").min(0, "Use 0 or more."),
  ),
});
export type ReceiveFormInput = z.input<typeof receiveSchema>;

export const deliveryCostSchema = z
  .object({
    kind: z.enum(["freight", "duty", "brokerage", "prep", "other"], "Choose what it was for."),
    description: optionalText(120, "Keep it under 120 characters."),
    amount: z
      .string()
      .trim()
      .refine((v) => isDecimal(v) && !v.startsWith("-") && Number(v) > 0, "Enter the amount.")
      .refine((v) => !isDecimal(v) || decimalPlaces(v) <= 4, "Use at most 4 decimal places."),
    currency: currencySchema,
    exchangeRate: rateSchema,
    allocation: z.enum(["units", "value", "weight"], "Choose how to split it."),
    contactId: z
      .string()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose who it was paid to."),
  })
  .refine((v) => decimalPlaces(v.amount) <= Math.max(getCurrency(v.currency)?.minorUnits ?? 2, 0), {
    path: ["amount"],
    message: "Too many decimals for this currency.",
  });

export const deliveryCostsSchema = z.object({
  exchangeRate: rateSchema,
  costs: z.array(deliveryCostSchema).max(20, "Up to 20 costs per delivery."),
});
export type DeliveryCostsFormInput = z.input<typeof deliveryCostsSchema>;

const positiveAmount = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => isDecimal(v) && !v.startsWith("-") && Number(v) > 0, message)
    .refine((v) => !isDecimal(v) || decimalPlaces(v) <= 4, "Use at most 4 decimal places.");

/** A payment plan: parts, each a percentage of the order or a fixed amount. */
export const paymentPlanSchema = z
  .array(
    z.object({
      label: z.string().trim().max(60, "Keep it under 60 characters."),
      kind: z.enum(["percent", "amount"]),
      value: positiveAmount("Enter a percentage or an amount."),
    }),
  )
  .max(12, "Up to 12 parts.");
export type PaymentPlanInput = z.input<typeof paymentPlanSchema>;

/** A payment toward a purchase order: a new bank transaction, or one already in the books. */
export const purchasePaymentSchema = z
  .object({
    mode: z.enum(["new", "existing"]),
    /** Who was paid; empty for the supplier. */
    contactId: z
      .string()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose who was paid."),
    receiptId: z
      .string()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose the delivery."),
    label: optionalText(60, "Keep it under 60 characters."),
    /** For this order, in the currency owed. */
    amount: positiveAmount("Enter how much of it was for this order."),
    currency: currencySchema.optional(),
    // A transaction already in the books.
    journalEntryId: z
      .string()
      .optional()
      .transform((v) => v || null),
    // A new one.
    date: z.string().optional().default(""),
    moneyAccountId: z.string().optional().default(""),
    /** What left the bank account, in its currency. */
    bankAmount: z.string().trim().optional().default(""),
    fxRate: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "existing") {
      if (!v.journalEntryId || !z.uuid().safeParse(v.journalEntryId).success) {
        ctx.addIssue({
          code: "custom",
          path: ["journalEntryId"],
          message: "Choose the transaction.",
        });
      }
      return;
    }
    if (!isIsoDate(v.date)) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Choose the day it was paid." });
    }
    if (!z.uuid().safeParse(v.moneyAccountId).success) {
      ctx.addIssue({
        code: "custom",
        path: ["moneyAccountId"],
        message: "Choose the account it was paid from.",
      });
    }
    if (!(isDecimal(v.bankAmount) && Number(v.bankAmount) > 0 && !v.bankAmount.startsWith("-"))) {
      ctx.addIssue({
        code: "custom",
        path: ["bankAmount"],
        message: "Enter what left the account.",
      });
    }
  });
export type PurchasePaymentInput = z.input<typeof purchasePaymentSchema>;

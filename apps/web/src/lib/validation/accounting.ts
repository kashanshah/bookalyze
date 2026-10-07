import {
  canHoldOneCurrency,
  FILING_FREQUENCIES,
  getAccountSubtype,
  isAccountSubtype,
  isAccountType,
  isValidTaxRate,
} from "@bookalyze/core";
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

const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => Boolean(getCurrency(c)), "Choose a currency.");

export const accountSchema = z
  .object({
    id: z
      .uuid()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    name: z
      .string()
      .trim()
      .min(1, "Give the account a name.")
      .max(120, "Keep the name under 120 characters."),
    code: optionalText(20, "Keep the code under 20 characters.").refine(
      (v) => v === null || /^[A-Za-z0-9.-]+$/.test(v),
      "Use letters, numbers, dots or dashes.",
    ),
    type: z.string().refine(isAccountType, "Choose a type."),
    subtype: z.string().refine(isAccountSubtype, "Choose what this account is for."),
    description: optionalText(300, "Keep the description under 300 characters."),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .transform((v) => v || null)
      .refine((c) => c === null || Boolean(getCurrency(c)), "Choose a currency."),
  })
  .superRefine((value, ctx) => {
    const subtype = getAccountSubtype(value.subtype);
    if (subtype && subtype.type !== value.type) {
      ctx.addIssue({
        code: "custom",
        path: ["subtype"],
        message: "Choose what this account is for.",
      });
    }
    if (subtype?.needsCurrency && !value.currency) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Bank and card accounts hold one currency. Choose it.",
      });
    }
  })
  // Categories (income, expenses, equity) take any currency.
  .transform((value) => (canHoldOneCurrency(value.type) ? value : { ...value, currency: null }));

export type AccountInput = z.input<typeof accountSchema>;

export const journalEntrySchema = z.object({
  date: z.string().refine(isIsoDate, "Choose a date."),
  reference: optionalText(60, "Keep the reference under 60 characters."),
  memo: optionalText(500, "Keep the description under 500 characters."),
  currency: currencyCode,
  fxRate: z.string().trim().max(30).optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().trim().max(64),
        description: z
          .string()
          .trim()
          .max(200, "Keep line descriptions under 200 characters.")
          .optional(),
        debit: z.string().trim().max(24).optional(),
        credit: z.string().trim().max(24).optional(),
      }),
    )
    .min(1, "Add at least two lines.")
    .max(200, "An entry can have at most 200 lines."),
});

export type JournalEntryFormInput = z.input<typeof journalEntrySchema>;

const amountText = z.string().trim().max(24);

export const transactionSchema = z.object({
  id: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  kind: z.enum(["deposit", "withdrawal", "transfer"]),
  date: z.string().refine(isIsoDate, "Choose a date."),
  memo: optionalText(500, "Keep the description under 500 characters."),
  fxRate: z.string().trim().max(30).optional(),
  moneyAccountId: z.string().trim().max(64).optional(),
  splits: z
    .array(
      z.object({
        accountId: z.string().trim().max(64),
        amount: amountText,
        description: z.string().trim().max(200).optional(),
        /** Sales tax included in the amount. Empty for none. */
        taxRateId: z.string().trim().max(64).optional(),
      }),
    )
    .max(50, "A transaction can have at most 50 categories.")
    .optional(),
  fromAccountId: z.string().trim().max(64).optional(),
  toAccountId: z.string().trim().max(64).optional(),
  amount: amountText.optional(),
  /** Transfers between currencies: what arrived, in the receiving account's currency. */
  received: amountText.optional(),
  /** Receipts uploaded while creating the transaction, attached once it's saved. */
  attachmentIds: z.array(z.uuid()).max(50).optional(),
  /** The customer (money in) or vendor (money out). Empty for none. */
  contactId: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type TransactionFormInput = z.input<typeof transactionSchema>;

export const contactSchema = z.object({
  id: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  type: z.enum(["customer", "vendor", "both"], "Choose whether they're a customer or a vendor."),
  name: z
    .string()
    .trim()
    .min(1, "Enter their name.")
    .max(200, "Keep the name under 200 characters."),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address."),
  phone: optionalText(50, "Keep the phone number under 50 characters."),
  taxNumber: optionalText(50, "Keep the tax number under 50 characters."),
  address: optionalText(500, "Keep the address under 500 characters."),
  notes: optionalText(2000, "Keep notes under 2,000 characters."),
});

export type ContactInput = z.input<typeof contactSchema>;

export const taxRateSchema = z.object({
  id: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  name: z
    .string()
    .trim()
    .min(1, "Give the rate a name, like “HST 13%”.")
    .max(80, "Keep the name under 80 characters."),
  rate: z
    .string()
    .trim()
    .transform((v) => v.replace(/%$/, "").trim())
    .refine(isValidTaxRate, "Enter a percentage between 0 and 100, like 13 or 9.975."),
  /** An existing sales tax account, or "new" to create one named after the rate. */
  accountId: z.union([z.uuid("Choose where the tax is kept."), z.literal("new")]),
  isRecoverable: z.boolean(),
});

export type TaxRateInput = z.input<typeof taxRateSchema>;

export const taxRegistrationSchema = z.object({
  id: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  authority: z
    .string()
    .trim()
    .min(1, "Enter who you file with, like “Canada Revenue Agency (GST/HST)”.")
    .max(120, "Keep this under 120 characters."),
  registrationNumber: optionalText(40, "Keep the number under 40 characters."),
  filingFrequency: z.enum(FILING_FREQUENCIES, "Choose how often you file."),
  effectiveFrom: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isIsoDate(v), "Choose a date."),
  isActive: z.boolean(),
});

export type TaxRegistrationInput = z.input<typeof taxRegistrationSchema>;

const importKey = z.string().trim().min(1).max(400);

export const startImportSchema = z.object({
  source: z.string().trim().min(1).max(40),
  fileName: z.string().trim().min(1).max(255),
  accounts: z
    .array(
      z.object({
        key: importKey,
        name: z.string().trim().min(1).max(120),
        code: z.string().trim().max(20).optional(),
        subtype: z.string().refine(isAccountSubtype, "Choose where this account goes."),
      }),
    )
    .max(2000),
  contacts: z
    .array(
      z.object({
        key: importKey,
        name: z.string().trim().min(1).max(200),
        role: z.enum(["customer", "vendor", "both"]),
        email: z
          .string()
          .trim()
          .max(254)
          .optional()
          .transform((v) => (v && z.email().safeParse(v).success ? v : undefined)),
        phone: z.string().trim().max(50).optional(),
        taxNumber: z.string().trim().max(50).optional(),
        address: z.string().trim().max(500).optional(),
        notes: z.string().trim().max(2000).optional(),
      }),
    )
    .max(20000),
});

export type StartImportInput = z.input<typeof startImportSchema>;

export const importChunkSchema = z
  .array(
    z.object({
      externalId: importKey,
      date: z.string().refine(isIsoDate, "Invalid date."),
      memo: z.string().max(1000).optional(),
      reference: z.string().max(120).optional(),
      contactId: z.uuid().optional(),
      lines: z
        .array(
          z.object({
            accountId: z.uuid(),
            amount: z.string().trim().max(30),
            description: z.string().max(500).optional(),
          }),
        )
        .min(2)
        .max(500),
    }),
  )
  .max(300);

export type ImportChunkInput = z.input<typeof importChunkSchema>;

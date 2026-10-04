import { getAccountSubtype, isAccountSubtype, isAccountType } from "@bookalyze/core";
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
  });

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

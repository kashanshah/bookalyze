import { validateFiscalYearEnd } from "@bookalyze/core";
import { getCountry, getCurrency, getSubdivision } from "@bookalyze/core/reference-data";
import { z } from "zod";

export const ENTITY_TYPE_OPTIONS = [
  { value: "corporation", label: "Corporation" },
  { value: "sole_proprietorship", label: "Sole proprietorship / establishment" },
  { value: "partnership", label: "Partnership" },
  { value: "llc", label: "LLC" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "other", label: "Other" },
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional()
  .or(z.literal("").transform(() => undefined));

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidLocale(locale: string): boolean {
  try {
    return Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
}

export const orgProfileSchema = z
  .object({
    legalName: z.string().trim().min(2, "Enter the legal name").max(200),
    tradeName: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => v || undefined),
    entityType: z.enum(ENTITY_TYPE_OPTIONS.map((o) => o.value) as [string, ...string[]]),
    countryCode: z
      .string()
      .length(2)
      .refine((c) => Boolean(getCountry(c)), "Unknown country"),
    subdivisionCode: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    baseCurrency: z
      .string()
      .length(3)
      .refine((c) => Boolean(getCurrency(c)), "Unknown currency"),
    timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
    locale: z.string().refine(isValidLocale, "Unknown locale"),
    fiscalYearEndMonth: z.coerce.number().int(),
    fiscalYearEndDay: z.coerce.number().int(),
    incorporationDate: isoDate,
    firstFiscalYearStart: isoDate,
  })
  .superRefine((v, ctx) => {
    if (v.subdivisionCode) {
      const sub = getSubdivision(v.subdivisionCode);
      if (!sub || sub.countryCode !== v.countryCode) {
        ctx.addIssue({
          code: "custom",
          path: ["subdivisionCode"],
          message: "Pick a region in the selected country",
        });
      }
    }
    const fyError = validateFiscalYearEnd(v.fiscalYearEndMonth, v.fiscalYearEndDay);
    if (fyError) ctx.addIssue({ code: "custom", path: ["fiscalYearEndDay"], message: fyError });
  });

export type OrgProfileInput = z.infer<typeof orgProfileSchema>;

export type FieldErrors = Partial<Record<string, string>>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    out[key] ??= issue.message;
  }
  return out;
}

/** Preferred default timezone per country when a country has several. */
const PREFERRED_TIMEZONE: Record<string, string> = {
  CA: "America/Toronto",
  US: "America/New_York",
  AU: "Australia/Sydney",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  RU: "Europe/Moscow",
  ID: "Asia/Jakarta",
  CN: "Asia/Shanghai",
  GB: "Europe/London",
  ES: "Europe/Madrid",
  PT: "Europe/Lisbon",
  DE: "Europe/Berlin",
  KZ: "Asia/Almaty",
  NZ: "Pacific/Auckland",
};

export function defaultTimezone(countryCode: string): string {
  const country = getCountry(countryCode);
  return PREFERRED_TIMEZONE[countryCode] ?? country?.timezones[0] ?? "UTC";
}

export function defaultLocale(countryCode: string): string {
  const candidate = `en-${countryCode}`;
  return isValidLocale(candidate) ? candidate : "en";
}

export const LOCALE_OPTIONS = [
  "en-CA",
  "fr-CA",
  "en-US",
  "en-GB",
  "en-AE",
  "ar-AE",
  "en-PK",
  "ur-PK",
  "en-IN",
  "en-AU",
  "en-NZ",
  "en-SG",
  "de-DE",
  "fr-FR",
  "es-ES",
  "es-MX",
  "it-IT",
  "nl-NL",
  "pt-BR",
  "ar-SA",
  "tr-TR",
  "ja-JP",
  "zh-CN",
];

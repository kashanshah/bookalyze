import {
  BRAND_FOOTER_MAX,
  BRAND_NAME_MAX,
  type BrandSettings,
  INVOICE_AFFIX_MAX,
  isValidInvoiceAffix,
  LETTERHEAD_MARGIN_MAX,
  LETTERHEAD_PAGES,
  LETTERHEAD_SIDE_MAX,
  LOGO_HEIGHT_MAX,
  LOGO_HEIGHT_MIN,
  normalizeHexColor,
} from "@bookalyze/core";
import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const margin = z.coerce
  .number()
  .int("Use whole points.")
  .min(0, "Use 0 or more.")
  .max(LETTERHEAD_MARGIN_MAX, `Use ${LETTERHEAD_MARGIN_MAX} or less.`);

const sideMargin = z.coerce
  .number()
  .int("Use whole points.")
  .min(0, "Use 0 or more.")
  .max(LETTERHEAD_SIDE_MAX, `Use ${LETTERHEAD_SIDE_MAX} or less.`);

const affix = z
  .string()
  .max(INVOICE_AFFIX_MAX, `Use ${INVOICE_AFFIX_MAX} characters or fewer.`)
  .refine(isValidInvoiceAffix, "Use letters, numbers, spaces, - _ . / # and {YYYY}, {YY} or {MM}.");

/** What Company → Brand saves (and the preview draws before saving). */
export const brandSchema = z.object({
  accentColor: z
    .string()
    .trim()
    .refine((v) => v === "" || normalizeHexColor(v) !== null, "Use a colour like #1F6FEB.")
    .transform((v) => (v ? normalizeHexColor(v) : null)),
  footer: optionalText(BRAND_FOOTER_MAX),
  nameArabic: optionalText(BRAND_NAME_MAX),
  logoAttachmentId: z.uuid().nullable(),
  letterheadAttachmentId: z.uuid().nullable(),
  letterheadTop: margin,
  letterheadBottom: margin,
  letterheadLeft: sideMargin,
  letterheadRight: sideMargin,
  letterheadPages: z.enum(LETTERHEAD_PAGES),
  invoicePrefix: affix,
  invoiceSuffix: affix,
  logoHeight: z.coerce
    .number()
    .int("Use whole points.")
    .min(LOGO_HEIGHT_MIN, `Use ${LOGO_HEIGHT_MIN} or more.`)
    .max(LOGO_HEIGHT_MAX, `Use ${LOGO_HEIGHT_MAX} or less.`),
});

export type BrandInput = z.input<typeof brandSchema>;
export type BrandParsed = z.output<typeof brandSchema> & BrandSettings;

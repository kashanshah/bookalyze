import { formatDecimal, parseDecimal } from "../money";

/**
 * When a business that isn't registered for sales tax has to register, by country. Amounts are
 * taxable sales over the last 12 months, in the country's currency.
 */
export type VatThreshold = {
  country: string;
  currency: string;
  taxName: string;
  authority: string;
  /** Registration is required at this amount. */
  mandatory: string;
  /** Registration is allowed (not required) from this amount; null where anyone may register. */
  voluntary: string | null;
  /** How the rule reads, for the hint. */
  rule: string;
};

export const VAT_THRESHOLDS: Record<string, VatThreshold> = {
  AE: {
    country: "AE",
    currency: "AED",
    taxName: "VAT",
    authority: "the FTA",
    mandatory: "375000",
    voluntary: "187500",
    rule: "Register within 30 days of taxable sales passing AED 375,000 over the last 12 months, or of expecting to in the next 30 days.",
  },
  SA: {
    country: "SA",
    currency: "SAR",
    taxName: "VAT",
    authority: "ZATCA",
    mandatory: "375000",
    voluntary: "187500",
    rule: "Register within 30 days of taxable sales passing SAR 375,000 over the last 12 months, or of expecting to in the next 12.",
  },
  CA: {
    country: "CA",
    currency: "CAD",
    taxName: "GST/HST",
    authority: "the CRA",
    mandatory: "30000",
    voluntary: null,
    rule: "Small suppliers stop qualifying once taxable sales pass CAD 30,000 over four calendar quarters in a row (or in one quarter).",
  },
};

/** Warn from this share of the mandatory threshold. */
export const VAT_THRESHOLD_WARN_PERCENT = 80;

export type VatThresholdStatus = {
  threshold: VatThreshold;
  /** Sales over the last 12 months, in the threshold's currency. */
  sales: string;
  /** Sales as a whole-number share of the mandatory threshold. */
  percent: number;
  /** "over": registration is due; "approaching": past the warning line; "voluntary": may register. */
  level: "over" | "approaching" | "voluntary";
};

/**
 * Where an unregistered company stands against its country's registration threshold, or null
 * when there's nothing to say (registered, no rule for the country, or well below it).
 */
export function vatThresholdStatus(input: {
  country: string;
  registered: boolean;
  /** Sales over the last 12 months, in the country's currency (VAT_THRESHOLDS[country].currency). */
  sales: string;
}): VatThresholdStatus | null {
  const threshold = VAT_THRESHOLDS[input.country];
  if (!threshold || input.registered) return null;
  const sales = parseDecimal(input.sales);
  const mandatory = parseDecimal(threshold.mandatory);
  const percent = Number((sales * 100n) / mandatory);
  const result = (level: VatThresholdStatus["level"]): VatThresholdStatus => ({
    threshold,
    sales: formatDecimal(sales),
    percent,
    level,
  });
  if (sales >= mandatory) return result("over");
  if (percent >= VAT_THRESHOLD_WARN_PERCENT) return result("approaching");
  if (threshold.voluntary && sales >= parseDecimal(threshold.voluntary)) return result("voluntary");
  return null;
}

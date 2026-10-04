import {
  AMOUNT_SCALE,
  divRound,
  formatDecimal,
  isDecimal,
  parseDecimal,
  roundUnits,
} from "../money";

/**
 * Sales tax (GST/HST, VAT…). Amounts on transactions include tax, the way they appear on a bank
 * statement or receipt; the tax is split out onto the rate's tax account. Tax collected on sales
 * is owed; tax paid on purchases is claimed back when the rate is recoverable (input tax credits).
 */

export type TaxRateInfo = {
  id: string;
  name: string;
  /** Percent, e.g. "13" or "9.975". */
  rate: string;
  /** Liability account where collected and claimable tax is kept. */
  accountId: string;
  /** Whether tax paid on purchases can be claimed back (most GST/HST and VAT can). */
  isRecoverable: boolean;
};

export const FILING_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;
export type FilingFrequency = (typeof FILING_FREQUENCIES)[number];

export const FILING_FREQUENCY_LABELS: Record<FilingFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Once a year",
};

/** Whether `value` is a valid rate percentage between 0 and 100 with up to 4 decimals. */
export function isValidTaxRate(value: string): boolean {
  if (!isDecimal(value)) return false;
  try {
    const units = parseDecimal(value, AMOUNT_SCALE);
    return units >= 0n && units <= 100n * 10n ** BigInt(AMOUNT_SCALE);
  } catch {
    return false;
  }
}

/**
 * Splits a tax-inclusive amount (units at AMOUNT_SCALE, signed) into the amount before tax and
 * the tax, rounding the tax to `decimals` places. net + tax always equals the original amount.
 */
export function splitTaxIncluded(
  amountUnits: bigint,
  ratePercent: string,
  decimals: number,
): { net: bigint; tax: bigint } {
  const rate = parseDecimal(ratePercent, AMOUNT_SCALE);
  if (rate === 0n) return { net: amountUnits, tax: 0n };
  const hundred = 100n * 10n ** BigInt(AMOUNT_SCALE);
  const tax = roundUnits(divRound(amountUnits * rate, hundred + rate), decimals);
  return { net: amountUnits - tax, tax };
}

export type TaxPackRate = {
  key: string;
  name: string;
  rate: string;
  isRecoverable: boolean;
  /** Which of the pack's accounts holds this tax. */
  account: string;
  hint?: string;
};

export type TaxPack = {
  key: string;
  label: string;
  country: string;
  /** The tax authority and what it calls the return, for registrations. */
  authority: string;
  accounts: { key: string; code: string; name: string }[];
  rates: TaxPackRate[];
  /** Rates to switch on first for a region (ISO 3166-2), when the pack knows it. */
  defaultsBySubdivision?: Record<string, string[]>;
};

/**
 * Ready-made setups. Rates change rarely but do change: they're starting points the company can
 * edit, and are stored per company (changing a pack never changes saved rates).
 */
export const TAX_PACKS: TaxPack[] = [
  {
    key: "ca-gst-hst",
    label: "Canada: GST/HST",
    country: "CA",
    authority: "Canada Revenue Agency (GST/HST)",
    accounts: [
      { key: "gst_hst", code: "2200", name: "GST/HST payable" },
      { key: "qst", code: "2210", name: "QST payable" },
      { key: "pst", code: "2220", name: "PST payable" },
    ],
    rates: [
      {
        key: "hst-13",
        name: "HST 13% (Ontario)",
        rate: "13",
        isRecoverable: true,
        account: "gst_hst",
      },
      {
        key: "gst-5",
        name: "GST 5%",
        rate: "5",
        isRecoverable: true,
        account: "gst_hst",
        hint: "Alberta, BC, Manitoba, Quebec, Saskatchewan and the territories.",
      },
      {
        key: "hst-15",
        name: "HST 15% (NB, NL, PE)",
        rate: "15",
        isRecoverable: true,
        account: "gst_hst",
      },
      {
        key: "hst-14",
        name: "HST 14% (Nova Scotia)",
        rate: "14",
        isRecoverable: true,
        account: "gst_hst",
      },
      {
        key: "zero-rated",
        name: "Zero-rated 0%",
        rate: "0",
        isRecoverable: true,
        account: "gst_hst",
        hint: "Exports and other zero-rated supplies. Still reported on your return.",
      },
      {
        key: "qst-9975",
        name: "QST 9.975% (Quebec)",
        rate: "9.975",
        isRecoverable: true,
        account: "qst",
      },
      {
        key: "pst-bc-7",
        name: "PST 7% (British Columbia)",
        rate: "7",
        isRecoverable: false,
        account: "pst",
        hint: "Provincial sales tax can't be claimed back.",
      },
    ],
    defaultsBySubdivision: {
      "CA-ON": ["hst-13", "gst-5", "zero-rated"],
      "CA-NS": ["hst-14", "gst-5", "zero-rated"],
      "CA-NB": ["hst-15", "gst-5", "zero-rated"],
      "CA-NL": ["hst-15", "gst-5", "zero-rated"],
      "CA-PE": ["hst-15", "gst-5", "zero-rated"],
      "CA-QC": ["gst-5", "qst-9975", "zero-rated"],
      "CA-BC": ["gst-5", "pst-bc-7", "zero-rated"],
    },
  },
  {
    key: "ae-vat",
    label: "United Arab Emirates: VAT",
    country: "AE",
    authority: "Federal Tax Authority (VAT)",
    accounts: [{ key: "vat", code: "2200", name: "VAT payable" }],
    rates: [
      { key: "vat-5", name: "VAT 5%", rate: "5", isRecoverable: true, account: "vat" },
      {
        key: "zero-rated",
        name: "Zero-rated 0%",
        rate: "0",
        isRecoverable: true,
        account: "vat",
        hint: "Exports and other zero-rated supplies.",
      },
    ],
  },
];

/** The pack for a country, if there is one. */
export function taxPackFor(country: string): TaxPack | undefined {
  return TAX_PACKS.find((p) => p.country === country);
}

/** The pack's rates to switch on for a region: its defaults, or every rate. */
export function defaultPackRates(
  pack: TaxPack,
  subdivision: string | null | undefined,
): TaxPackRate[] {
  const keys = (subdivision && pack.defaultsBySubdivision?.[subdivision]) || null;
  return keys ? pack.rates.filter((r) => keys.includes(r.key)) : pack.rates;
}

export type SalesTaxRow = {
  taxRateId: string;
  name: string;
  rate: string;
  isRecoverable: boolean;
  /** Base-currency totals for the period, all positive. */
  sales: string;
  taxCollected: string;
  purchases: string;
  taxPaid: string;
};

export type SalesTaxSummary = {
  rows: (SalesTaxRow & { net: string })[];
  totalCollected: string;
  /** Tax paid on purchases that can be claimed back (recoverable rates only). */
  totalClaimable: string;
  /** Positive: owed to the tax authority. Negative: a refund is due. */
  netOwing: string;
};

/** Totals per rate and the net amount owed (or refunded) for a filing period. */
export function salesTaxSummary(rows: SalesTaxRow[]): SalesTaxSummary {
  let collected = 0n;
  let claimable = 0n;
  const out = rows.map((r) => {
    const c = parseDecimal(r.taxCollected);
    const p = r.isRecoverable ? parseDecimal(r.taxPaid) : 0n;
    collected += c;
    claimable += p;
    return { ...r, net: formatDecimal(c - p) };
  });
  return {
    rows: out,
    totalCollected: formatDecimal(collected),
    totalClaimable: formatDecimal(claimable),
    netOwing: formatDecimal(collected - claimable),
  };
}

/** A stored rate as people write it: "13.0000" → "13", "9.9750" → "9.975". */
export function formatTaxRate(rate: string): string {
  return rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
}

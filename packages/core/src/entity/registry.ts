/**
 * Reference lists for the Entity & compliance module: where a company can be incorporated, the
 * registration numbers it may hold, and the roles people play in it.
 */

export type Jurisdiction = {
  code: string;
  label: string;
  country: string;
  /** Short explanation shown under the choice. */
  hint?: string;
};

export const JURISDICTIONS: readonly Jurisdiction[] = [
  {
    code: "CA-FED",
    label: "Canada (federal, CBCA)",
    country: "CA",
    hint: "Incorporated with Corporations Canada.",
  },
  {
    code: "CA-ON",
    label: "Ontario (OBCA)",
    country: "CA",
    hint: "Incorporated with the Ontario Business Registry.",
  },
  { code: "CA-BC", label: "British Columbia", country: "CA" },
  { code: "CA-AB", label: "Alberta", country: "CA" },
  { code: "CA-QC", label: "Quebec", country: "CA" },
  { code: "CA-OTHER", label: "Another Canadian province or territory", country: "CA" },
  {
    code: "AE-DU",
    label: "Dubai (DET)",
    country: "AE",
    hint: "Licensed by Dubai Economy and Tourism, e.g. an e-Trader license.",
  },
  { code: "AE-OTHER", label: "Another emirate or free zone", country: "AE" },
  { code: "PK", label: "Pakistan (SECP)", country: "PK" },
  { code: "OTHER", label: "Somewhere else", country: "" },
];

export function jurisdictionLabel(code: string | null | undefined): string | null {
  return JURISDICTIONS.find((j) => j.code === code)?.label ?? null;
}

export type IdentifierKind = {
  key: string;
  label: string;
  /** Countries it's offered for; empty for everywhere. */
  countries: readonly string[];
  /** Whether it has an expiry date (licenses do). */
  expires?: boolean;
  hint?: string;
};

export const IDENTIFIER_KINDS: readonly IdentifierKind[] = [
  {
    key: "ca_bn",
    label: "Business Number (BN)",
    countries: ["CA"],
    hint: "The 9 digits the CRA gave the company.",
  },
  { key: "ca_corp_no", label: "Corporation number (federal)", countries: ["CA"] },
  { key: "ca_ocn", label: "Ontario Corporation Number (OCN)", countries: ["CA"] },
  { key: "ca_gst", label: "GST/HST program account (RT)", countries: ["CA"] },
  { key: "ca_payroll", label: "Payroll program account (RP)", countries: ["CA"] },
  {
    key: "ae_trade_license",
    label: "Trade license number",
    countries: ["AE"],
    expires: true,
    hint: "Add the expiry date and the renewal goes on the calendar.",
  },
  { key: "ae_cr", label: "Commercial register number", countries: ["AE"] },
  { key: "ae_trn", label: "VAT tax registration number (TRN)", countries: ["AE"] },
  {
    key: "ae_ct_trn",
    label: "Corporate tax registration number",
    countries: ["AE"],
    hint: "Once registered, the corporate tax return goes on the calendar.",
  },
  { key: "pk_ntn", label: "National Tax Number (NTN)", countries: ["PK"] },
  { key: "pk_strn", label: "Sales Tax Registration Number (STRN)", countries: ["PK"] },
  { key: "other", label: "Something else", countries: [], expires: true },
];

export function identifierKind(key: string): IdentifierKind | undefined {
  return IDENTIFIER_KINDS.find((k) => k.key === key);
}

/** The kinds worth offering a company in `country` (its own first, then the general one). */
export function identifierKindsFor(country: string): IdentifierKind[] {
  return IDENTIFIER_KINDS.filter((k) => !k.countries.length || k.countries.includes(country));
}

export const PERSON_ROLES = [
  { key: "director", label: "Director" },
  { key: "officer", label: "Officer" },
  { key: "shareholder", label: "Shareholder or owner" },
  { key: "significant_control", label: "Individual with significant control" },
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number]["key"];

export const DOCUMENT_KINDS = [
  { key: "license", label: "License" },
  { key: "articles", label: "Articles or certificate of incorporation" },
  { key: "registration", label: "Registration or tax certificate" },
  { key: "filing", label: "Filing or annual return" },
  { key: "agreement", label: "Agreement or contract" },
  { key: "other", label: "Other" },
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]["key"];

export const COMPLIANCE_RECURRENCES = [
  { key: "once", label: "Once" },
  { key: "monthly", label: "Every month" },
  { key: "quarterly", label: "Every 3 months" },
  { key: "yearly", label: "Every year" },
] as const;
export type ComplianceRecurrence = (typeof COMPLIANCE_RECURRENCES)[number]["key"];

/** Days before a due date that a reminder email goes out (and on the day itself). */
export const COMPLIANCE_LEAD_DAYS = [30, 7, 1, 0] as const;

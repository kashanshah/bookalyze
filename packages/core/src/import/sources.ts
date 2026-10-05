import type { AccountSubtype } from "../accounting/accounts";

/**
 * Where an import comes from. Every source is read the same way: a CSV of journal lines (one row
 * per line of a transaction) whose columns are mapped to the fields below. A source only adds
 * export instructions and the column names its software uses, so supporting new software is a
 * matter of adding an entry here, not new code.
 */

export const IMPORT_FIELDS = [
  { key: "date", label: "Date", required: true },
  {
    key: "entryRef",
    label: "Transaction ID",
    hint: "Rows with the same ID are one transaction.",
  },
  { key: "account", label: "Account", required: true },
  { key: "accountCode", label: "Account code" },
  { key: "accountType", label: "Account type", hint: "Helps place new accounts on your reports." },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "amount", label: "Amount (one column)", hint: "Use instead of Debit and Credit." },
  { key: "memo", label: "Description" },
  { key: "lineMemo", label: "Line description" },
  { key: "reference", label: "Reference or number" },
  { key: "contact", label: "Customer or vendor" },
  { key: "customer", label: "Customer" },
  { key: "vendor", label: "Vendor" },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

export type ImportSource = {
  key: string;
  label: string;
  /** What to export and where to find it, step by step. */
  steps: string[];
  /** Column names this software uses, per field (case and punctuation don't matter). */
  columns: Partial<Record<ImportFieldKey, string[]>>;
  /** Its transaction IDs are unique across the file, so rows can be grouped by ID alone. */
  uniqueIds?: boolean;
};

/** Column names used across many programs, tried after a source's own. */
const COMMON_COLUMNS: Record<ImportFieldKey, string[]> = {
  date: [
    "date",
    "transaction date",
    "txn date",
    "entry date",
    "journal date",
    "posting date",
    "posted date",
    "gl date",
  ],
  entryRef: [
    "transaction id",
    "id",
    "journal id",
    "journal no",
    "journal number",
    "journal",
    "entry number",
    "entry no",
    "entry id",
    "transaction no",
    "transaction number",
    "txn id",
    "trans no",
    "je number",
    "voucher no",
    "voucher number",
  ],
  account: ["account", "account name", "account title", "gl account", "ledger account", "ledger"],
  accountCode: ["account code", "account number", "account no", "code", "gl code", "account num"],
  accountType: ["account type", "type of account", "account class", "account group", "class"],
  debit: ["debit", "debits", "debit amount", "dr", "debit amount two column approach"],
  credit: ["credit", "credits", "credit amount", "cr", "credit amount two column approach"],
  amount: ["amount", "net", "net amount", "value", "amount one column"],
  memo: [
    "description",
    "transaction description",
    "memo",
    "memo description",
    "narration",
    "details",
    "particulars",
  ],
  lineMemo: ["line description", "transaction line description", "line memo", "line narration"],
  reference: [
    "reference",
    "ref",
    "num",
    "number",
    "doc number",
    "document number",
    "invoice number",
    "bill number",
  ],
  contact: ["name", "contact", "contact name", "payee", "customer vendor", "party"],
  customer: ["customer", "customer name", "client"],
  vendor: ["vendor", "vendor name", "supplier", "supplier name"],
};

export const IMPORT_SOURCES: ImportSource[] = [
  {
    key: "wave",
    label: "Wave",
    steps: [
      "In Wave, open Settings, then Data export.",
      "Under Accounting transactions, choose CSV and export. Wave emails you a download link.",
      "Download the file and add it here. Keep it somewhere private; it has your whole history.",
    ],
    columns: {
      entryRef: ["transaction id"],
      date: ["transaction date"],
      account: ["account name"],
      accountType: ["account type"],
      debit: ["debit amount two column approach"],
      credit: ["credit amount two column approach"],
      amount: ["amount one column"],
      memo: ["transaction description"],
      lineMemo: ["transaction line description"],
      reference: ["invoice number", "bill number"],
      customer: ["customer"],
      vendor: ["vendor"],
    },
    uniqueIds: true,
  },
  {
    key: "quickbooks",
    label: "QuickBooks",
    steps: [
      "In QuickBooks, open Reports and run the Journal report.",
      "Set the dates to cover your whole history (All dates).",
      "Export to Excel, then save the sheet as CSV and add it here.",
    ],
    columns: { reference: ["num"], contact: ["name"], memo: ["memo description"] },
  },
  {
    key: "xero",
    label: "Xero",
    steps: [
      "In Xero, open Accounting, then Reports, and run the Journal Report (or General Ledger Detail).",
      "Choose a date range covering your whole history.",
      "Export to Excel, then save the sheet as CSV and add it here.",
    ],
    columns: { entryRef: ["journal number", "journal"], memo: ["description"] },
  },
  {
    key: "zoho",
    label: "Zoho Books",
    steps: [
      "In Zoho Books, open Reports and run the Journal Report (or General Ledger).",
      "Choose a date range covering your whole history.",
      "Export as CSV and add it here.",
    ],
    columns: {},
  },
  {
    key: "sage",
    label: "Sage",
    steps: [
      "In Sage, run the Audit Trail, Journal or General Ledger report for your whole history.",
      "Export it as CSV (or Excel, then save as CSV) and add it here.",
    ],
    columns: {},
  },
  {
    key: "other",
    label: "Other software",
    steps: [
      "Export a journal or general ledger report as CSV: one row per line of each transaction, with its date, account and amount.",
      "Most programs call it “Journal”, “General ledger detail” or “Audit trail”. A spreadsheet works too.",
    ],
    columns: {},
  },
];

export function importSource(key: string): ImportSource {
  return (IMPORT_SOURCES.find((s) => s.key === key) ?? IMPORT_SOURCES.at(-1)) as ImportSource;
}

/** "Debit Amount (Two Column Approach)" → "debit amount two column approach" */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ColumnMapping = Partial<Record<ImportFieldKey, number>>;

/** Column indexes for each field, from the source's column names and then common ones. */
export function guessColumns(headers: readonly string[], source: ImportSource): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  const find = (names: readonly string[]) => {
    for (const name of names) {
      const index = normalized.findIndex((h, i) => h === name && !used.has(i));
      if (index !== -1) return index;
    }
    return -1;
  };
  // Source-specific names first, for every field, so they win over common ones.
  for (const pass of [source.columns, COMMON_COLUMNS] as const) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field.key] !== undefined) continue;
      const names = pass[field.key];
      if (!names) continue;
      const index = find(names);
      if (index !== -1) {
        mapping[field.key] = index;
        used.add(index);
      }
    }
  }
  // A Debit and Credit pair beats a single Amount column.
  if (mapping.debit !== undefined && mapping.credit !== undefined) delete mapping.amount;
  return mapping;
}

/** Account types named the way different programs name them, in order of precedence. */
const TYPE_RULES: [RegExp, AccountSubtype][] = [
  [/bank (fee|charge|service)|service charge|interest expense/, "operating_expense"],
  [/money in transit|undeposited|clearing/, "money_in_transit"],
  // Wave parks what it can't place in "Unknown Account", an asset: keep it on the balance sheet.
  [/unknown account|suspense/, "other_current_asset"],
  [/cash|bank|chequing|checking|savings|wallet|paypal|stripe balance|wise/, "cash_bank"],
  [/credit card|\bvisa\b|mastercard|\bamex\b|american express/, "credit_card"],
  [/sales tax|\bhst\b|\bgst\b|\bqst\b|\bpst\b|\bvat\b|tax payable/, "sales_tax"],
  [/payroll liabilit|due for payroll|wages payable|source deduction/, "payroll_liability"],
  [/receivable|a r\b|payments from customers/, "accounts_receivable"],
  [/payable|a p\b|payments to vendors/, "accounts_payable"],
  [/inventory|stock on hand/, "inventory"],
  [/accumulated depreciation|depreciation and amortization/, "accumulated_depreciation"],
  [/fixed asset|property|plant|equipment|furniture|vehicle|computer/, "fixed_assets"],
  [/customer prepayment|customer credit|unearned|deferred revenue/, "customer_prepayments"],
  [/prepayment|prepaid|vendor credit|deposit paid/, "vendor_prepayments"],
  [/due to|shareholder loan|owner loan|director loan/, "due_to_owners"],
  [/other long term liabilit|non current liabilit/, "other_long_term_liability"],
  [/loan|line of credit|mortgage|long term liabilit/, "loan"],
  [/retained earnings/, "retained_earnings"],
  [/equity|capital|owner|drawing|contribution|dividend|share/, "owner_equity"],
  [/exchange gain|gain on foreign/, "fx_gain"],
  [/exchange loss|loss on foreign/, "fx_loss"],
  [/uncategori[sz]ed income/, "uncategorized_income"],
  [/uncategori[sz]ed expense|ask my accountant/, "uncategorized_expense"],
  [/discount/, "discount"],
  [/other income|interest income|non operating income/, "other_income"],
  [/cost of goods|cost of sales|direct cost|cogs|purchases/, "cost_of_goods_sold"],
  [/processing fee|merchant fee|stripe fee|paypal fee/, "payment_processing_fee"],
  [/payroll expense|wages|salar/, "payroll_expense"],
  [/income|revenue|sales/, "income"],
  [/non current asset|long term asset/, "other_long_term_asset"],
  [/current asset|short term asset|other asset/, "other_current_asset"],
  [/current liabilit|short term liabilit|other liabilit|liabilit/, "other_current_liability"],
  [/expense|overhead|cost|depreciation/, "operating_expense"],
];

/**
 * Where an account from another program belongs in Bookalyze, from its type (when exported) and
 * then its name. Null when neither says.
 */
export function guessSubtype(type: string | undefined, name: string): AccountSubtype | null {
  for (const text of [type, name]) {
    const t = normalizeHeader(text ?? "");
    if (!t) continue;
    for (const [pattern, subtype] of TYPE_RULES) if (pattern.test(t)) return subtype;
  }
  return null;
}

/**
 * Chart of accounts taxonomy. Five types with Wave-compatible subtypes, so a Wave export maps
 * 1:1 (see docs/PLAN.md §3.1). Keys are stored in the database; labels are for display.
 */

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type AccountTypeInfo = {
  key: AccountType;
  label: string;
  /** Plain-language explanation shown in the UI. */
  hint: string;
  /** Debit-normal accounts grow with debits (assets, expenses); the rest grow with credits. */
  normalBalance: "debit" | "credit";
};

export const accountTypes: Record<AccountType, AccountTypeInfo> = {
  asset: {
    key: "asset",
    label: "Assets",
    hint: "What the business owns or is owed: bank balances, inventory, equipment.",
    normalBalance: "debit",
  },
  liability: {
    key: "liability",
    label: "Liabilities",
    hint: "What the business owes: credit cards, loans, taxes, unpaid bills.",
    normalBalance: "credit",
  },
  equity: {
    key: "equity",
    label: "Equity",
    hint: "The owners' stake: money put in, drawings, and profits kept in the business.",
    normalBalance: "credit",
  },
  income: {
    key: "income",
    label: "Income",
    hint: "Money earned from sales and other sources.",
    normalBalance: "credit",
  },
  expense: {
    key: "expense",
    label: "Expenses",
    hint: "Costs of running the business, including the cost of goods sold.",
    normalBalance: "debit",
  },
};

export type AccountSubtypeInfo = {
  key: string;
  type: AccountType;
  label: string;
  /** Accounts of this subtype hold a single currency (bank and card accounts). */
  needsCurrency?: boolean;
};

export const ACCOUNT_SUBTYPES = [
  { key: "cash_bank", type: "asset", label: "Cash and bank", needsCurrency: true },
  { key: "money_in_transit", type: "asset", label: "Money in transit" },
  { key: "accounts_receivable", type: "asset", label: "Expected payments from customers" },
  { key: "inventory", type: "asset", label: "Inventory" },
  { key: "fixed_assets", type: "asset", label: "Property, plant and equipment" },
  { key: "accumulated_depreciation", type: "asset", label: "Depreciation and amortization" },
  { key: "vendor_prepayments", type: "asset", label: "Vendor prepayments and credits" },
  { key: "other_current_asset", type: "asset", label: "Other short-term asset" },
  { key: "other_long_term_asset", type: "asset", label: "Other long-term asset" },
  { key: "credit_card", type: "liability", label: "Credit card", needsCurrency: true },
  { key: "loan", type: "liability", label: "Loan and line of credit" },
  { key: "accounts_payable", type: "liability", label: "Expected payments to vendors" },
  { key: "sales_tax", type: "liability", label: "Sales taxes" },
  { key: "payroll_liability", type: "liability", label: "Due for payroll" },
  { key: "due_to_owners", type: "liability", label: "Due to you and other business owners" },
  { key: "customer_prepayments", type: "liability", label: "Customer prepayments and credits" },
  { key: "other_current_liability", type: "liability", label: "Other short-term liability" },
  { key: "other_long_term_liability", type: "liability", label: "Other long-term liability" },
  { key: "owner_equity", type: "equity", label: "Owner contributions and drawings" },
  { key: "retained_earnings", type: "equity", label: "Retained earnings" },
  { key: "income", type: "income", label: "Income" },
  { key: "discount", type: "income", label: "Discount" },
  { key: "other_income", type: "income", label: "Other income" },
  { key: "uncategorized_income", type: "income", label: "Uncategorized income" },
  { key: "fx_gain", type: "income", label: "Gain on foreign exchange" },
  { key: "operating_expense", type: "expense", label: "Operating expense" },
  { key: "cost_of_goods_sold", type: "expense", label: "Cost of goods sold" },
  { key: "payment_processing_fee", type: "expense", label: "Payment processing fee" },
  { key: "payroll_expense", type: "expense", label: "Payroll expense" },
  { key: "uncategorized_expense", type: "expense", label: "Uncategorized expense" },
  { key: "fx_loss", type: "expense", label: "Loss on foreign exchange" },
] as const satisfies readonly AccountSubtypeInfo[];

export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number]["key"];

const SUBTYPES_BY_KEY = new Map<string, AccountSubtypeInfo>(
  ACCOUNT_SUBTYPES.map((s) => [s.key, s]),
);

export function getAccountSubtype(key: string): AccountSubtypeInfo | undefined {
  return SUBTYPES_BY_KEY.get(key);
}

export function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(value);
}

/**
 * Only what you hold or owe (assets and liabilities) can be kept to one currency. Income,
 * expense and equity categories take amounts in any currency: a sale in USD and one in CAD can
 * both be "Sales".
 */
export function canHoldOneCurrency(type: string): boolean {
  return type === "asset" || type === "liability";
}

export function isAccountSubtype(value: string): value is AccountSubtype {
  return SUBTYPES_BY_KEY.has(value);
}

export function subtypesOf(type: AccountType): AccountSubtypeInfo[] {
  return ACCOUNT_SUBTYPES.filter((s) => s.type === type);
}

/**
 * Accounts the system relies on (posting uncategorized bank lines, closing the year, FX, stock
 * and cost of goods sold).
 * They can be renamed but not archived.
 */
export const SYSTEM_ACCOUNT_KEYS = [
  "accounts_receivable",
  "accounts_payable",
  "retained_earnings",
  "uncategorized_income",
  "uncategorized_expense",
  "fx_gain",
  "fx_loss",
  "inventory",
  "cost_of_goods_sold",
  "opening_balance_equity",
  "inventory_write_offs",
] as const;
export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

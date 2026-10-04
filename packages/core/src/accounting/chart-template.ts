import type { AccountSubtype, AccountType, SystemAccountKey } from "./accounts";

export type ChartTemplateAccount = {
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  description?: string;
  systemKey?: SystemAccountKey;
};

/**
 * The standard chart of accounts every new company starts with. It works in any country;
 * country tax packs (phase 1, later) add their own sales tax accounts. Codes follow the
 * common 1000s–6000s layout so accountants recognise it.
 */
export const DEFAULT_CHART: readonly ChartTemplateAccount[] = [
  { code: "1000", name: "Cash on hand", type: "asset", subtype: "cash_bank" },
  {
    code: "1100",
    name: "Accounts receivable",
    type: "asset",
    subtype: "accounts_receivable",
    description: "Money customers owe you.",
    systemKey: "accounts_receivable",
  },
  { code: "1200", name: "Inventory", type: "asset", subtype: "inventory" },
  { code: "1300", name: "Prepaid expenses", type: "asset", subtype: "vendor_prepayments" },
  { code: "1500", name: "Equipment", type: "asset", subtype: "fixed_assets" },
  {
    code: "1510",
    name: "Accumulated depreciation",
    type: "asset",
    subtype: "accumulated_depreciation",
  },
  {
    code: "2000",
    name: "Accounts payable",
    type: "liability",
    subtype: "accounts_payable",
    description: "Bills you haven't paid yet.",
    systemKey: "accounts_payable",
  },
  {
    code: "2500",
    name: "Due to shareholders",
    type: "liability",
    subtype: "due_to_owners",
    description: "Money owners have lent to the business or paid on its behalf.",
  },
  {
    code: "3000",
    name: "Owner contributions",
    type: "equity",
    subtype: "owner_equity",
    description: "Share capital and money owners have put into the business.",
  },
  {
    code: "3100",
    name: "Owner drawings and dividends",
    type: "equity",
    subtype: "owner_equity",
  },
  {
    code: "3900",
    name: "Retained earnings",
    type: "equity",
    subtype: "retained_earnings",
    description: "Profits from earlier years kept in the business.",
    systemKey: "retained_earnings",
  },
  { code: "4000", name: "Sales", type: "income", subtype: "income" },
  { code: "4500", name: "Other income", type: "income", subtype: "other_income" },
  {
    code: "4900",
    name: "Gain on foreign exchange",
    type: "income",
    subtype: "fx_gain",
    systemKey: "fx_gain",
  },
  {
    code: "4990",
    name: "Uncategorized income",
    type: "income",
    subtype: "uncategorized_income",
    description: "Money in that hasn't been categorized yet.",
    systemKey: "uncategorized_income",
  },
  { code: "5000", name: "Cost of goods sold", type: "expense", subtype: "cost_of_goods_sold" },
  {
    code: "6000",
    name: "Advertising and marketing",
    type: "expense",
    subtype: "operating_expense",
  },
  { code: "6050", name: "Bank service charges", type: "expense", subtype: "operating_expense" },
  {
    code: "6060",
    name: "Payment processing fees",
    type: "expense",
    subtype: "payment_processing_fee",
  },
  {
    code: "6100",
    name: "Software and subscriptions",
    type: "expense",
    subtype: "operating_expense",
  },
  { code: "6150", name: "Insurance", type: "expense", subtype: "operating_expense" },
  { code: "6200", name: "Meals and entertainment", type: "expense", subtype: "operating_expense" },
  { code: "6250", name: "Office supplies", type: "expense", subtype: "operating_expense" },
  {
    code: "6300",
    name: "Professional fees",
    type: "expense",
    subtype: "operating_expense",
    description: "Accounting, legal and consulting.",
  },
  { code: "6350", name: "Rent", type: "expense", subtype: "operating_expense" },
  { code: "6400", name: "Shipping and postage", type: "expense", subtype: "operating_expense" },
  { code: "6450", name: "Phone and internet", type: "expense", subtype: "operating_expense" },
  { code: "6500", name: "Travel", type: "expense", subtype: "operating_expense" },
  { code: "6600", name: "Wages and salaries", type: "expense", subtype: "payroll_expense" },
  {
    code: "6900",
    name: "Loss on foreign exchange",
    type: "expense",
    subtype: "fx_loss",
    systemKey: "fx_loss",
  },
  {
    code: "6990",
    name: "Uncategorized expense",
    type: "expense",
    subtype: "uncategorized_expense",
    description: "Money out that hasn't been categorized yet.",
    systemKey: "uncategorized_expense",
  },
];

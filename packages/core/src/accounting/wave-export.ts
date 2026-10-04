import { formatDecimal, parseDecimal } from "../money";
import type { AccountType } from "./accounts";
import { type CsvCell, csvAmount, toCsv } from "./export";

/**
 * Transactions in the layout of Wave's "Accounting transactions" CSV export (Settings → Data
 * export), one row per journal line. Accountants who worked from Wave's file can use this one
 * the same way. Amounts are in the main currency, debits positive in the one-column amount.
 */

export const WAVE_EXPORT_COLUMNS = [
  "Transaction ID",
  "Transaction Date",
  "Account Name",
  "Transaction Description",
  "Transaction Line Description",
  "Amount (One column)",
  "Debit Amount (Two Column Approach)",
  "Credit Amount (Two Column Approach)",
  "Other Accounts for this Transaction",
  "Customer",
  "Vendor",
  "Invoice Number",
  "Bill Number",
  "Notes / Memo",
  "Amount Before Sales Tax",
  "Sales Tax Amount",
  "Sales Tax Name",
  "Transaction Date Added",
  "Transaction Date Last Modified",
  "Account Group",
  "Account Type",
  "Account ID",
] as const;

/** Wave's names for account groups and types, matched to Bookalyze's. */
const WAVE_GROUPS: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities & Credit Cards",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

const WAVE_TYPES: Record<string, string> = {
  cash_bank: "Cash and Bank",
  money_in_transit: "Money in Transit",
  accounts_receivable: "Expected Payments from Customers",
  inventory: "Inventory",
  fixed_assets: "Property, Plant, Equipment",
  accumulated_depreciation: "Depreciation and Amortization",
  vendor_prepayments: "Vendor Prepayments and Vendor Credits",
  other_current_asset: "Other Short-Term Asset",
  other_long_term_asset: "Other Long-Term Asset",
  credit_card: "Credit Card",
  loan: "Loan and Line of Credit",
  accounts_payable: "Expected Payments to Vendors",
  sales_tax: "Sales Taxes",
  payroll_liability: "Due For Payroll",
  due_to_owners: "Due to You and Other Business Owners",
  customer_prepayments: "Customer Prepayments and Customer Credits",
  other_current_liability: "Other Short-Term Liability",
  other_long_term_liability: "Other Long-Term Liability",
  owner_equity: "Business Owner Contribution and Drawing",
  retained_earnings: "Retained Earnings: Profit",
  income: "Income",
  discount: "Discount",
  other_income: "Other Income",
  uncategorized_income: "Uncategorized Income",
  fx_gain: "Gain On Foreign Exchange",
  operating_expense: "Operating Expense",
  cost_of_goods_sold: "Cost of Goods Sold",
  payment_processing_fee: "Payment Processing Fee",
  payroll_expense: "Payroll Expense",
  uncategorized_expense: "Uncategorized Expense",
  fx_loss: "Loss On Foreign Exchange",
};

export type TransactionExportLine = {
  lineId: string;
  entryId: string;
  /** Shown as the transaction ID, e.g. 12 for JE-0012. */
  entryNumber: number;
  date: string;
  memo: string | null;
  reference: string | null;
  /** When the entry was recorded, as YYYY-MM-DD. Posted entries never change after that. */
  recordedOn: string;
  accountName: string;
  accountCode: string | null;
  accountType: AccountType;
  accountSubtype: string;
  description: string | null;
  /** Signed main-currency amount: positive = debit. */
  amount: string;
  taxRateName: string | null;
  /** True for the line posting the tax itself (to the rate's tax account). */
  isTaxLine: boolean;
  contactName: string | null;
  contactType: "customer" | "vendor" | "both" | null;
};

const abs = (n: bigint) => (n < 0n ? -n : n);

/** Splits each rate's tax across the entry's taxed lines in proportion to their amounts. */
function taxShares(lines: readonly TransactionExportLine[]): Map<TransactionExportLine, bigint> {
  const shares = new Map<TransactionExportLine, bigint>();
  const rates = new Set(lines.filter((l) => l.taxRateName).map((l) => l.taxRateName));
  for (const rate of rates) {
    const taxed = lines.filter((l) => l.taxRateName === rate && !l.isTaxLine);
    const tax = abs(
      lines
        .filter((l) => l.taxRateName === rate && l.isTaxLine)
        .reduce((sum, l) => sum + parseDecimal(l.amount), 0n),
    );
    const base = taxed.reduce((sum, l) => sum + abs(parseDecimal(l.amount)), 0n);
    let left = tax;
    taxed.forEach((line, i) => {
      const share =
        i === taxed.length - 1 || base === 0n
          ? left
          : (tax * abs(parseDecimal(line.amount))) / base;
      shares.set(line, share);
      left -= share;
    });
  }
  return shares;
}

/** Whether the entry's contact goes in Wave's Customer or Vendor column. */
function contactSide(lines: readonly TransactionExportLine[]): "customer" | "vendor" | null {
  const first = lines[0];
  if (!first?.contactName) return null;
  if (first.contactType === "customer" || first.contactType === "vendor") return first.contactType;
  const sale = lines.some(
    (l) => l.accountType === "income" || l.accountSubtype === "accounts_receivable",
  );
  return sale ? "customer" : "vendor";
}

/** The CSV, from lines grouped by entry (in date, entry and line order). */
export function waveTransactionsCsv(
  lines: readonly TransactionExportLine[],
  currency: string,
): string {
  const byEntry = new Map<string, TransactionExportLine[]>();
  for (const line of lines) {
    const group = byEntry.get(line.entryId);
    if (group) group.push(line);
    else byEntry.set(line.entryId, [line]);
  }
  const rows: CsvCell[][] = [[...WAVE_EXPORT_COLUMNS]];
  for (const entry of byEntry.values()) {
    const shares = taxShares(entry);
    const side = contactSide(entry);
    for (const line of entry) {
      const amount = parseDecimal(line.amount);
      const others = [...new Set(entry.filter((l) => l !== line).map((l) => l.accountName))]
        .filter((name) => name !== line.accountName)
        .join(", ");
      const share = shares.get(line);
      rows.push([
        String(line.entryNumber),
        line.date,
        line.accountName,
        line.memo,
        line.description,
        csvAmount(line.amount, currency),
        amount > 0n ? csvAmount(line.amount, currency) : null,
        amount < 0n ? csvAmount(formatDecimal(-amount), currency) : null,
        others,
        side === "customer" ? line.contactName : null,
        side === "vendor" ? line.contactName : null,
        side === "customer" ? line.reference : null,
        side === "vendor" ? line.reference : null,
        side === null ? line.reference : null,
        share !== undefined ? csvAmount(formatDecimal(abs(amount)), currency) : null,
        share !== undefined ? csvAmount(formatDecimal(share), currency) : null,
        line.taxRateName,
        line.recordedOn,
        line.recordedOn,
        WAVE_GROUPS[line.accountType],
        WAVE_TYPES[line.accountSubtype] ?? line.accountSubtype,
        line.accountCode,
      ]);
    }
  }
  return toCsv(rows);
}

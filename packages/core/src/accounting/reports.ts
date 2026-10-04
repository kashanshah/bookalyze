import { formatDecimal, parseDecimal } from "../money";
import { ACCOUNT_TYPES, type AccountType, accountTypes } from "./accounts";

/**
 * Report shaping. The server sums `base_amount` per account (debits positive, credits
 * negative) for the period; these functions turn those sums into report rows and totals.
 * All amounts are base-currency decimal strings.
 */

export type AccountBalance = {
  accountId: string;
  code: string | null;
  name: string;
  type: AccountType;
  subtype: string;
  /** Signed sum of base amounts: positive = net debit. */
  balance: string;
};

export type ReportRow = {
  accountId: string;
  code: string | null;
  name: string;
  subtype: string;
  /** Shown in the account's natural direction (income, liabilities and equity as positive). */
  amount: string;
};

export type ReportSection = { key: string; label: string; rows: ReportRow[]; total: string };

function byCode(
  a: { code: string | null; name: string },
  b: { code: string | null; name: string },
) {
  return (
    (a.code ?? "~").localeCompare(b.code ?? "~", undefined, { numeric: true }) ||
    a.name.localeCompare(b.name)
  );
}

/** Natural-direction amount: credit-normal accounts flip the sign so growth reads positive. */
function natural(type: AccountType, balance: bigint): bigint {
  return accountTypes[type].normalBalance === "debit" ? balance : -balance;
}

function section(key: string, label: string, balances: AccountBalance[]): ReportSection {
  let total = 0n;
  const rows = balances
    .map((b) => {
      const amount = natural(b.type, parseDecimal(b.balance));
      total += amount;
      return { accountId: b.accountId, code: b.code, name: b.name, subtype: b.subtype, amount };
    })
    .filter((r) => r.amount !== 0n)
    .sort(byCode)
    .map((r) => ({ ...r, amount: formatDecimal(r.amount) }));
  return { key, label, rows, total: formatDecimal(total) };
}

export type TrialBalance = {
  groups: {
    type: AccountType;
    label: string;
    rows: (Omit<ReportRow, "amount"> & { debit: string | null; credit: string | null })[];
  }[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
};

/** Every account with a non-zero balance, in debit and credit columns. */
export function trialBalance(balances: AccountBalance[]): TrialBalance {
  let debit = 0n;
  let credit = 0n;
  const groups = ACCOUNT_TYPES.map((type) => {
    const rows = balances
      .filter((b) => b.type === type && parseDecimal(b.balance) !== 0n)
      .sort(byCode)
      .map((b) => {
        const value = parseDecimal(b.balance);
        if (value > 0n) debit += value;
        else credit -= value;
        return {
          accountId: b.accountId,
          code: b.code,
          name: b.name,
          subtype: b.subtype,
          debit: value > 0n ? formatDecimal(value) : null,
          credit: value < 0n ? formatDecimal(-value) : null,
        };
      });
    return { type, label: accountTypes[type].label, rows };
  }).filter((g) => g.rows.length > 0);
  return {
    groups,
    totalDebit: formatDecimal(debit),
    totalCredit: formatDecimal(credit),
    balanced: debit === credit,
  };
}

export type ProfitAndLoss = {
  income: ReportSection;
  costOfSales: ReportSection;
  grossProfit: string;
  expenses: ReportSection;
  netProfit: string;
};

/** Income minus cost of goods sold (gross profit) minus operating expenses (net profit). */
export function profitAndLoss(balances: AccountBalance[]): ProfitAndLoss {
  const income = section(
    "income",
    "Income",
    balances.filter((b) => b.type === "income"),
  );
  const costOfSales = section(
    "cost_of_sales",
    "Cost of goods sold",
    balances.filter((b) => b.type === "expense" && b.subtype === "cost_of_goods_sold"),
  );
  const expenses = section(
    "expenses",
    "Operating expenses",
    balances.filter((b) => b.type === "expense" && b.subtype !== "cost_of_goods_sold"),
  );
  const gross = parseDecimal(income.total) - parseDecimal(costOfSales.total);
  return {
    income,
    costOfSales,
    grossProfit: formatDecimal(gross),
    expenses,
    netProfit: formatDecimal(gross - parseDecimal(expenses.total)),
  };
}

export type BalanceSheet = {
  assets: ReportSection;
  liabilities: ReportSection;
  equity: ReportSection;
  totalLiabilitiesAndEquity: string;
  balanced: boolean;
};

/**
 * Balance sheet as of a date. `balances` are all accounts summed from the beginning up to the
 * date. Income and expense balances are folded into equity: those before the current financial
 * year into retained earnings, the rest as "Profit for this financial year". Pass the
 * current-year portion as `currentYearBalances` (income and expense accounts, from the start of
 * the financial year to the date).
 */
export function balanceSheet(
  balances: AccountBalance[],
  currentYearBalances: AccountBalance[],
): BalanceSheet {
  const assets = section(
    "assets",
    "Assets",
    balances.filter((b) => b.type === "asset"),
  );
  const liabilities = section(
    "liabilities",
    "Liabilities",
    balances.filter((b) => b.type === "liability"),
  );
  const equity = section(
    "equity",
    "Equity",
    balances.filter((b) => b.type === "equity"),
  );

  const sumPnl = (list: AccountBalance[]) =>
    list
      .filter((b) => b.type === "income" || b.type === "expense")
      .reduce((t, b) => t - parseDecimal(b.balance), 0n);
  const allEarnings = sumPnl(balances);
  const currentEarnings = sumPnl(currentYearBalances);
  const priorEarnings = allEarnings - currentEarnings;

  const extra: ReportRow[] = [];
  if (priorEarnings !== 0n) {
    extra.push({
      accountId: "prior_earnings",
      code: null,
      name: "Profit from earlier years",
      subtype: "retained_earnings",
      amount: formatDecimal(priorEarnings),
    });
  }
  if (currentEarnings !== 0n) {
    extra.push({
      accountId: "current_earnings",
      code: null,
      name: "Profit for this financial year",
      subtype: "retained_earnings",
      amount: formatDecimal(currentEarnings),
    });
  }
  const equityTotal = parseDecimal(equity.total) + allEarnings;
  const equityWithEarnings: ReportSection = {
    ...equity,
    rows: [...equity.rows, ...extra],
    total: formatDecimal(equityTotal),
  };
  const liabilitiesAndEquity = parseDecimal(liabilities.total) + equityTotal;
  return {
    assets,
    liabilities,
    equity: equityWithEarnings,
    totalLiabilitiesAndEquity: formatDecimal(liabilitiesAndEquity),
    balanced: parseDecimal(assets.total) === liabilitiesAndEquity,
  };
}

import { describe, expect, it } from "vitest";
import { getAccountSubtype, SYSTEM_ACCOUNT_KEYS } from "../accounting/accounts";
import { DEFAULT_CHART } from "../accounting/chart-template";
import {
  type AccountBalance,
  balanceSheet,
  profitAndLoss,
  trialBalance,
} from "../accounting/reports";

const acct = (
  accountId: string,
  type: AccountBalance["type"],
  subtype: string,
  balance: string,
  code: string | null = null,
): AccountBalance => ({ accountId, code, name: accountId, type, subtype, balance });

// All-time balances: capital 1000 in, sales 500 last year and 300 this year, rent 200 this year.
const allTime = [
  acct("bank", "asset", "cash_bank", "1600.0000", "1000"),
  acct("capital", "equity", "owner_equity", "-1000.0000", "3000"),
  acct("sales", "income", "income", "-800.0000", "4000"),
  acct("cogs", "expense", "cost_of_goods_sold", "0.0000", "5000"),
  acct("rent", "expense", "operating_expense", "200.0000", "6350"),
];
const thisYear = [
  acct("sales", "income", "income", "-300.0000", "4000"),
  acct("rent", "expense", "operating_expense", "200.0000", "6350"),
];

describe("reports", () => {
  it("builds a balanced trial balance without zero rows", () => {
    const tb = trialBalance(allTime);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe("1800.0000");
    expect(tb.totalCredit).toBe("1800.0000");
    expect(tb.groups.map((g) => g.type)).toEqual(["asset", "equity", "income", "expense"]);
    expect(tb.groups.flatMap((g) => g.rows.map((r) => r.accountId))).not.toContain("cogs");
  });

  it("computes gross and net profit", () => {
    const pnl = profitAndLoss([...thisYear, acct("cogs", "expense", "cost_of_goods_sold", "50")]);
    expect(pnl.income.total).toBe("300.0000");
    expect(pnl.costOfSales.total).toBe("50.0000");
    expect(pnl.grossProfit).toBe("250.0000");
    expect(pnl.netProfit).toBe("50.0000");
  });

  it("folds profit into equity so the balance sheet balances", () => {
    const bs = balanceSheet(allTime, thisYear);
    expect(bs.assets.total).toBe("1600.0000");
    expect(bs.equity.rows.map((r) => [r.name, r.amount])).toEqual([
      ["capital", "1000.0000"],
      ["Profit from earlier years", "500.0000"],
      ["Profit for this financial year", "100.0000"],
    ]);
    expect(bs.totalLiabilitiesAndEquity).toBe("1600.0000");
    expect(bs.balanced).toBe(true);
  });

  it("ships a valid default chart", () => {
    const codes = DEFAULT_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of DEFAULT_CHART) expect(getAccountSubtype(a.subtype)?.type).toBe(a.type);
    const systemKeys = DEFAULT_CHART.flatMap((a) => (a.systemKey ? [a.systemKey] : []));
    expect([...systemKeys].sort()).toEqual([...SYSTEM_ACCOUNT_KEYS].sort());
  });
});

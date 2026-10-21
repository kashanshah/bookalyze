import { describe, expect, it } from "vitest";
import type { AccountBalance } from "../accounting/reports";
import { ownerDirections, stakeLine, stakeLines, yourStake } from "../accounting/stake";

const acct = (
  id: string,
  type: AccountBalance["type"],
  subtype: string,
  balance: string,
): AccountBalance => ({ accountId: id, code: null, name: id, type, subtype, balance });

describe("your stake", () => {
  it("adds up what you put in and took out, and sets it against what the company is worth", () => {
    // Year 1: put in 1,000, a loss of 200 (stock bought, nothing sold yet).
    const y1 = [
      acct("contrib", "equity", "owner_equity", "-1000.0000"),
      acct("sales", "income", "income", "0.0000"),
      acct("fees", "expense", "operating_expense", "200.0000"),
    ];
    // Year 2: put in 300 (and one 50 entered then removed: it nets out), took out 400, profit 600.
    const y2 = [
      acct("contrib", "equity", "owner_equity", "-300.0000"),
      acct("drawings", "equity", "owner_equity", "400.0000"),
      acct("sales", "income", "income", "-900.0000"),
      acct("fees", "expense", "operating_expense", "300.0000"),
    ];
    const asOf = [
      acct("bank", "asset", "cash_bank", "500.0000"),
      acct("stock", "asset", "inventory", "250.0000"),
      acct("clearing", "asset", "money_in_transit", "-50.0000"),
      acct("card", "liability", "credit_card", "0.0000"),
      acct("contrib", "equity", "owner_equity", "-1300.0000"),
      acct("drawings", "equity", "owner_equity", "400.0000"),
      acct("sales", "income", "income", "-900.0000"),
      acct("fees", "expense", "operating_expense", "500.0000"),
    ];
    const stake = yourStake({
      asOf,
      years: [
        { label: "FY2025", from: "2025-01-01", to: "2025-12-31", balances: y1 },
        { label: "FY2026", from: "2026-01-01", to: "2026-10-21", balances: y2 },
      ],
    });
    expect(stake.years.map((y) => [y.label, y.putIn, y.tookOut, y.net, y.profit])).toEqual([
      ["FY2025", "1000.0000", "0.0000", "1000.0000", "-200.0000"],
      ["FY2026", "300.0000", "400.0000", "-100.0000", "600.0000"],
    ]);
    expect(stake).toMatchObject({
      putIn: "1300.0000",
      tookOut: "400.0000",
      net: "900.0000",
      profit: "400.0000",
      earlierProfit: "0.0000",
      worthTotal: "700.0000",
      upOrDown: "-200.0000",
      balanced: false,
    });
    expect(stake.worth.map((g) => [g.key, g.amount])).toEqual([
      ["cash", "500.0000"],
      ["stock", "250.0000"],
      ["coming", "-50.0000"],
    ]);
  });

  it("balances when the books do, and counts retained earnings as earlier profit", () => {
    const asOf = [
      acct("bank", "asset", "cash_bank", "1500.0000"),
      acct("loan", "liability", "loan", "-200.0000"),
      acct("contrib", "equity", "owner_equity", "-1000.0000"),
      acct("retained", "equity", "retained_earnings", "-100.0000"),
      acct("sales", "income", "income", "-500.0000"),
      acct("fees", "expense", "operating_expense", "300.0000"),
    ];
    const year = [
      acct("contrib", "equity", "owner_equity", "-1000.0000"),
      acct("sales", "income", "income", "-500.0000"),
      acct("fees", "expense", "operating_expense", "300.0000"),
    ];
    const stake = yourStake({
      asOf,
      years: [{ label: "FY2026", from: "2026-01-01", to: "2026-12-31", balances: year }],
    });
    expect(stake).toMatchObject({
      net: "1000.0000",
      earlierProfit: "100.0000",
      profit: "300.0000",
      worthTotal: "1300.0000",
      upOrDown: "300.0000",
      balanced: true,
    });
    expect(stake.worth.at(-1)).toEqual({
      key: "owes",
      label: "Less what it owes",
      amount: "-200.0000",
    });
  });

  it("reads each owner line as put in or taken out, the way its account counts", () => {
    const ways = ownerDirections([
      acct("contrib", "equity", "owner_equity", "-1000.0000"),
      acct("drawings", "equity", "owner_equity", "400.0000"),
      acct("retained", "equity", "retained_earnings", "-100.0000"),
      acct("empty", "equity", "owner_equity", "0.0000"),
    ]);
    expect([...ways]).toEqual([
      ["contrib", "in"],
      ["drawings", "out"],
      ["empty", null],
    ]);
    expect(stakeLine(ways.get("contrib"), "-500.0000")).toEqual({ way: "in", amount: "500.0000" });
    // A contribution taken back off: less put in, not money taken out.
    expect(stakeLine(ways.get("contrib"), "50.0000")).toEqual({ way: "in", amount: "-50.0000" });
    expect(stakeLine(ways.get("drawings"), "400.0000")).toEqual({ way: "out", amount: "400.0000" });
    expect(stakeLine(ways.get("empty"), "-20.0000")).toEqual({ way: "in", amount: "20.0000" });
  });

  it("counts an account at zero the way its lines net, so an entry and its reversal cancel", () => {
    const ways = new Map<string, "in" | "out" | null>([
      ["contrib", "in"],
      ["empty", null],
    ]);
    const lines = stakeLines(
      [
        { accountId: "contrib", amount: "-500.0000" },
        { accountId: "empty", amount: "-300.0000" },
        { accountId: "empty", amount: "300.0000" },
      ],
      ways,
    );
    expect(lines.map((l) => [l.accountId, l.way, l.amount])).toEqual([
      ["contrib", "in", "500.0000"],
      ["empty", "out", "-300.0000"],
      ["empty", "out", "300.0000"],
    ]);
  });
});

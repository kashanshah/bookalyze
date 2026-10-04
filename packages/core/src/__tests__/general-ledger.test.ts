import { describe, expect, it } from "vitest";
import { accountLedger, generalLedgerSummary, type LedgerActivity } from "../accounting/reports";

const activity = (
  accountId: string,
  type: LedgerActivity["type"],
  opening: string,
  debits: string,
  credits: string,
  code: string | null = null,
): LedgerActivity => ({
  accountId,
  code,
  name: accountId,
  type,
  subtype: "x",
  opening,
  debits,
  credits,
});

describe("generalLedgerSummary", () => {
  it("shows opening and closing in each account's natural direction", () => {
    const summary = generalLedgerSummary([
      activity("bank", "asset", "1000.0000", "300.0000", "50.0000", "1000"),
      activity("sales", "income", "-400.0000", "0.0000", "300.0000", "4000"),
      activity("rent", "expense", "0.0000", "50.0000", "0.0000", "6350"),
      activity("idle", "expense", "0.0000", "0.0000", "0.0000"),
    ]);
    expect(summary.groups.map((g) => g.type)).toEqual(["asset", "income", "expense"]);
    expect(summary.groups[0]?.rows[0]).toMatchObject({
      opening: "1000.0000",
      closing: "1250.0000",
    });
    // Income is credit-normal: a credit balance reads positive and grows with credits.
    expect(summary.groups[1]?.rows[0]).toMatchObject({ opening: "400.0000", closing: "700.0000" });
    expect(summary.totalDebits).toBe("350.0000");
    expect(summary.totalCredits).toBe("350.0000");
  });

  it("leaves out accounts with no balance and no activity", () => {
    expect(generalLedgerSummary([activity("idle", "asset", "0", "0", "0")]).groups).toEqual([]);
  });
});

describe("accountLedger", () => {
  it("keeps a running balance from the opening balance", () => {
    const ledger = accountLedger("asset", "100.0000", [
      { id: "a", amount: "50.0000" },
      { id: "b", amount: "-30.0000" },
    ]);
    expect(ledger.lines.map((l) => [l.debit, l.credit, l.balance])).toEqual([
      ["50.0000", null, "150.0000"],
      [null, "30.0000", "120.0000"],
    ]);
    expect(ledger).toMatchObject({
      opening: "100.0000",
      totalDebit: "50.0000",
      totalCredit: "30.0000",
      closing: "120.0000",
    });
  });

  it("takes the totals and closing balance from the whole period when the list was cut", () => {
    const ledger = accountLedger("asset", "100.0000", [{ id: "a", amount: "50.0000" }], {
      debits: "80.0000",
      credits: "20.0000",
    });
    expect(ledger.lines[0]?.balance).toBe("150.0000");
    expect(ledger).toMatchObject({
      totalDebit: "80.0000",
      totalCredit: "20.0000",
      closing: "160.0000",
    });
  });

  it("reads a liability's credits as growth", () => {
    const ledger = accountLedger("liability", "-200.0000", [{ id: "a", amount: "-25.0000" }]);
    expect(ledger.opening).toBe("200.0000");
    expect(ledger.lines[0]?.balance).toBe("225.0000");
  });
});

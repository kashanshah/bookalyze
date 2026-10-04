import { describe, expect, it } from "vitest";
import { compareProfitAndLoss } from "../accounting/compare";
import {
  accountLedgerCsv,
  csvAmount,
  csvFileName,
  profitAndLossComparisonCsv,
  profitAndLossCsv,
  toCsv,
} from "../accounting/export";
import { accountLedger, profitAndLoss } from "../accounting/reports";

const meta = {
  company: "Maple Goods",
  report: "Profit and loss",
  period: "2025-01-01 to 2025-12-31",
  currency: "CAD",
};
const lines = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("toCsv", () => {
  it("quotes commas, quotes and line breaks, and starts with a byte-order mark", () => {
    const csv = toCsv([["a,b", 'say "hi"', "two\nlines", null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines(csv)).toEqual(['"a,b","say ""hi""","two\nlines",']);
  });

  it("stops spreadsheets from running text as a formula, but keeps negative numbers", () => {
    expect(lines(toCsv([["=SUM(A1)", "+1 call", "@me", "-12.50", "-x"]]))).toEqual([
      "'=SUM(A1),'+1 call,'@me,-12.50,'-x",
    ]);
  });
});

describe("csvAmount", () => {
  it("rounds to the currency's minor units", () => {
    expect(csvAmount("1234.5650", "CAD")).toBe("1234.57");
    expect(csvAmount("-0.0050", "CAD")).toBe("-0.01");
    expect(csvAmount("1234.5000", "JPY")).toBe("1235");
    expect(csvAmount("1.2345", "BHD")).toBe("1.235");
    expect(csvAmount(null, "CAD")).toBe("");
  });
});

describe("report CSVs", () => {
  it("lists each section, its total and the net result", () => {
    const pnl = profitAndLoss([
      {
        accountId: "s",
        code: "4000",
        name: "Sales",
        type: "income",
        subtype: "income",
        balance: "-500.0000",
      },
      {
        accountId: "r",
        code: "6350",
        name: "Rent",
        type: "expense",
        subtype: "operating_expense",
        balance: "200.0000",
      },
    ]);
    const rows = lines(profitAndLossCsv(pnl, meta));
    expect(rows.slice(0, 4)).toEqual([
      "Company,Maple Goods",
      "Report,Profit and loss",
      "Period,2025-01-01 to 2025-12-31",
      "Currency,CAD",
    ]);
    expect(rows).toContain("Income,4000,Sales,500.00");
    expect(rows).toContain("Operating expenses,6350,Rent,200.00");
    expect(rows.at(-1)).toBe(",,Net profit,300.00");
  });

  it("adds the earlier period and the change as columns when comparing", () => {
    const now = profitAndLoss([
      {
        accountId: "s",
        code: "4000",
        name: "Sales",
        type: "income",
        subtype: "income",
        balance: "-600.0000",
      },
    ]);
    const before = profitAndLoss([
      {
        accountId: "s",
        code: "4000",
        name: "Sales",
        type: "income",
        subtype: "income",
        balance: "-500.0000",
      },
    ]);
    const rows = lines(
      profitAndLossComparisonCsv(
        compareProfitAndLoss(now, before),
        meta,
        "2024-01-01 to 2024-12-31",
      ),
    );
    expect(rows).toContain("Compared with,2024-01-01 to 2024-12-31");
    expect(rows).toContain(
      "Section,Code,Account,2025-01-01 to 2025-12-31,2024-01-01 to 2024-12-31,Change",
    );
    expect(rows).toContain("Income,4000,Sales,600.00,500.00,100.00");
    expect(rows.at(-1)).toBe(",,Net profit,600.00,500.00,100.00");
  });

  it("writes an account's lines with debits, credits and the running balance", () => {
    const ledger = accountLedger("asset", "100.0000", [
      {
        id: "1",
        amount: "-40.0000",
        date: "2025-02-01",
        entry: "JE-0002",
        reference: null,
        details: "Rent",
        contact: "Landlord",
        currency: "CAD",
        currencyAmount: "-40.0000",
      },
      {
        id: "2",
        amount: "130.0000",
        date: "2025-02-03",
        entry: "JE-0003",
        reference: "INV-1",
        details: "Sale",
        contact: null,
        currency: "USD",
        currencyAmount: "100.0000",
      },
    ]);
    const rows = lines(
      accountLedgerCsv(
        ledger,
        { code: "1000", name: "Bank" },
        { ...meta, report: "General ledger" },
      ),
    );
    expect(rows).toContain("Account,1000 Bank");
    expect(rows).toContain(",,,Opening balance,,,,100.00,,");
    expect(rows).toContain("2025-02-01,JE-0002,,Rent,Landlord,,40.00,60.00,,");
    expect(rows).toContain("2025-02-03,JE-0003,INV-1,Sale,,130.00,,190.00,USD,100.00");
    expect(rows.at(-1)).toBe(",,,Closing balance,,,,190.00,,");
  });
});

describe("csvFileName", () => {
  it("makes a safe, readable file name", () => {
    expect(
      csvFileName("Café Ünïcode Inc.", "profit and loss", "2025-01-01", "to", "2025-12-31"),
    ).toBe("cafe-unicode-inc-profit-and-loss-2025-01-01-to-2025-12-31.csv");
  });
});

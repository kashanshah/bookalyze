import { describe, expect, it } from "vitest";
import {
  accountFingerprint,
  guessStatementColumns,
  mappingFromSettings,
  readStatement,
  statementAccounts,
  statementSettings,
} from "../banking/statement";
import { readCsvTable } from "../import/csv";

const feed = { accountId: "acct-1", currency: "CAD" };

describe("bank statement CSV", () => {
  it("reads a two-description, one-amount export with several accounts in it", () => {
    const table = readCsvTable(
      [
        "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$",
        "Chequing,00001-1111111,10/3/2026,,Coffee shop,Card purchase,-7.76,",
        "Chequing,00001-1111111,10/3/2026,,Coffee shop,Card purchase,-7.76,",
        "Chequing,00001-1111111,10/4/2026,,Payroll,Deposit,1500.00,",
        "Savings,00001-2222222,10/4/2026,,Interest,,0.12,",
      ].join("\n"),
    );
    const mapping = guessStatementColumns(table.headers);
    expect(mapping).toMatchObject({
      date: 2,
      description: 4,
      description2: 5,
      amount: 6,
      account: 1,
    });
    expect(guessStatementColumns(table.headers, "USD").amount).toBe(7);
    const accounts = statementAccounts(table, mapping.account as number);
    expect(accounts.map((a) => a.hint)).toEqual(["••••1111", "••••2222"]);
    const read = readStatement(
      table,
      mapping,
      { dateOrder: "mdy", positiveIs: "in", accountFingerprint: accounts[0]?.fingerprint },
      feed,
    );
    expect(read.otherAccounts).toBe(1);
    expect(read.lines.map((l) => [l.date, l.amount, l.description])).toEqual([
      ["2026-10-03", "-7.7600", "Coffee shop · Card purchase"],
      ["2026-10-03", "-7.7600", "Coffee shop · Card purchase"],
      ["2026-10-04", "1500.0000", "Payroll · Deposit"],
    ]);
    // Identical rows get different IDs, and reading the same file again gives the same IDs.
    const ids = read.lines.map((l) => l.externalId);
    expect(new Set(ids).size).toBe(3);
    expect(
      readStatement(
        table,
        mapping,
        { dateOrder: "mdy", positiveIs: "in", accountFingerprint: accounts[0]?.fingerprint },
        feed,
      ).lines.map((l) => l.externalId),
    ).toEqual(ids);
    expect(ids[0]).toMatch(/^csv:acct-1:2026-10-03:-7\.7600:[0-9a-f]{16}:0$/);
  });

  it("reads separate money in and money out columns, whichever sign the bank uses", () => {
    const table = readCsvTable(
      [
        "Date,Details,Withdrawals,Deposits",
        "2026-10-01,Rent,1200.00,",
        "2026-10-02,Refund,,40.00",
        "2026-10-03,Fee,-2.50,",
        ",Closing balance,,",
      ].join("\n"),
    );
    const mapping = guessStatementColumns(table.headers);
    expect(mapping).toEqual({ date: 0, description: 1, moneyOut: 2, moneyIn: 3 });
    const read = readStatement(table, mapping, { dateOrder: "ymd", positiveIs: "in" }, feed);
    expect(read.lines.map((l) => l.amount)).toEqual(["-1200.0000", "40.0000", "-2.5000"]);
    expect(read.problems).toEqual([]);
    expect([read.firstDate, read.lastDate]).toEqual(["2026-10-01", "2026-10-03"]);
  });

  it("flips a card statement where positive means money spent, and reports unreadable rows", () => {
    const table = readCsvTable(
      [
        "Date,Description,Amount",
        "03/10/2026,Hotel,250.00",
        "not a date,Taxi,12.00",
        "04/10/2026,Payment,abc",
      ].join("\n"),
    );
    const read = readStatement(
      table,
      guessStatementColumns(table.headers),
      { dateOrder: "dmy", positiveIs: "out" },
      feed,
    );
    expect(read.lines.map((l) => [l.date, l.amount])).toEqual([["2026-10-03", "-250.0000"]]);
    expect(read.problems.map((p) => p.lineNumber)).toEqual([3, 4]);
  });

  it("remembers columns by name, so a reordered file still maps", () => {
    const headers = ["Date", "Description", "Amount"];
    const mapping = guessStatementColumns(headers);
    const settings = statementSettings(headers, mapping, { dateOrder: "mdy", positiveIs: "in" });
    expect(settings.columns).toEqual({
      date: "Date",
      description: "Description",
      amount: "Amount",
    });
    expect(mappingFromSettings(["Amount", "Date", "Description"], settings)).toEqual({
      date: 1,
      description: 2,
      amount: 0,
    });
    expect(mappingFromSettings(["Date", "Memo"], settings)).toBeNull();
    // Account numbers are kept only as fingerprints, whatever their spacing.
    expect(accountFingerprint("00001 1111111")).toBe(accountFingerprint("00001-1111111"));
  });

  it("finds the closing balance, whichever way the file runs", () => {
    const newestFirst = readCsvTable(
      [
        "Date,Description,Amount,Balance",
        "2026-10-04,Fee,-2.00,98.00",
        "2026-10-04,Coffee,-5.00,100.00",
        "2026-10-03,Deposit,105.00,105.00",
      ].join("\n"),
    );
    const mapping = guessStatementColumns(newestFirst.headers);
    expect(mapping.balance).toBe(3);
    const options = { dateOrder: "ymd", positiveIs: "in" } as const;
    expect(readStatement(newestFirst, mapping, options, feed).closingBalance).toEqual({
      date: "2026-10-04",
      amount: "98.0000",
    });
    const oldestFirst = readCsvTable(
      [
        "Date,Description,Amount,Balance",
        "2026-10-03,Deposit,105.00,105.00",
        "2026-10-04,Coffee,-5.00,100.00",
        "2026-10-04,Fee,-2.00,98.00",
      ].join("\n"),
    );
    expect(readStatement(oldestFirst, mapping, options, feed).closingBalance?.amount).toBe(
      "98.0000",
    );
    // A card statement (positive is money spent): what's owed is a negative balance.
    expect(
      readStatement(oldestFirst, mapping, { ...options, positiveIs: "out" }, feed).closingBalance
        ?.amount,
    ).toBe("-98.0000");
    // No balance column: nothing to compare with.
    expect(
      readStatement(oldestFirst, { ...mapping, balance: undefined }, options, feed).closingBalance,
    ).toBeNull();
  });
});

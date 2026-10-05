import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  detectDateOrder,
  guessColumns,
  guessSubtype,
  importSource,
  parseCsv,
  parseImportAmount,
  parseImportDate,
  planImport,
  readCsvTable,
} from "../import";

// Synthetic exports in the shape each program writes. No real company data.
const WAVE = `Transaction ID,Transaction Date,Account Name,Transaction Description,Transaction Line Description,Amount (One column),Debit Amount (Two Column Approach),Credit Amount (Two Column Approach),Other Accounts for this Transaction,Customer,Vendor,Invoice Number,Bill Number,Notes / Memo,Amount Before Sales Tax,Sales Tax Amount,Sales Tax Name,Transaction Date Added,Transaction Date Last Modified,Account Group,Account Type,Account ID
1001,2024-01-05,Chequing,"Invoice 12, Northwind",,113.00,113.00,,Sales,Northwind Traders,,12,,,,,,2024-01-05,2024-01-05,Assets,Cash and Bank,9001
1001,2024-01-05,Sales,"Invoice 12, Northwind",Consulting,-100.00,,100.00,Chequing,Northwind Traders,,12,,,,,,2024-01-05,2024-01-05,Income,Income,9002
1001,2024-01-05,GST/HST Payable,"Invoice 12, Northwind",HST,-13.00,,13.00,Chequing,Northwind Traders,,12,,,,,,2024-01-05,2024-01-05,Liabilities & Credit Cards,Sales Taxes,9003
1002,2024-01-09,Office Supplies,Staples,,45.20,45.20,,Visa,,Staples,,,,,,,2024-01-09,2024-01-09,Expenses,Operating Expense,9004
1002,2024-01-09,Visa,Staples,,-45.20,,45.20,Office Supplies,,Staples,,,,,,,2024-01-09,2024-01-09,Liabilities & Credit Cards,Credit Card,9005
`;

const QUICKBOOKS = `Journal
Maple Goods Inc.
"January 1 - December 31, 2024"

Date,Transaction Type,Num,Name,Memo/Description,Account,Debit,Credit
01/05/2024,Deposit,,Northwind Traders,Invoice 12,Chequing,"1,130.00",
,,,,,Sales,,"1,000.00"
,,,,,HST Payable,,130.00
01/31/2024,Expense,88,Bell,Phone,Telephone Expense,56.50,
,,,,,Chequing,,56.50
,,,,,,"1,186.50","1,186.50"
TOTAL,,,,,,"1,186.50","1,186.50"
`;

// Excel in many European locales: semicolons, day-first dates, decimal commas.
const EUROPEAN = `Datum;Journal;Account;Description;Amount
31.01.2024;J1;Bank;Rent;-1.200,00
31.01.2024;J1;Rent;Rent;1.200,00
`;

describe("CSV reading", () => {
  it("handles quotes, embedded commas and newlines, CRLF, a BOM and other delimiters", () => {
    expect(parseCsv('﻿a,"b, c","d ""e"""\r\n1,"two\nlines",3\r\n')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "two\nlines", "3"],
    ]);
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips a report's title block to find the header row", () => {
    const table = readCsvTable(QUICKBOOKS);
    expect(table.headers[0]).toBe("Date");
    expect(table.rows).toHaveLength(7);
    expect(table.lineNumbers[0]).toBe(6);
  });
});

describe("values", () => {
  it("reads dates in common formats", () => {
    expect(parseImportDate("2024-01-31")).toBe("2024-01-31");
    expect(parseImportDate("2024/1/5")).toBe("2024-01-05");
    expect(parseImportDate("01/31/2024", "mdy")).toBe("2024-01-31");
    expect(parseImportDate("31/01/2024", "dmy")).toBe("2024-01-31");
    expect(parseImportDate("31.01.24", "dmy")).toBe("2024-01-31");
    expect(parseImportDate("Jan 31, 2024")).toBe("2024-01-31");
    expect(parseImportDate("31-Jan-2024")).toBe("2024-01-31");
    expect(parseImportDate("2024-01-31T00:00:00Z")).toBe("2024-01-31");
    expect(parseImportDate("02/30/2024")).toBeNull();
    expect(parseImportDate("TOTAL")).toBeNull();
  });

  it("works out whether dates are day or month first", () => {
    expect(detectDateOrder(["01/05/2024", "13/05/2024"])).toEqual({
      order: "dmy",
      ambiguous: false,
    });
    expect(detectDateOrder(["01/05/2024", "05/13/2024"])).toEqual({
      order: "mdy",
      ambiguous: false,
    });
    expect(detectDateOrder(["01/05/2024"])).toEqual({ order: "mdy", ambiguous: true });
    expect(detectDateOrder(["2024-01-05"])).toEqual({ order: "ymd", ambiguous: false });
  });

  it("reads amounts with symbols, separators and negative styles", () => {
    expect(parseImportAmount("$1,234.50")).toBe("1234.5000");
    expect(parseImportAmount("(45.00)")).toBe("-45.0000");
    expect(parseImportAmount("45.00-")).toBe("-45.0000");
    expect(parseImportAmount("-CA$12")).toBe("-12.0000");
    expect(parseImportAmount("1.234,50 €")).toBe("1234.5000");
    expect(parseImportAmount("12,5")).toBe("12.5000");
    expect(parseImportAmount("1,234")).toBe("1234.0000");
    expect(parseImportAmount("")).toBe("");
    expect(parseImportAmount("n/a")).toBeNull();
  });

  it("reads back any amount it formats", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (cents) => {
        const text = (cents / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const parsed = parseImportAmount(text);
        expect(parsed && Math.round(Number(parsed) * 100)).toBe(cents);
      }),
    );
  });
});

describe("account types", () => {
  it("maps types from Wave, QuickBooks and Xero, then names", () => {
    expect(guessSubtype("Cash and Bank", "RBC")).toBe("cash_bank");
    expect(guessSubtype("Expected Payments from Customers", "AR")).toBe("accounts_receivable");
    expect(guessSubtype("Unknown Account", "Unknown Account")).toBe("other_current_asset");
    expect(guessSubtype("Customer Prepayments and Customer Credits", "x")).toBe(
      "customer_prepayments",
    );
    expect(guessSubtype("Sales Taxes", "GST/HST")).toBe("sales_tax");
    expect(guessSubtype("Business Owner Contribution and Drawing", "x")).toBe("owner_equity");
    expect(guessSubtype("Accounts receivable (A/R)", "x")).toBe("accounts_receivable");
    expect(guessSubtype("Non-current Asset", "x")).toBe("other_long_term_asset");
    expect(guessSubtype("Direct Costs", "x")).toBe("cost_of_goods_sold");
    expect(guessSubtype(undefined, "Bank fees")).toBe("operating_expense");
    expect(guessSubtype(undefined, "TD Chequing")).toBe("cash_bank");
    expect(guessSubtype(undefined, "Rent")).toBeNull();
  });
});

describe("planning an import", () => {
  it("reads a Wave export grouped by transaction ID", () => {
    const table = readCsvTable(WAVE);
    const source = importSource("wave");
    const mapping = guessColumns(table.headers, source);
    expect(mapping).toMatchObject({ entryRef: 0, date: 1, account: 2, debit: 6, credit: 7 });
    expect(mapping.amount).toBeUndefined();
    const plan = planImport(table, source, {
      mapping,
      dateOrder: "ymd",
      amountSign: "debit_positive",
      groupBy: "id",
    });
    expect(plan.problems).toEqual([]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries[0]).toMatchObject({
      externalId: "wave:1001",
      date: "2024-01-05",
      memo: "Invoice 12, Northwind",
      reference: "12",
      contactKey: "northwind traders",
    });
    expect(plan.entries[0]?.lines.map((l) => l.amount)).toEqual([
      "113.0000",
      "-100.0000",
      "-13.0000",
    ]);
    expect(plan.accounts.find((a) => a.name === "Visa")?.subtype).toBe("credit_card");
    expect(plan.accounts.find((a) => a.name === "GST/HST Payable")?.subtype).toBe("sales_tax");
    expect(plan.contacts).toEqual([
      { key: "northwind traders", name: "Northwind Traders", role: "customer" },
      { key: "staples", name: "Staples", role: "vendor" },
    ]);
    expect([plan.firstDate, plan.lastDate]).toEqual(["2024-01-05", "2024-01-09"]);
  });

  it("reads a QuickBooks journal whose follow-on rows leave the date blank", () => {
    const table = readCsvTable(QUICKBOOKS);
    const source = importSource("quickbooks");
    const mapping = guessColumns(table.headers, source);
    expect(mapping.reference).toBe(2);
    const dates = detectDateOrder(table.rows.map((r) => r[0] ?? ""));
    const plan = planImport(table, source, {
      mapping,
      dateOrder: dates.order,
      amountSign: "debit_positive",
      groupBy: "balance",
    });
    expect(plan.problems).toEqual([]);
    expect(plan.skippedRows).toBe(2); // the totals rows
    expect(plan.entries.map((e) => [e.date, e.lines.length])).toEqual([
      ["2024-01-05", 3],
      ["2024-01-31", 2],
    ]);
    // Northwind is a customer because the entry is a sale; Bell a vendor (an expense).
    expect(plan.contacts.map((c) => [c.name, c.role])).toEqual([
      ["Bell", "vendor"],
      ["Northwind Traders", "customer"],
    ]);
    // Re-planning the same file gives the same IDs, so a second import skips them.
    const again = planImport(table, source, {
      mapping,
      dateOrder: dates.order,
      amountSign: "debit_positive",
      groupBy: "balance",
    });
    expect(again.entries.map((e) => e.externalId)).toEqual(plan.entries.map((e) => e.externalId));
  });

  it("reads semicolons, day-first dates and decimal commas", () => {
    const table = readCsvTable(EUROPEAN);
    const source = importSource("other");
    const mapping = { ...guessColumns(table.headers, source), date: 0 };
    const plan = planImport(table, source, {
      mapping,
      dateOrder: detectDateOrder(table.rows.map((r) => r[0] ?? "")).order,
      amountSign: "debit_positive",
      groupBy: "id",
    });
    expect(plan.problems).toEqual([]);
    expect(plan.entries[0]).toMatchObject({ date: "2024-01-31", externalId: "other:J1" });
    expect(plan.entries[0]?.lines.map((l) => l.amount)).toEqual(["-1200.0000", "1200.0000"]);
  });

  it("flags entries that don't balance or have bad dates, and keeps the rest", () => {
    const csv = `ID,Date,Account,Debit,Credit
1,2024-02-01,Bank,10.00,
1,2024-02-01,Sales,,9.99
2,someday,Bank,5,
2,someday,Sales,,5
3,2024-02-03,Bank,7,
3,2024-02-03,Sales,,7
`;
    const table = readCsvTable(csv);
    const plan = planImport(table, importSource("other"), {
      mapping: guessColumns(table.headers, importSource("other")),
      dateOrder: "ymd",
      amountSign: "debit_positive",
      groupBy: "id",
    });
    expect(plan.entries.map((e) => e.externalId)).toEqual(["other:3"]);
    expect(plan.problems).toEqual([
      { lineNumbers: [2, 3], message: "Debits and credits are off by 0.01." },
      { lineNumbers: [4, 5], message: "“someday” isn't a date we recognise." },
    ]);
  });

  it("flips signs for programs where a positive amount is a credit", () => {
    const csv = "Date,Account,Amount\n2024-03-01,Bank,-50\n2024-03-01,Sales,50\n";
    const table = readCsvTable(csv);
    const plan = planImport(table, importSource("other"), {
      mapping: guessColumns(table.headers, importSource("other")),
      dateOrder: "ymd",
      amountSign: "credit_positive",
      groupBy: "balance",
    });
    expect(plan.entries[0]?.lines.map((l) => l.amount)).toEqual(["50.0000", "-50.0000"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  type TransactionExportLine,
  WAVE_EXPORT_COLUMNS,
  waveTransactionsCsv,
} from "../accounting/wave-export";
import { readCsvTable } from "../import/csv";
import { planImport } from "../import/plan";
import { guessColumns, importSource } from "../import/sources";

let nextLine = 0;
const line = (over: Partial<TransactionExportLine>): TransactionExportLine => ({
  lineId: `l${++nextLine}`,
  entryId: "e1",
  entryNumber: 1,
  date: "2025-03-04",
  memo: "Invoice 12, Northwind",
  reference: "12",
  recordedOn: "2025-03-05",
  accountName: "Chequing",
  accountCode: "1010",
  accountType: "asset",
  accountSubtype: "cash_bank",
  description: null,
  amount: "0",
  taxRateName: null,
  isTaxLine: false,
  contactName: "Northwind Traders",
  contactType: "customer",
  ...over,
});

const sale = [
  line({ amount: "113.0000" }),
  line({
    accountName: "Sales",
    accountCode: "4000",
    accountType: "income",
    accountSubtype: "income",
    description: "Consulting",
    amount: "-100.0000",
    taxRateName: "HST ON",
  }),
  line({
    accountName: "GST/HST Payable",
    accountCode: "2200",
    accountType: "liability",
    accountSubtype: "sales_tax",
    amount: "-13.0000",
    taxRateName: "HST ON",
    isTaxLine: true,
  }),
];
const purchase = [
  line({
    entryId: "e2",
    entryNumber: 2,
    date: "2025-03-09",
    memo: "Staples",
    reference: null,
    accountName: "Office Supplies",
    accountCode: "6250",
    accountType: "expense",
    accountSubtype: "operating_expense",
    amount: "45.2000",
    contactName: "Staples",
    contactType: "vendor",
  }),
  line({
    entryId: "e2",
    entryNumber: 2,
    date: "2025-03-09",
    memo: "Staples",
    reference: null,
    accountName: "Visa",
    accountCode: "2100",
    accountType: "liability",
    accountSubtype: "credit_card",
    amount: "-45.2000",
    contactName: "Staples",
    contactType: "vendor",
  }),
];

describe("waveTransactionsCsv", () => {
  const csv = waveTransactionsCsv([...sale, ...purchase], "CAD");
  const table = readCsvTable(csv);
  const rows = table.rows.map((r) => Object.fromEntries(table.headers.map((h, i) => [h, r[i]])));

  it("uses Wave's columns, in Wave's order", () => {
    expect(table.headers).toEqual([...WAVE_EXPORT_COLUMNS]);
  });

  it("writes one row per line, with both amount layouts and Wave's account names", () => {
    expect(rows[0]).toMatchObject({
      "Transaction ID": "1",
      "Account Name": "Chequing",
      "Amount (One column)": "113.00",
      "Debit Amount (Two Column Approach)": "113.00",
      "Credit Amount (Two Column Approach)": "",
      "Other Accounts for this Transaction": "Sales, GST/HST Payable",
      Customer: "Northwind Traders",
      Vendor: "",
      "Invoice Number": "12",
      "Transaction Date Added": "2025-03-05",
      "Account Group": "Assets",
      "Account Type": "Cash and Bank",
      "Account ID": "1010",
    });
    expect(rows[1]).toMatchObject({
      "Amount (One column)": "-100.00",
      "Credit Amount (Two Column Approach)": "100.00",
      "Amount Before Sales Tax": "100.00",
      "Sales Tax Amount": "13.00",
      "Sales Tax Name": "HST ON",
    });
    expect(rows[3]).toMatchObject({
      Vendor: "Staples",
      Customer: "",
      "Account Type": "Operating Expense",
    });
  });

  it("reads back through the Wave importer as the same balanced transactions", () => {
    const source = importSource("wave");
    const plan = planImport(table, source, {
      mapping: guessColumns(table.headers, source),
      dateOrder: "ymd",
      amountSign: "debit_positive",
      groupBy: "id",
    });
    expect(plan.problems).toEqual([]);
    expect(plan.entries.map((e) => e.lines.map((l) => l.amount))).toEqual([
      ["113.0000", "-100.0000", "-13.0000"],
      ["45.2000", "-45.2000"],
    ]);
  });

  it("splits one rate's tax across several taxed lines without losing a cent", () => {
    const csv2 = waveTransactionsCsv(
      [
        line({ amount: "10.0000" }),
        line({
          accountName: "A",
          accountType: "income",
          accountSubtype: "income",
          amount: "-3.3300",
          taxRateName: "T",
        }),
        line({
          accountName: "B",
          accountType: "income",
          accountSubtype: "income",
          amount: "-6.6700",
          taxRateName: "T",
        }),
        line({
          accountName: "Tax",
          accountType: "liability",
          accountSubtype: "sales_tax",
          amount: "-1.0000",
          taxRateName: "T",
          isTaxLine: true,
        }),
        line({ accountName: "Chequing", amount: "1.0000" }),
      ],
      "CAD",
    );
    const t = readCsvTable(csv2);
    const i = t.headers.indexOf("Sales Tax Amount");
    const shares = t.rows.map((r) => r[i]).filter(Boolean);
    expect(shares).toEqual(["0.33", "0.67"]);
  });
});

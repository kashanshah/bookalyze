import { describe, expect, it } from "vitest";
import {
  type PdfTextItem,
  readMoney,
  readPdfStatement,
  readRowDate,
  statementPeriod,
} from "../banking/pdf-statement";

// A synthetic two-page statement laid out like a typical bank PDF: date, description, money out,
// money in and balance columns, numbers right-aligned under their headers.
const COLS = { date: 40, description: 100, out: 400, into: 520, balance: 620 };
let y = 800;
let page = 1;
const items: PdfTextItem[] = [];
const text = (t: string, x: number) => items.push({ text: t, x, y, width: t.length * 5, page });
/** A number ending at the column's right edge. */
const money = (t: string, right: number) =>
  items.push({ text: t, x: right - t.length * 5, y, width: t.length * 5, page });
const row = (parts: {
  date?: string;
  text?: string;
  out?: string;
  into?: string;
  bal?: string;
}) => {
  if (parts.date) text(parts.date, COLS.date);
  if (parts.text) text(parts.text, COLS.description);
  if (parts.out) money(parts.out, COLS.out);
  if (parts.into) money(parts.into, COLS.into);
  if (parts.bal) money(parts.bal, COLS.balance);
  y -= 14;
};
const header = () => {
  text("Date", COLS.date);
  text("Description", COLS.description);
  money("Cheques & Debits ($)", COLS.out);
  money("Deposits & Credits ($)", COLS.into);
  money("Balance ($)", COLS.balance);
  y -= 14;
};

text("Business Account Statement", 300);
y -= 14;
text("December 6, 2025 to January 6, 2026", 300);
y -= 14;
text("Opening balance on December 6, 2025 $500.00", 40);
y -= 30;
header();
row({ text: "Opening balance", bal: "500.00" });
row({ date: "08 Dec", text: "Funds transfer credit Example Co", into: "1,200.00" });
row({ text: "Funds transfer fee Example Co", out: "17.00", bal: "1,683.00" });
row({ date: "30 Dec", text: "Online Banking foreign exchange" });
row({ text: "3WW000000000001", out: "600.00", bal: "1,083.00" });
page = 2;
y = 800;
text("Account Activity Details - continued", 40);
y -= 14;
header();
row({ date: "03 Jan", text: "Service fee", out: "9.00", bal: "1,074.00" });
// Bold dates drawn twice, a hair apart.
text("05 Jan", COLS.date + 0.4);
row({ date: "05 Jan", text: "Wire payment 3OB000000000002", out: "(74.00)" });
row({ text: "Closing balance", bal: "1,000.00" });
text("Account Fees: $26.00", 100);

describe("PDF bank statements", () => {
  it("rebuilds the rows, across pages, with multi-line descriptions and years from the period", () => {
    const read = readPdfStatement(items);
    expect(read.period).toEqual({ from: "2025-12-06", to: "2026-01-06" });
    expect(read.opening).toBe("500.0000");
    expect(read.closing).toBe("1000.0000");
    expect(read.rows.map((r) => [r.date, r.amount, r.description])).toEqual([
      ["2025-12-08", "1200.0000", "Funds transfer credit Example Co"],
      ["2025-12-08", "-17.0000", "Funds transfer fee Example Co"],
      ["2025-12-30", "-600.0000", "Online Banking foreign exchange 3WW000000000001"],
      ["2026-01-03", "-9.0000", "Service fee"],
      ["2026-01-05", "-74.0000", "Wire payment 3OB000000000002"],
    ]);
    // Every printed balance agrees with the rows.
    expect(read.balancesAgree).toBe(true);
    expect(read.problem).toBeNull();
  });

  it("says when the rows don't add up to the printed balances", () => {
    const tampered = items.map((i) => (i.text === "17.00" ? { ...i, text: "71.00" } : i));
    const read = readPdfStatement(tampered);
    expect(read.balancesAgree).toBe(false);
    expect(read.mismatches).toBeGreaterThan(0);
  });

  it("reports a file with nothing to read", () => {
    expect(readPdfStatement([{ text: "Hello", x: 0, y: 0, width: 10, page: 1 }]).problem).toMatch(
      /No transactions/,
    );
  });

  it("reads amounts, dates and periods the way banks print them", () => {
    expect(readMoney("1,234.56")).toBe("1234.5600");
    expect(readMoney("(12.00)")).toBe("-12.0000");
    expect(readMoney("12.00-")).toBe("-12.0000");
    expect(readMoney("3WW000000000001")).toBeNull();
    const period = { from: "2025-12-06", to: "2026-01-06" };
    expect(readRowDate("07 Dec", period)).toBe("2025-12-07");
    expect(readRowDate("Jan 2", period)).toBe("2026-01-02");
    expect(readRowDate("2026-01-02", null)).toBe("2026-01-02");
    expect(readRowDate("Service fee", period)).toBeNull();
    expect(statementPeriod("Statement Nov 6, 2024 - Dec 6, 2024")).toEqual({
      from: "2024-11-06",
      to: "2024-12-06",
    });
  });
});

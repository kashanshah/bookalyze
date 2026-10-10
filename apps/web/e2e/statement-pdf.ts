// Builds a small bank statement PDF for end-to-end tests: synthetic data, laid out like a
// typical bank's (date, description, money out, money in, balance; numbers right-aligned).

import { type PdfText, textPdf } from "./text-pdf";

const SIZE = 9;

export function statementPdf(input: {
  period: string;
  opening: string;
  rows: { date?: string; text: string; out?: string; into?: string; balance?: string }[];
  closing: string;
}): Buffer {
  const cols = { date: 40, description: 100, out: 400, into: 500, balance: 580 };
  const texts: PdfText[] = [];
  let y = 720;
  const line = () => {
    y -= 14;
  };
  texts.push({ text: "Business Account Statement", x: 300, y });
  line();
  texts.push({ text: input.period, x: 300, y });
  line();
  line();
  texts.push({ text: "Date", x: cols.date, y });
  texts.push({ text: "Description", x: cols.description, y });
  texts.push({ text: "Debits ($)", x: cols.out, y, right: true });
  texts.push({ text: "Credits ($)", x: cols.into, y, right: true });
  texts.push({ text: "Balance ($)", x: cols.balance, y, right: true });
  line();
  texts.push({ text: "Opening balance", x: cols.description, y });
  texts.push({ text: input.opening, x: cols.balance, y, right: true });
  line();
  for (const row of input.rows) {
    if (row.date) texts.push({ text: row.date, x: cols.date, y });
    texts.push({ text: row.text, x: cols.description, y });
    if (row.out) texts.push({ text: row.out, x: cols.out, y, right: true });
    if (row.into) texts.push({ text: row.into, x: cols.into, y, right: true });
    if (row.balance) texts.push({ text: row.balance, x: cols.balance, y, right: true });
    line();
  }
  texts.push({ text: "Closing balance", x: cols.description, y });
  texts.push({ text: input.closing, x: cols.balance, y, right: true });

  return textPdf(texts, { size: SIZE, width: 612, height: 792 });
}

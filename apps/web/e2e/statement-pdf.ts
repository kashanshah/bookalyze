// Builds a small bank statement PDF for end-to-end tests: synthetic data, laid out like a
// typical bank's (date, description, money out, money in, balance; numbers right-aligned).

type Text = { text: string; x: number; y: number; right?: boolean };

// Helvetica widths (per 1000 units) for what the statement prints, to right-align numbers.
const WIDTH: Record<string, number> = { ",": 278, ".": 278, "(": 333, ")": 333, " ": 278 };
const SIZE = 9;
const widthOf = (t: string) =>
  [...t].reduce((w, c) => w + (WIDTH[c] ?? (/[0-9$]/.test(c) ? 556 : 560)), 0) * (SIZE / 1000);

const escapePdf = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);

export function statementPdf(input: {
  period: string;
  opening: string;
  rows: { date?: string; text: string; out?: string; into?: string; balance?: string }[];
  closing: string;
}): Buffer {
  const cols = { date: 40, description: 100, out: 400, into: 500, balance: 580 };
  const texts: Text[] = [];
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

  const content = texts
    .map((t) => {
      const x = t.right ? t.x - widthOf(t.text) : t.x;
      return `BT /F1 ${SIZE} Tf 1 0 0 1 ${x.toFixed(2)} ${t.y} Tm (${escapePdf(t.text)}) Tj ET`;
    })
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

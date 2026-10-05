import { formatDecimal, parseDecimal } from "../money";

/**
 * Bank statements as PDF (for banks that give nothing else for past months). The text of each
 * page comes in as positioned pieces (pdf.js `getTextContent`, read in the browser so the file
 * never leaves the person's computer); this rebuilds the activity table from them:
 *
 * - a header row names the columns (date, description, money out, money in, balance; or one
 *   signed amount column), and each amount on the rows below belongs to the column it lines up
 *   with (numbers are right-aligned under their header);
 * - a row's description can run over several lines, and banks often print the date only on the
 *   first transaction of a day, so text without an amount waits for the line that has one;
 * - the running balance checks the reading: opening balance + each amount must give each
 *   balance printed. When every printed balance agrees, the rows are right (amounts and signs).
 *
 * Statements that don't follow this shape are reported as unreadable rather than guessed at.
 */

export type PdfTextItem = {
  text: string;
  /** Left edge and baseline, in PDF points (y grows upwards). */
  x: number;
  y: number;
  width: number;
  page: number;
};

export type PdfStatementRow = {
  date: string;
  description: string;
  /** Signed: positive is money in. */
  amount: string;
  /** The balance printed on the row, if any. */
  balance: string | null;
};

export type PdfStatementRead = {
  rows: PdfStatementRow[];
  period: { from: string; to: string } | null;
  opening: string | null;
  closing: string | null;
  /** Every printed balance (and the closing balance) agrees with the rows. */
  balancesAgree: boolean;
  /** Printed balances the rows didn't add up to. */
  mismatches: number;
  /** Why nothing could be read, in words fit to show. */
  problem: string | null;
};

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase() as never) + 1;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const MONEY =
  /^\(?-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?(?:\s?(?:CR|DR))?$|^\(?-?\$?\d+\.\d{2}\)?-?$/i;

/** "1,234.56", "(12.00)", "12.00-", "$5.00", "12.00 CR" → signed decimal string. */
export function readMoney(text: string): string | null {
  const t = text.trim();
  if (!MONEY.test(t)) return null;
  const negative = t.startsWith("(") || t.startsWith("-") || /-$/.test(t) || /DR$/i.test(t);
  const digits = t.replace(/[^\d.]/g, "");
  return formatDecimal(negative ? -parseDecimal(digits) : parseDecimal(digits));
}

/** The statement period, from "November 6, 2024 to December 6, 2024" (or "Nov 6, 2024 - …"). */
export function statementPeriod(text: string): { from: string; to: string } | null {
  const date = String.raw`([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})`;
  const match = new RegExp(`${date}\\s*(?:to|-|–|through)\\s*${date}`).exec(text);
  if (!match) return null;
  const [, m1, d1, y1, m2, d2, y2] = match;
  const a = monthOf(m1 ?? "");
  const b = monthOf(m2 ?? "");
  if (a < 1 || b < 1) return null;
  return { from: iso(+(y1 ?? 0), a, +(d1 ?? 0)), to: iso(+(y2 ?? 0), b, +(d2 ?? 0)) };
}

/**
 * A row's date, from what's printed at the start of it: "07 Nov", "Nov 7", "Nov 07, 2024",
 * "7 Nov 2024", "2024-11-07". A missing year comes from the statement period (a December line
 * on a statement ending in January belongs to the year before).
 */
export function readRowDate(
  text: string,
  period: { from: string; to: string } | null,
): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return iso(+(m[1] ?? 0), +(m[2] ?? 0), +(m[3] ?? 0));
  let day: number;
  let month: number;
  let year: number | null = null;
  m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?(?:,? (\d{4}))?$/.exec(t);
  if (m) {
    day = +(m[1] ?? 0);
    month = monthOf(m[2] ?? "");
    year = m[3] ? +m[3] : null;
  } else {
    m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:,? (\d{4}))?$/.exec(t);
    if (!m) return null;
    month = monthOf(m[1] ?? "");
    day = +(m[2] ?? 0);
    year = m[3] ? +m[3] : null;
  }
  if (month < 1 || day < 1 || day > 31) return null;
  if (year === null) {
    if (!period) return null;
    const end = +period.to.slice(0, 4);
    year = iso(end, month, day) > period.to ? end - 1 : end;
  }
  return iso(year, month, day);
}

type Line = { page: number; y: number; items: PdfTextItem[] };

/** Pieces on the same baseline (within a point or two) make a line, top to bottom. */
function toLines(items: readonly PdfTextItem[]): Line[] {
  const lines: Line[] = [];
  const sorted = [...items]
    .filter((i) => i.text.trim())
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const line = lines.at(-1);
    if (line && line.page === item.page && Math.abs(line.y - item.y) <= 2.5) {
      // Bold text is often drawn twice, a hair apart: keep one copy.
      const copy = line.items.some((i) => i.text === item.text && Math.abs(i.x - item.x) < 2);
      if (!copy) line.items.push(item);
    } else lines.push({ page: item.page, y: item.y, items: [item] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

type Columns = {
  /** Right edges of the amount columns. */
  out?: number;
  into?: number;
  amount?: number;
  balance?: number;
  /** Where the description starts: a date is whatever sits left of it. */
  description: number;
};

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

/** A header row: names a date, a description and at least one amount column. */
function readHeader(line: Line): Columns | null {
  const text = line.items
    .map((i) => i.text)
    .join(" ")
    .toLowerCase();
  if (!has(text, "date") || !has(text, "description", "details", "transaction", "particulars")) {
    return null;
  }
  const right = (i: PdfTextItem) => i.x + i.width;
  const columns: Columns = { description: Number.POSITIVE_INFINITY };
  for (const item of line.items) {
    const t = item.text.toLowerCase();
    if (has(t, "description", "details", "transaction", "particulars")) {
      columns.description = Math.min(columns.description, item.x);
    }
    if (has(t, "balance")) columns.balance = right(item);
    else if (has(t, "debit", "withdraw", "cheques", "paid out", "money out", "charges")) {
      columns.out = right(item);
    } else if (has(t, "credit", "deposit", "paid in", "money in")) columns.into = right(item);
    else if (has(t, "amount")) columns.amount = right(item);
  }
  const amounts = [columns.out, columns.into, columns.amount].filter((c) => c !== undefined);
  return amounts.length && Number.isFinite(columns.description) ? columns : null;
}

/** Which column an amount lines up with (its right edge within ~40 points of the header's). */
function columnOf(item: PdfTextItem, columns: Columns): keyof Columns | null {
  const right = item.x + item.width;
  let best: keyof Columns | null = null;
  let distance = 40;
  for (const key of ["out", "into", "amount", "balance"] as const) {
    const edge = columns[key];
    if (edge === undefined) continue;
    const d = Math.abs(edge - right);
    if (d < distance) {
      distance = d;
      best = key;
    }
  }
  return best;
}

export function readPdfStatement(items: readonly PdfTextItem[]): PdfStatementRead {
  const lines = toLines(items);
  const allText = lines.map((l) => l.items.map((i) => i.text).join(" ")).join("\n");
  const period = statementPeriod(allText.replace(/\s+/g, " "));
  const rows: PdfStatementRow[] = [];
  let opening: string | null = null;
  let closing: string | null = null;
  let columns: Columns | null = null;
  let page = 0;
  let date: string | null = null;
  let pending: string[] = [];
  let done = false;

  for (const line of lines) {
    if (done) break;
    if (line.page !== page) {
      // Each page repeats its header; nothing is read until it does.
      page = line.page;
      columns = null;
      pending = [];
    }
    const header = readHeader(line);
    if (header) {
      columns = header;
      pending = [];
      continue;
    }
    if (!columns) continue;
    const cols = columns;

    const amounts: Partial<Record<keyof Columns, string>> = {};
    const words: PdfTextItem[] = [];
    for (const item of line.items) {
      const money = readMoney(item.text);
      const column = money === null ? null : columnOf(item, cols);
      if (money !== null && column) amounts[column] = money;
      else words.push(item);
    }
    // A date is printed left of the description column.
    const left = words.filter((w) => w.x < cols.description - 2);
    const lineDate = left.length ? readRowDate(left.map((w) => w.text).join(" "), period) : null;
    if (lineDate) date = lineDate;
    const text = (lineDate ? words.filter((w) => !left.includes(w)) : words)
      .map((w) => w.text.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (/^opening balance/i.test(text) || /balance (brought|carried) forward/i.test(text)) {
      opening ??= amounts.balance ?? amounts.amount ?? amounts.into ?? null;
      pending = [];
      continue;
    }
    if (/^closing balance/i.test(text)) {
      closing = amounts.balance ?? amounts.amount ?? amounts.into ?? null;
      done = true;
      continue;
    }
    const out = amounts.out ? parseDecimal(amounts.out) : null;
    const into = amounts.into ? parseDecimal(amounts.into) : null;
    const signed = amounts.amount ? parseDecimal(amounts.amount) : null;
    if (out === null && into === null && signed === null) {
      // Text only: the start of a description whose amount is on a later line.
      if (text) pending.push(text);
      continue;
    }
    const abs = (v: bigint) => (v < 0n ? -v : v);
    const amount = signed ?? (into === null ? 0n : abs(into)) - (out === null ? 0n : abs(out));
    if (!date || amount === 0n) {
      pending = [];
      continue;
    }
    rows.push({
      date,
      description: [...pending, text].filter(Boolean).join(" ").slice(0, 500) || "Bank transaction",
      amount: formatDecimal(amount),
      balance: amounts.balance ?? null,
    });
    pending = [];
  }

  // The running balance check.
  let mismatches = 0;
  let printed = 0;
  if (opening !== null) {
    let running = parseDecimal(opening);
    for (const row of rows) {
      running += parseDecimal(row.amount);
      if (row.balance !== null) {
        printed++;
        if (running !== parseDecimal(row.balance)) {
          mismatches++;
          running = parseDecimal(row.balance);
        }
      }
    }
    if (closing !== null) {
      printed++;
      if (running !== parseDecimal(closing)) mismatches++;
    }
  }
  const problem = rows.length
    ? null
    : "No transactions could be read from this file. Is it the bank's own PDF statement (not a scan)?";
  return {
    rows,
    period,
    opening,
    closing,
    balancesAgree: opening !== null && printed > 0 && mismatches === 0,
    mismatches,
    problem,
  };
}

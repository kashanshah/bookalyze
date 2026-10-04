import { AMOUNT_SCALE, formatDecimal, parseDecimal } from "../money";

/**
 * Reading dates and amounts the way other software writes them: "01/31/2024", "31.01.2024",
 * "Jan 31, 2024", "$1,234.50", "(45.00)", "1.234,50 €".
 */

export type DateOrder = "ymd" | "mdy" | "dmy";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null; // 31 February and the like
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/** An ISO date ("2024-01-31") from a date in any common format, or null if it isn't one. */
export function parseImportDate(value: string, order: DateOrder = "mdy"): string | null {
  const v = value.trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  if (!v) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(v);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return order === "dmy" ? iso(y, b, a) : iso(y, a, b);
  }
  // "Jan 31, 2024", "January 31 2024"
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(v);
  if (m && monthIndex(m[1] as string)) {
    return iso(Number(m[3]), monthIndex(m[1] as string), Number(m[2]));
  }
  // "31 Jan 2024", "31-Jan-2024"
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-],?\s*(\d{2,4})$/.exec(v);
  if (m && monthIndex(m[2] as string)) {
    return iso(Number(m[3]), monthIndex(m[2] as string), Number(m[1]));
  }
  return null;
}

/**
 * Which way round numeric dates are written, judged from a column of them: a first part over 12
 * means day first, a second part over 12 means month first. `ambiguous` when nothing decides it.
 */
export function detectDateOrder(values: readonly string[]): {
  order: DateOrder;
  ambiguous: boolean;
} {
  let dayFirst = false;
  let monthFirst = false;
  let numeric = false;
  for (const value of values) {
    const v = value.trim();
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v)) return { order: "ymd", ambiguous: false };
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(v);
    if (!m) continue;
    numeric = true;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return { order: "dmy", ambiguous: false };
  if (monthFirst && !dayFirst) return { order: "mdy", ambiguous: false };
  return { order: "mdy", ambiguous: numeric };
}

/**
 * A decimal string from an amount as exported: currency symbols and codes, thousands separators,
 * parentheses or a trailing minus for negatives, and a decimal comma are all understood.
 * Returns "" for an empty cell and null for something that isn't a number.
 */
export function parseImportAmount(value: string): string | null {
  let v = value.trim();
  if (!v || v === "-" || v === "—") return "";
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/[A-Za-z$€£¥₹\s ']/g, "");
  if (v.endsWith("-")) {
    negative = !negative;
    v = v.slice(0, -1);
  }
  if (v.startsWith("-")) {
    negative = !negative;
    v = v.slice(1);
  } else if (v.startsWith("+")) {
    v = v.slice(1);
  }
  const lastDot = v.lastIndexOf(".");
  const lastComma = v.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    // Both used: the last one is the decimal separator.
    v = lastComma > lastDot ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (lastComma !== -1) {
    const decimals = v.length - lastComma - 1;
    const commas = v.split(",").length - 1;
    // "12,5" or "1234,56" is a decimal comma; "1,234" and "1,234,567" are thousands.
    v = commas === 1 && decimals !== 3 ? v.replace(",", ".") : v.replace(/,/g, "");
  }
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  try {
    // The ledger keeps 4 decimals; anything beyond that is dropped.
    const [whole, fraction = ""] = v.split(".");
    const units = parseDecimal(`${whole || "0"}.${fraction.slice(0, AMOUNT_SCALE)}`);
    return formatDecimal(negative ? -units : units);
  } catch {
    return null;
  }
}

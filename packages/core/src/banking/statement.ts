import type { CsvTable } from "../import/csv";
import { normalizeHeader } from "../import/sources";
import {
  type DateOrder,
  detectDateOrder,
  parseImportAmount,
  parseImportDate,
} from "../import/values";
import { formatDecimal, parseDecimal } from "../money";
import type { BankTransaction } from "./feed";

/**
 * Bank statements downloaded as CSV, from any bank or card. Each bank names its columns its own
 * way, so the columns are matched once per account and remembered. Every row gets an external ID
 * from its date, amount and description (plus a count for identical rows in the same file), so
 * uploading the same file again, or one that overlaps, never adds a transaction twice.
 */

export const STATEMENT_FIELDS = [
  "date",
  "description",
  "description2",
  "amount",
  "moneyOut",
  "moneyIn",
  "reference",
  "account",
] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];
export type StatementMapping = Partial<Record<StatementField, number>>;

export type StatementOptions = {
  dateOrder: DateOrder;
  /**
   * For a single amount column: whether a positive number is money in (most bank accounts) or
   * money out (most credit card statements).
   */
  positiveIs: "in" | "out";
  /** For files with several accounts in them: only rows whose account column has this fingerprint. */
  accountFingerprint?: string;
};

/** What's remembered for an account: columns by name (so a reordered file still works). */
export type StatementSettings = {
  columns: Partial<Record<StatementField, string>>;
  dateOrder: DateOrder;
  positiveIs: "in" | "out";
  /** The account within the file, as a fingerprint and the last few characters to show. */
  account?: { fingerprint: string; hint: string };
};

const NAMES: Record<Exclude<StatementField, "description2">, string[]> = {
  date: [
    "transaction date",
    "date",
    "posted date",
    "posting date",
    "booking date",
    "value date",
    "trans date",
  ],
  description: [
    "description",
    "description 1",
    "details",
    "transaction details",
    "transaction description",
    "narrative",
    "memo",
    "payee",
    "name",
    "merchant",
  ],
  amount: ["amount", "transaction amount", "cad", "usd", "aed", "eur", "gbp", "value"],
  moneyOut: [
    "debit",
    "debits",
    "withdrawal",
    "withdrawals",
    "money out",
    "paid out",
    "debit amount",
  ],
  moneyIn: ["credit", "credits", "deposit", "deposits", "money in", "paid in", "credit amount"],
  reference: ["reference", "cheque number", "check number", "ref", "transaction id", "id"],
  account: ["account number", "account", "account no", "card number", "account name"],
};

/**
 * The columns a statement's headers most likely mean. With the account's currency, a column named
 * after it ("USD$") is preferred for the amount, for files with one amount column per currency.
 */
export function guessStatementColumns(
  headers: readonly string[],
  currency?: string,
): StatementMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: StatementMapping = {};
  const find = (names: readonly string[]) => {
    for (const name of names) {
      const index = normalized.findIndex((h, i) => h === name && !used.has(i));
      if (index !== -1) return index;
    }
    return -1;
  };
  const byCurrency = currency ? normalized.indexOf(currency.toLowerCase()) : -1;
  if (byCurrency !== -1) {
    mapping.amount = byCurrency;
    used.add(byCurrency);
  }
  for (const field of [
    "date",
    "moneyOut",
    "moneyIn",
    "amount",
    "description",
    "reference",
    "account",
  ] as const) {
    if (mapping[field] !== undefined) continue;
    const index = find(NAMES[field]);
    if (index !== -1) {
      mapping[field] = index;
      used.add(index);
    }
  }
  // Two description columns ("Description 1", "Description 2") are read together.
  const second = normalized.findIndex((h, i) => h === "description 2" && !used.has(i));
  if (second !== -1 && mapping.description !== undefined) mapping.description2 = second;
  // Separate money in and out columns beat a single amount.
  if (mapping.moneyOut !== undefined && mapping.moneyIn !== undefined) delete mapping.amount;
  else {
    delete mapping.moneyOut;
    delete mapping.moneyIn;
  }
  return mapping;
}

/** Column indexes from remembered settings, by header name; null for a column no longer there. */
export function mappingFromSettings(
  headers: readonly string[],
  settings: StatementSettings,
): StatementMapping | null {
  const normalized = headers.map(normalizeHeader);
  const mapping: StatementMapping = {};
  for (const [field, name] of Object.entries(settings.columns)) {
    const index = normalized.indexOf(normalizeHeader(name));
    if (index === -1) return null;
    mapping[field as StatementField] = index;
  }
  return mapping;
}

/** Settings to remember, from a mapping and options. */
export function statementSettings(
  headers: readonly string[],
  mapping: StatementMapping,
  options: StatementOptions,
  accountHint?: string,
): StatementSettings {
  const columns: StatementSettings["columns"] = {};
  for (const [field, index] of Object.entries(mapping)) {
    const name = index === undefined ? undefined : headers[index];
    if (name) columns[field as StatementField] = name;
  }
  return {
    columns,
    dateOrder: options.dateOrder,
    positiveIs: options.positiveIs,
    ...(options.accountFingerprint
      ? { account: { fingerprint: options.accountFingerprint, hint: accountHint ?? "" } }
      : {}),
  };
}

/** A short, stable hash (FNV-1a, 64-bit) as hex. Not for security: only to tell values apart. */
function fnv1a(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of new TextEncoder().encode(text)) {
    hash ^= BigInt(char);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * An account number (or name) as a fingerprint, so a file's account can be recognised next time
 * without storing the number itself.
 */
export function accountFingerprint(value: string): string {
  return fnv1a(`account:${value.replace(/[\s-]/g, "").toLowerCase()}`);
}

/** "••••6789": enough of an account number to recognise it, never the whole of it. */
export function accountHint(value: string): string {
  const clean = value.replace(/[\s-]/g, "");
  return clean.length > 4 ? `••••${clean.slice(-4)}` : clean;
}

/** The accounts found in a file's account column, for picking which one this upload is for. */
export function statementAccounts(
  table: CsvTable,
  column: number,
): { fingerprint: string; hint: string; rows: number }[] {
  const found = new Map<string, { fingerprint: string; hint: string; rows: number }>();
  for (const row of table.rows) {
    const value = row[column]?.trim();
    if (!value) continue;
    const fingerprint = accountFingerprint(value);
    const entry = found.get(fingerprint) ?? { fingerprint, hint: accountHint(value), rows: 0 };
    entry.rows++;
    found.set(fingerprint, entry);
  }
  return [...found.values()].sort((a, b) => b.rows - a.rows);
}

/** Which way the file writes its dates, from the date column. */
export function statementDateOrder(table: CsvTable, mapping: StatementMapping) {
  const column = mapping.date;
  return detectDateOrder(column === undefined ? [] : table.rows.map((r) => r[column] ?? ""));
}

export type StatementProblem = { lineNumber: number; message: string };

export type StatementRead = {
  lines: BankTransaction[];
  problems: StatementProblem[];
  firstDate: string | null;
  lastDate: string | null;
  /** Rows for other accounts in the same file, left out. */
  otherAccounts: number;
};

const normalizeDescription = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Reads a statement into bank transactions for the money account `accountId` (part of each
 * external ID, so the same file is recognised whichever upload brings it). Rows without a date and amount
 * (headers repeated, totals, blank lines) are skipped quietly; rows with one but not the other
 * are reported.
 */
export function readStatement(
  table: CsvTable,
  mapping: StatementMapping,
  options: StatementOptions,
  account: { accountId: string; currency: string },
): StatementRead {
  const lines: BankTransaction[] = [];
  const problems: StatementProblem[] = [];
  const seen = new Map<string, number>();
  let otherAccounts = 0;
  const cell = (row: string[], field: StatementField) => {
    const index = mapping[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };
  const amountOf = (value: string) => {
    const parsed = parseImportAmount(value);
    if (parsed === null) return null;
    return parsed === "" ? 0n : parseDecimal(parsed);
  };
  const abs = (v: bigint) => (v < 0n ? -v : v);

  table.rows.forEach((row, i) => {
    const lineNumber = table.lineNumbers[i] ?? i + 2;
    if (options.accountFingerprint && mapping.account !== undefined) {
      const value = cell(row, "account");
      if (value && accountFingerprint(value) !== options.accountFingerprint) {
        otherAccounts++;
        return;
      }
    }
    const rawDate = cell(row, "date");
    let amount: bigint | null;
    if (mapping.amount !== undefined) {
      const value = amountOf(cell(row, "amount"));
      amount = value === null ? null : options.positiveIs === "in" ? value : -value;
    } else {
      const out = amountOf(cell(row, "moneyOut"));
      const into = amountOf(cell(row, "moneyIn"));
      // Some banks write money out as negative numbers, others as positive ones.
      amount = out === null || into === null ? null : abs(into) - abs(out);
    }
    if (!rawDate && !amount) return;
    const date = parseImportDate(rawDate, options.dateOrder);
    if (!date) {
      problems.push({ lineNumber, message: `"${rawDate || "(empty)"}" isn't a date we can read.` });
      return;
    }
    if (amount === null) {
      problems.push({ lineNumber, message: "The amount isn't a number we can read." });
      return;
    }
    if (amount === 0n) return;
    const description =
      [cell(row, "description"), cell(row, "description2")].filter(Boolean).join(" · ") ||
      "Bank transaction";
    const formatted = formatDecimal(amount);
    // Identical rows in one file (two coffees on the same day) are told apart by their order.
    const key = `${date}|${formatted}|${normalizeDescription(description)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    lines.push({
      externalId: `csv:${account.accountId}:${date}:${formatted}:${fnv1a(normalizeDescription(description))}:${n}`,
      date,
      currency: account.currency,
      amount: formatted,
      fee: "0.0000",
      description: description.slice(0, 500),
      counterparty: null,
      reference: cell(row, "reference").slice(0, 120) || null,
      kind: amount > 0n ? "deposit" : "other",
    });
  });
  const dates = lines.map((l) => l.date).sort();
  return {
    lines,
    problems,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    otherAccounts,
  };
}

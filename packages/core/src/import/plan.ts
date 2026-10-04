import { type AccountSubtype, getAccountSubtype } from "../accounting/accounts";
import { formatDecimal, parseDecimal } from "../money";
import type { CsvTable } from "./csv";
import { type ColumnMapping, guessSubtype, type ImportSource } from "./sources";
import { type DateOrder, parseImportAmount, parseImportDate } from "./values";

/**
 * Turns a mapped CSV of journal lines into balanced entries, the accounts and contacts they use,
 * and a list of problems to fix before importing. Pure, so the browser can preview an import
 * and the server can check it with the same rules.
 */

export type ImportOptions = {
  mapping: ColumnMapping;
  dateOrder: DateOrder;
  /** For a single Amount column: whether positive amounts are debits (most programs) or credits. */
  amountSign: "debit_positive" | "credit_positive";
  /**
   * "id": rows with the same transaction ID form one entry, wherever they are in the file.
   * "balance": consecutive rows form one entry until they add up to zero (for reports where an
   * entry's later rows leave the date and number blank, or numbers repeat).
   */
  groupBy: "id" | "balance";
};

export type ImportLineDraft = { accountKey: string; amount: string; description?: string };

export type ImportEntryDraft = {
  /** Stable across re-imports of the same file, so an entry is never imported twice. */
  externalId: string;
  date: string;
  memo?: string;
  reference?: string;
  contactKey?: string;
  lines: ImportLineDraft[];
  /** File line numbers of its rows. */
  lineNumbers: number[];
};

export type ImportAccountDraft = {
  key: string;
  name: string;
  code?: string;
  /** The account type as the other program called it, if exported. */
  sourceType?: string;
  /** Where it belongs in Bookalyze; null when the file doesn't say and the name doesn't tell. */
  subtype: AccountSubtype | null;
  lineCount: number;
};

export type ContactRole = "customer" | "vendor" | "both";
export type ImportContactDraft = { key: string; name: string; role: ContactRole };

export type ImportProblem = { lineNumbers: number[]; message: string };

export type ImportPlan = {
  entries: ImportEntryDraft[];
  accounts: ImportAccountDraft[];
  contacts: ImportContactDraft[];
  problems: ImportProblem[];
  /** Rows without an account or amount (totals, headings, blank lines). */
  skippedRows: number;
  firstDate: string | null;
  lastDate: string | null;
};

type Row = {
  line: number;
  date: string | null;
  rawDate: string;
  ref: string;
  accountKey: string;
  amount: bigint;
  memo: string;
  lineMemo: string;
  reference: string;
  contact: { name: string; role: ContactRole | null } | null;
};

export const accountKeyOf = (name: string, code?: string) =>
  `${(code ?? "").trim().toLowerCase()}|${name.trim().toLowerCase()}`;
export const contactKeyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Short, stable hash for identifying entries that have no ID of their own. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function planImport(
  table: CsvTable,
  source: Pick<ImportSource, "key">,
  options: ImportOptions,
): ImportPlan {
  const { mapping } = options;
  const cell = (row: string[], field: keyof ColumnMapping) => {
    const index = mapping[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };
  const problems: ImportProblem[] = [];
  const accounts = new Map<string, ImportAccountDraft>();
  const rows: Row[] = [];
  let skippedRows = 0;
  let previous: { rawDate: string; ref: string } | null = null;

  table.rows.forEach((raw, i) => {
    const line = table.lineNumbers[i] ?? i + 2;
    const accountName = cell(raw, "account");
    const accountCode = cell(raw, "accountCode");
    let amountText: string | null;
    if (mapping.amount !== undefined) {
      const a = parseImportAmount(cell(raw, "amount"));
      amountText =
        a === null || a === "" || options.amountSign === "debit_positive"
          ? a
          : formatDecimal(-parseDecimal(a));
    } else {
      const debit = parseImportAmount(cell(raw, "debit"));
      const credit = parseImportAmount(cell(raw, "credit"));
      amountText =
        debit === null || credit === null
          ? null
          : formatDecimal(parseDecimal(debit || "0") - parseDecimal(credit || "0"));
    }
    if (!accountName && !accountCode) {
      skippedRows++;
      return;
    }
    if (amountText === null) {
      problems.push({ lineNumbers: [line], message: "The amount isn't a number." });
      return;
    }
    const amount = parseDecimal(amountText || "0");
    if (amount === 0n) {
      skippedRows++;
      return;
    }
    // Reports that print the date and number only on an entry's first row.
    let rawDate = cell(raw, "date");
    let ref = cell(raw, "entryRef");
    if (!rawDate && previous) rawDate = previous.rawDate;
    if (!ref && !cell(raw, "date") && previous) ref = previous.ref;
    previous = { rawDate, ref };

    const key = accountKeyOf(accountName || accountCode, accountCode || undefined);
    const existing = accounts.get(key);
    const sourceType = cell(raw, "accountType") || undefined;
    if (existing) existing.lineCount++;
    else {
      accounts.set(key, {
        key,
        name: accountName || accountCode,
        ...(accountCode ? { code: accountCode } : {}),
        ...(sourceType ? { sourceType } : {}),
        subtype: guessSubtype(sourceType, accountName),
        lineCount: 1,
      });
    }
    const customer = cell(raw, "customer");
    const vendor = cell(raw, "vendor");
    const other = cell(raw, "contact");
    const contact = customer
      ? { name: customer, role: "customer" as const }
      : vendor
        ? { name: vendor, role: "vendor" as const }
        : other
          ? { name: other, role: null }
          : null;
    rows.push({
      line,
      date: parseImportDate(rawDate, options.dateOrder),
      rawDate,
      ref,
      accountKey: key,
      amount,
      memo: cell(raw, "memo"),
      lineMemo: cell(raw, "lineMemo"),
      reference: cell(raw, "reference"),
      contact,
    });
  });

  // Group rows into entries.
  const groups: Row[][] = [];
  if (options.groupBy === "id" && mapping.entryRef !== undefined) {
    const byRef = new Map<string, Row[]>();
    for (const row of rows) {
      const key = row.ref || `line:${row.line}`;
      const group = byRef.get(key);
      if (group) group.push(row);
      else {
        const created = [row];
        byRef.set(key, created);
        groups.push(created);
      }
    }
  } else {
    let current: Row[] = [];
    let sum = 0n;
    for (const row of rows) {
      const first = current[0];
      const newEntry =
        first &&
        (row.rawDate !== first.rawDate ||
          (row.ref && first.ref && row.ref !== first.ref) ||
          (sum === 0n && current.length >= 2));
      if (newEntry) {
        groups.push(current);
        current = [];
        sum = 0n;
      }
      current.push(row);
      sum += row.amount;
    }
    if (current.length) groups.push(current);
  }

  // Validate and shape each entry.
  const entries: ImportEntryDraft[] = [];
  const seen = new Map<string, number>();
  for (const group of groups) {
    const lineNumbers = group.map((r) => r.line);
    const first = group[0] as Row;
    const badDate = group.find((r) => !r.date);
    if (badDate) {
      problems.push({
        lineNumbers,
        message: badDate.rawDate
          ? `“${badDate.rawDate}” isn't a date we recognise.`
          : "The date is missing.",
      });
      continue;
    }
    const total = group.reduce((t, r) => t + r.amount, 0n);
    if (group.length < 2 || total !== 0n) {
      problems.push({
        lineNumbers,
        message:
          group.length < 2
            ? "This transaction has only one line, so it can't balance."
            : `Debits and credits are off by ${formatDecimal(total < 0n ? -total : total).replace(/0{1,2}$/, "")}.`,
      });
      continue;
    }
    const date = first.date as string;
    const lines = group.map((r) => ({
      accountKey: r.accountKey,
      amount: formatDecimal(r.amount),
      ...(r.lineMemo ? { description: r.lineMemo } : {}),
    }));
    let externalId: string;
    if (options.groupBy === "id" && first.ref) {
      externalId = `${source.key}:${first.ref}`;
    } else {
      const fingerprint = fnv1a(
        [date, first.ref, ...lines.map((l) => `${l.accountKey}=${l.amount}`).sort()].join("\n"),
      );
      const n = (seen.get(fingerprint) ?? 0) + 1;
      seen.set(fingerprint, n);
      externalId = `${source.key}:${date}:${fingerprint}${n > 1 ? `#${n}` : ""}`;
    }
    const memo = group.find((r) => r.memo)?.memo;
    const reference = group.find((r) => r.reference)?.reference;
    const contact = group.find((r) => r.contact)?.contact;
    entries.push({
      externalId,
      date,
      ...(memo ? { memo } : {}),
      ...(reference ? { reference } : {}),
      ...(contact ? { contactKey: contactKeyOf(contact.name) } : {}),
      lines,
      lineNumbers,
    });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Contacts: named as customer or vendor by the file, or by what their entries touch.
  const contacts = new Map<string, { key: string; name: string; role: ContactRole | null }>();
  const roleOf = (entry: ImportEntryDraft): ContactRole | null => {
    let income = false;
    let expense = false;
    for (const l of entry.lines) {
      const sub = accounts.get(l.accountKey)?.subtype;
      const type = sub ? getAccountSubtype(sub)?.type : undefined;
      if (type === "income" || sub === "accounts_receivable") income = true;
      if (type === "expense" || sub === "accounts_payable") expense = true;
    }
    return income && !expense ? "customer" : expense && !income ? "vendor" : null;
  };
  const merge = (a: ContactRole | null, b: ContactRole | null): ContactRole | null =>
    !a ? b : !b || a === b ? a : "both";
  const byKey = new Map(groups.flat().map((r) => [r.line, r]));
  for (const entry of entries) {
    if (!entry.contactKey) continue;
    const row = entry.lineNumbers.map((l) => byKey.get(l)).find((r) => r?.contact);
    const named = row?.contact as { name: string; role: ContactRole | null };
    const role = named.role ?? roleOf(entry);
    const existing = contacts.get(entry.contactKey);
    if (existing) existing.role = merge(existing.role, role);
    else contacts.set(entry.contactKey, { key: entry.contactKey, name: named.name, role });
  }

  return {
    entries,
    accounts: [...accounts.values()].sort((a, b) => b.lineCount - a.lineCount),
    contacts: [...contacts.values()]
      .map((c): ImportContactDraft => ({ ...c, role: c.role ?? "both" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    problems,
    skippedRows,
    firstDate: entries[0]?.date ?? null,
    lastDate: entries.at(-1)?.date ?? null,
  };
}

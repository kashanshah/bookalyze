import { minorUnits } from "../currency";
import {
  AMOUNT_SCALE,
  convertUnits,
  decimalPlaces,
  formatDecimal,
  isDecimal,
  parseDecimal,
  RATE_SCALE,
} from "../money";

/**
 * Journal entry rules, shared by the UI (live feedback) and the server (the authority before
 * anything is written). The database enforces the same balance invariant again on commit.
 *
 * Amounts are signed: debits are positive and credits negative. Every entry has one currency
 * and, when that isn't the base currency, one exchange rate; each line stores both its amount
 * and its base-currency amount, and both must sum to zero.
 */

export type JournalLineInput = {
  accountId: string;
  description?: string | undefined;
  /** Decimal strings; a line has a debit or a credit, not both. Blank means none. */
  debit?: string | undefined;
  credit?: string | undefined;
};

export type JournalEntryInput = {
  currency: string;
  baseCurrency: string;
  /** Base-currency units per one unit of `currency`. Ignored when currency = base. */
  fxRate?: string | undefined;
  lines: JournalLineInput[];
};

export type LedgerAccount = {
  id: string;
  name: string;
  /** Accounts locked to one currency (bank, card) only take entries in that currency. */
  currency: string | null;
  isArchived: boolean;
};

export type PreparedLine = {
  /** Position in the submitted lines (blank rows are skipped, so this can have gaps). */
  index: number;
  accountId: string;
  description: string | null;
  /** The line's currency (the entry currency, unless the entry mixes currencies). */
  currency: string;
  amount: string;
  baseAmount: string;
};

export type PreparedEntry = {
  currency: string;
  fxRate: string;
  lines: PreparedLine[];
  /** Total debits in the entry currency. */
  total: string;
};

export type JournalErrors = {
  form?: string;
  fxRate?: string;
  /** Errors keyed by the line's index in the submitted lines. */
  lines?: Record<number, string>;
};

export type PrepareResult =
  | { ok: true; entry: PreparedEntry }
  | { ok: false; errors: JournalErrors };

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/** Parses a positive amount with at most `decimals` places, or returns an error message. */
export function parsePositive(value: string, decimals: number, currency: string): bigint | string {
  const v = value.trim().replace(/,/g, "");
  if (!isDecimal(v)) return "Enter an amount like 125.50.";
  // Trailing zeros don't add precision: "12.5000" is a valid USD amount.
  const significant = v.includes(".") ? v.replace(/0+$/, "") : v;
  if (decimalPlaces(significant) > decimals) {
    return decimals === 0
      ? `${currency} amounts have no decimal places.`
      : `${currency} amounts have at most ${decimals} decimal places.`;
  }
  const units = parseDecimal(significant, AMOUNT_SCALE);
  if (units <= 0n) return "Amounts must be more than zero.";
  return units;
}

/** Live totals for a form that may still be incomplete. Unparseable amounts count as zero. */
export function journalTotals(lines: readonly JournalLineInput[]) {
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    for (const [field, isDebit] of [
      [line.debit, true],
      [line.credit, false],
    ] as const) {
      if (blank(field) || !isDecimal(field as string)) continue;
      try {
        const units = parseDecimal(field as string, AMOUNT_SCALE);
        if (units > 0n) {
          if (isDebit) debit += units;
          else credit += units;
        }
      } catch {
        // Too many decimals: ignored for the live total, reported on submit.
      }
    }
  }
  return {
    debit: formatDecimal(debit),
    credit: formatDecimal(credit),
    difference: formatDecimal(debit - credit),
    balanced: debit === credit && debit > 0n,
  };
}

/**
 * Validates a journal entry and computes signed amounts and base-currency amounts. Rows with no
 * account and no amount are treated as blank and skipped.
 */
export function prepareJournalEntry(
  input: JournalEntryInput,
  accounts: ReadonlyMap<string, LedgerAccount>,
): PrepareResult {
  const errors: JournalErrors = {};
  const lineErrors: Record<number, string> = {};
  const decimals = minorUnits(input.currency);
  const baseDecimals = minorUnits(input.baseCurrency);
  const foreign = input.currency !== input.baseCurrency;

  let fxRate = "1";
  if (foreign) {
    const rate = input.fxRate?.trim() ?? "";
    if (!rate)
      errors.fxRate = `Enter how many ${input.baseCurrency} one ${input.currency} was worth.`;
    else if (!isDecimal(rate) || decimalPlaces(rate) > RATE_SCALE) {
      errors.fxRate = "Enter a rate like 1.3650.";
    } else if (parseDecimal(rate, RATE_SCALE) <= 0n) {
      errors.fxRate = "The exchange rate must be more than zero.";
    } else {
      fxRate = formatDecimal(parseDecimal(rate, RATE_SCALE), RATE_SCALE);
    }
  }

  const parsed: { index: number; accountId: string; description: string | null; units: bigint }[] =
    [];
  input.lines.forEach((line, index) => {
    const hasDebit = !blank(line.debit);
    const hasCredit = !blank(line.credit);
    const accountId = line.accountId?.trim() ?? "";
    if (!accountId && !hasDebit && !hasCredit) return;

    if (!accountId) {
      lineErrors[index] = "Choose an account.";
      return;
    }
    const account = accounts.get(accountId);
    if (!account) {
      lineErrors[index] = "This account no longer exists.";
      return;
    }
    if (account.isArchived) {
      lineErrors[index] = `${account.name} is archived. Choose another account.`;
      return;
    }
    if (account.currency && account.currency !== input.currency) {
      lineErrors[index] = `${account.name} only holds ${account.currency}.`;
      return;
    }
    if (hasDebit && hasCredit) {
      lineErrors[index] = "Enter a debit or a credit, not both.";
      return;
    }
    if (!hasDebit && !hasCredit) {
      lineErrors[index] = "Enter a debit or a credit.";
      return;
    }
    const units = parsePositive(
      (hasDebit ? line.debit : line.credit) as string,
      decimals,
      input.currency,
    );
    if (typeof units === "string") {
      lineErrors[index] = units;
      return;
    }
    parsed.push({
      index,
      accountId,
      description: line.description?.trim() || null,
      units: hasDebit ? units : -units,
    });
  });

  if (Object.keys(lineErrors).length) errors.lines = lineErrors;
  if (errors.lines || errors.fxRate) return { ok: false, errors };

  if (parsed.length < 2) {
    return { ok: false, errors: { form: "An entry needs at least two lines." } };
  }
  const debits = parsed.reduce((t, l) => (l.units > 0n ? t + l.units : t), 0n);
  const credits = parsed.reduce((t, l) => (l.units < 0n ? t - l.units : t), 0n);
  if (debits !== credits) {
    const diff = formatDecimal(debits > credits ? debits - credits : credits - debits);
    return {
      ok: false,
      errors: {
        form: `Debits and credits must be equal. They're ${trimAmount(diff)} ${input.currency} apart.`,
      },
    };
  }

  // Base amounts: convert each line, then put any rounding residual on the largest line so the
  // entry balances exactly in the base currency too.
  const base = parsed.map((l) => (foreign ? convertUnits(l.units, fxRate, baseDecimals) : l.units));
  const residual = base.reduce((t, b) => t + b, 0n);
  if (residual !== 0n) {
    let largest = 0;
    base.forEach((b, i) => {
      const abs = b < 0n ? -b : b;
      const current = base[largest] as bigint;
      if (abs > (current < 0n ? -current : current)) largest = i;
    });
    base[largest] = (base[largest] as bigint) - residual;
  }

  return {
    ok: true,
    entry: {
      currency: input.currency,
      fxRate,
      total: formatDecimal(debits),
      lines: parsed.map((l, i) => ({
        index: l.index,
        accountId: l.accountId,
        description: l.description,
        currency: input.currency,
        amount: formatDecimal(l.units),
        baseAmount: formatDecimal(base[i] as bigint),
      })),
    },
  };
}

/** Lines that undo an entry: same accounts and amounts with the signs flipped. */
export function reversingLines<T extends { amount: string; baseAmount: string }>(lines: T[]): T[] {
  return lines.map((l) => ({
    ...l,
    amount: formatDecimal(-parseDecimal(l.amount)),
    baseAmount: formatDecimal(-parseDecimal(l.baseAmount)),
  }));
}

/** "12.5000" → "12.50"-style trimming of trailing zeros beyond two places, for messages. */
function trimAmount(value: string): string {
  return value.replace(/(\.\d\d\d*?)0+$/, "$1");
}

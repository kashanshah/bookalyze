import { minorUnits } from "../currency";
import {
  convertUnits,
  decimalPlaces,
  divideDecimals,
  formatDecimal,
  isDecimal,
  parseDecimal,
  RATE_SCALE,
} from "../money";
import {
  type JournalErrors,
  type JournalLineInput,
  type LedgerAccount,
  type PrepareResult,
  parsePositive,
  prepareJournalEntry,
} from "./journal";
import { splitTaxIncluded, type TaxRateInfo } from "./tax";

/**
 * Transactions are the everyday view of the ledger: money moving in or out of a "money account"
 * (cash, bank, card). Each one is an ordinary journal entry; these helpers turn a simple form
 * into journal lines and describe an entry back as a transaction.
 */

/** Subtypes whose accounts hold money and appear on the Transactions screen. */
export const MONEY_ACCOUNT_SUBTYPES = ["cash_bank", "credit_card", "money_in_transit"] as const;

export function isMoneyAccountSubtype(subtype: string): boolean {
  return (MONEY_ACCOUNT_SUBTYPES as readonly string[]).includes(subtype);
}

export const TRANSACTION_KINDS = ["deposit", "withdrawal", "transfer"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/**
 * A category line. Amounts are positive in the transaction's direction, negative against it, and
 * include tax when `taxRateId` is set.
 */
export type TransactionSplit = {
  accountId: string;
  amount: string;
  description?: string;
  taxRateId?: string;
};

export type TransactionInput =
  | {
      kind: "deposit" | "withdrawal";
      /** The bank, card or cash account the money went into or out of. */
      moneyAccountId: string;
      /** One or more categories; their amounts add up to the transaction total. */
      splits: TransactionSplit[];
    }
  | {
      kind: "transfer";
      fromAccountId: string;
      toAccountId: string;
      amount: string;
    };

/**
 * Journal lines for a transaction, as debit/credit strings for `prepareJournalEntry()`, which
 * does all the validation. Money in debits the money account; money out credits it.
 */
export function transactionLines(
  input: TransactionInput,
  memo?: string | null,
  /** Sales tax rates by id and the currency's decimals, to split tax out of tax-inclusive splits. */
  tax?: { rates: ReadonlyMap<string, TaxRateInfo>; decimals: number },
): JournalLineInput[] {
  if (input.kind === "transfer") {
    return [
      { accountId: input.toAccountId, debit: input.amount, description: memo ?? undefined },
      { accountId: input.fromAccountId, credit: input.amount, description: memo ?? undefined },
    ];
  }
  const deposit = input.kind === "deposit";
  let total = 0n;
  const categoryLines: JournalLineInput[] = input.splits.flatMap((split) => {
    // A negative split goes the other way, e.g. marketplace fees taken out of a payout.
    const raw = split.amount.trim();
    const negative = raw.startsWith("-");
    const amount = negative ? raw.slice(1) : raw;
    let units: bigint | null = null;
    try {
      units = parseDecimal(amount || "0");
      total += negative ? -units : units;
    } catch {
      // Invalid amounts are reported by prepareJournalEntry on the category line.
    }
    const credit = deposit !== negative;
    const side = (value: string) => (credit ? { credit: value } : { debit: value });
    const rate = split.taxRateId ? tax?.rates.get(split.taxRateId) : undefined;
    const description = split.description || undefined;
    if (!rate || units === null || units === 0n) {
      return [{ accountId: split.accountId, description, ...side(amount) }];
    }
    // Tax collected on sales is always split out; tax paid only when it can be claimed back.
    if (!deposit && !rate.isRecoverable) {
      return [{ accountId: split.accountId, description, taxRateId: rate.id, ...side(amount) }];
    }
    const { net, tax: taxUnits } = splitTaxIncluded(units, rate.rate, tax?.decimals ?? 2);
    const lines: JournalLineInput[] = [
      { accountId: split.accountId, description, taxRateId: rate.id, ...side(formatDecimal(net)) },
    ];
    if (taxUnits !== 0n) {
      lines.push({
        accountId: rate.accountId,
        description: rate.name,
        taxRateId: rate.id,
        ...side(formatDecimal(taxUnits)),
      });
    }
    return lines;
  });
  const moneyLine: JournalLineInput = {
    accountId: input.moneyAccountId,
    description: memo ?? undefined,
    ...(deposit
      ? { debit: total > 0n ? formatDecimal(total) : "" }
      : { credit: total > 0n ? formatDecimal(total) : "" }),
  };
  return [moneyLine, ...categoryLines];
}

export type LedgerLine = {
  accountId: string;
  amount: string;
  description?: string | null;
  /** The line's currency, when known (needed to describe cross-currency transfers). */
  currency?: string;
  taxRateId?: string | null;
};

export type TransactionView = {
  kind: TransactionKind;
  /** Positive amount of money that moved, in the entry currency. */
  amount: string;
  /** Money accounts touched (one for deposits and withdrawals, two for transfers). */
  moneyAccountIds: string[];
  /** For transfers: where the money came from and went to. */
  fromAccountId?: string;
  toAccountId?: string;
  /** For transfers between currencies: what arrived, in the receiving account's currency. */
  receivedAmount?: string;
  receivedCurrency?: string;
  /** Category lines (everything that isn't a money account), as positive amounts. */
  splits: TransactionSplit[];
  /**
   * The entry never said which bank, card or cash account the money moved through: an
   * Uncategorized line stands in for it (e.g. an import where the account was "Unknown").
   * `moneyAccountIds` is empty; choosing the account turns it into an ordinary transaction.
   */
  needsAccount?: boolean;
};

/**
 * Describes a journal entry as a transaction, or returns null when it doesn't touch a money
 * account. `isMoney` says whether an account is a money account.
 */
export function describeTransaction(
  lines: readonly LedgerLine[],
  isMoney: (accountId: string) => boolean,
  /** Uncategorized income and expense accounts, which can stand in for a missing money account. */
  isPlaceholder?: (accountId: string) => boolean,
): TransactionView | null {
  const money = lines.filter((l) => isMoney(l.accountId));
  if (money.length === 0) return isPlaceholder ? describeUnplaced(lines, isPlaceholder) : null;
  const others = lines.filter((l) => !isMoney(l.accountId));
  const net = money.reduce((t, l) => t + parseDecimal(l.amount), 0n);
  const abs = (v: bigint) => (v < 0n ? -v : v);

  // Only money accounts: money moved between the company's own accounts.
  if (others.length === 0) {
    const into = money.filter((l) => parseDecimal(l.amount) > 0n);
    const outOf = money.filter((l) => parseDecimal(l.amount) < 0n);
    const sent = outOf.reduce((t, l) => t - parseDecimal(l.amount), 0n);
    const received = into.reduce((t, l) => t + parseDecimal(l.amount), 0n);
    const fromCurrency = outOf[0]?.currency;
    const toCurrency = into[0]?.currency;
    const crossCurrency = Boolean(fromCurrency && toCurrency && fromCurrency !== toCurrency);
    return {
      kind: "transfer",
      amount: formatDecimal(sent),
      moneyAccountIds: [...new Set(money.map((l) => l.accountId))],
      fromAccountId: outOf[0]?.accountId,
      toAccountId: into[0]?.accountId,
      ...(crossCurrency
        ? { receivedAmount: formatDecimal(received), receivedCurrency: toCurrency }
        : {}),
      splits: [],
    };
  }

  const kind: TransactionKind = net >= 0n ? "deposit" : "withdrawal";
  return {
    kind,
    amount: formatDecimal(abs(net)),
    moneyAccountIds: [...new Set(money.map((l) => l.accountId))],
    splits: mergeTaxLines(others).map((l) => ({
      accountId: l.accountId,
      // Category amounts are shown in the transaction's direction (positive normally).
      amount: formatDecimal(kind === "deposit" ? -l.units : l.units),
      description: l.description ?? undefined,
      ...(l.taxRateId ? { taxRateId: l.taxRateId } : {}),
    })),
  };
}

/**
 * An entry with no money account but an Uncategorized line, read as money in or out of an account
 * nobody chose. The Uncategorized lines stand in for the money side; when every line is
 * Uncategorized (e.g. Uncategorized income → Uncategorized expense), the credits are the money
 * that went out and the debits what it was for. Null when nothing stands in.
 */
function describeUnplaced(
  lines: readonly LedgerLine[],
  isPlaceholder: (accountId: string) => boolean,
): TransactionView | null {
  const held = lines.filter((l) => isPlaceholder(l.accountId));
  if (held.length === 0) return null;
  let side = held;
  let others = lines.filter((l) => !isPlaceholder(l.accountId));
  if (others.length === 0) {
    side = lines.filter((l) => parseDecimal(l.amount) < 0n);
    others = lines.filter((l) => parseDecimal(l.amount) >= 0n);
  }
  const net = side.reduce((t, l) => t + parseDecimal(l.amount), 0n);
  if (net === 0n || others.length === 0) return null;
  const kind: TransactionKind = net > 0n ? "deposit" : "withdrawal";
  return {
    kind,
    amount: formatDecimal(net < 0n ? -net : net),
    moneyAccountIds: [],
    splits: mergeTaxLines(others).map((l) => ({
      accountId: l.accountId,
      amount: formatDecimal(kind === "deposit" ? -l.units : l.units),
      description: l.description ?? undefined,
      ...(l.taxRateId ? { taxRateId: l.taxRateId } : {}),
    })),
    needsAccount: true,
  };
}

/** Subtypes whose lines can stand in for a missing money account (see `describeTransaction`). */
export const PLACEHOLDER_ACCOUNT_SUBTYPES = [
  "uncategorized_income",
  "uncategorized_expense",
] as const;

export type TransferInput = {
  fromAccountId: string;
  toAccountId: string;
  /** Amount that left, in the sending account's currency. */
  sent: string;
  /** Amount that arrived, in the receiving account's currency (needed when currencies differ). */
  received?: string;
  baseCurrency: string;
  /**
   * Base-currency units per unit of the sending currency. Needed when the sending side isn't in
   * the base currency and neither side's amount already is (e.g. USD → EUR in a CAD company).
   */
  fxRate?: string;
  memo?: string | null;
};

/**
 * Prepares a transfer between two money accounts. Same-currency transfers are ordinary journal
 * entries. Between currencies, each side keeps its own currency and amount, and the base amount
 * comes from whichever side is already in the base currency (so the bank's actual exchange rate
 * is what's recorded). Line 0 is the receiving side, line 1 the sending side.
 */
export function prepareTransfer(
  input: TransferInput,
  accounts: ReadonlyMap<string, LedgerAccount>,
): PrepareResult {
  const from = accounts.get(input.fromAccountId);
  const to = accounts.get(input.toAccountId);
  const fromCurrency = from?.currency ?? input.baseCurrency;
  const toCurrency = to?.currency ?? input.baseCurrency;

  if (!from || !to || fromCurrency === toCurrency) {
    return prepareJournalEntry(
      {
        currency: fromCurrency,
        baseCurrency: input.baseCurrency,
        fxRate: input.fxRate,
        lines: transactionLines(
          {
            kind: "transfer",
            fromAccountId: input.fromAccountId,
            toAccountId: input.toAccountId,
            amount: input.sent,
          },
          input.memo,
        ),
      },
      accounts,
    );
  }

  const errors: JournalErrors = {};
  const lineErrors: Record<number, string> = {};
  for (const [index, account] of [
    [0, to],
    [1, from],
  ] as const) {
    if (account.isArchived)
      lineErrors[index] = `${account.name} is archived. Choose another account.`;
  }
  const sent = parsePositive(input.sent ?? "", minorUnits(fromCurrency), fromCurrency);
  if (typeof sent === "string")
    lineErrors[1] = input.sent ? sent : `Enter how much ${fromCurrency} was sent.`;
  const received = parsePositive(input.received ?? "", minorUnits(toCurrency), toCurrency);
  if (typeof received === "string") {
    lineErrors[0] = input.received ? received : `Enter how much ${toCurrency} arrived.`;
  }

  // The base amount: whichever side is in the base currency, else the sending side at the rate.
  let base: bigint | null = null;
  if (typeof received !== "string" && toCurrency === input.baseCurrency) base = received;
  else if (typeof sent !== "string" && fromCurrency === input.baseCurrency) base = sent;
  else if (typeof sent !== "string") {
    const rate = input.fxRate?.trim() ?? "";
    if (!rate)
      errors.fxRate = `Enter how many ${input.baseCurrency} one ${fromCurrency} was worth.`;
    else if (
      !isDecimal(rate) ||
      decimalPlaces(rate) > RATE_SCALE ||
      parseDecimal(rate, RATE_SCALE) <= 0n
    ) {
      errors.fxRate = "Enter a rate like 1.3650.";
    } else base = convertUnits(sent, rate, minorUnits(input.baseCurrency));
  }

  if (Object.keys(lineErrors).length) errors.lines = lineErrors;
  if (
    errors.lines ||
    errors.fxRate ||
    base === null ||
    typeof sent === "string" ||
    typeof received === "string"
  ) {
    return { ok: false, errors };
  }
  if (base === 0n) return { ok: false, errors: { form: "This transfer is too small to record." } };

  return {
    ok: true,
    entry: {
      currency: fromCurrency,
      fxRate: divideDecimals(formatDecimal(base), formatDecimal(sent)),
      total: formatDecimal(sent),
      lines: [
        {
          index: 0,
          accountId: to.id,
          description: input.memo ?? null,
          currency: toCurrency,
          amount: formatDecimal(received),
          baseAmount: formatDecimal(base),
        },
        {
          index: 1,
          accountId: from.id,
          description: input.memo ?? null,
          currency: fromCurrency,
          amount: formatDecimal(-sent),
          baseAmount: formatDecimal(-base),
        },
      ],
    },
  };
}

/**
 * Folds each tax line into the category line before it (same tax rate), so a taxed split reads
 * back as one tax-inclusive amount, the way it was entered.
 */
function mergeTaxLines(lines: readonly LedgerLine[]) {
  type Merged = {
    accountId: string;
    units: bigint;
    description?: string | null;
    taxRateId?: string | null;
    hasTax: boolean;
  };
  const merged: Merged[] = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    const units = parseDecimal(line.amount);
    if (line.taxRateId && previous?.taxRateId === line.taxRateId && !previous.hasTax) {
      previous.units += units;
      previous.hasTax = true;
      continue;
    }
    merged.push({
      accountId: line.accountId,
      units,
      description: line.description,
      taxRateId: line.taxRateId,
      hasTax: false,
    });
  }
  return merged;
}

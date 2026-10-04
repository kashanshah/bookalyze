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

/** A category line. Amounts are positive in the transaction's direction, negative against it. */
export type TransactionSplit = { accountId: string; amount: string; description?: string };

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
): JournalLineInput[] {
  if (input.kind === "transfer") {
    return [
      { accountId: input.toAccountId, debit: input.amount, description: memo ?? undefined },
      { accountId: input.fromAccountId, credit: input.amount, description: memo ?? undefined },
    ];
  }
  const deposit = input.kind === "deposit";
  let total = 0n;
  const categoryLines: JournalLineInput[] = input.splits.map((split) => {
    // A negative split goes the other way, e.g. marketplace fees taken out of a payout.
    const raw = split.amount.trim();
    const negative = raw.startsWith("-");
    const amount = negative ? raw.slice(1) : raw;
    try {
      const units = parseDecimal(amount || "0");
      total += negative ? -units : units;
    } catch {
      // Invalid amounts are reported by prepareJournalEntry on the category line.
    }
    const credit = deposit !== negative;
    return {
      accountId: split.accountId,
      description: split.description || undefined,
      ...(credit ? { credit: amount } : { debit: amount }),
    };
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
};

/**
 * Describes a journal entry as a transaction, or returns null when it doesn't touch a money
 * account. `isMoney` says whether an account is a money account.
 */
export function describeTransaction(
  lines: readonly LedgerLine[],
  isMoney: (accountId: string) => boolean,
): TransactionView | null {
  const money = lines.filter((l) => isMoney(l.accountId));
  if (money.length === 0) return null;
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
    splits: others.map((l) => ({
      accountId: l.accountId,
      // Category amounts are shown in the transaction's direction (positive normally).
      amount: formatDecimal(kind === "deposit" ? -parseDecimal(l.amount) : parseDecimal(l.amount)),
      description: l.description ?? undefined,
    })),
  };
}

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

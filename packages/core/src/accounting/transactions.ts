import { formatDecimal, parseDecimal } from "../money";
import type { JournalLineInput } from "./journal";

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

export type LedgerLine = { accountId: string; amount: string; description?: string | null };

export type TransactionView = {
  kind: TransactionKind;
  /** Positive amount of money that moved, in the entry currency. */
  amount: string;
  /** Money accounts touched (one for deposits and withdrawals, two for transfers). */
  moneyAccountIds: string[];
  /** For transfers: where the money came from and went to. */
  fromAccountId?: string;
  toAccountId?: string;
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

  if (others.length === 0 && net === 0n) {
    const into = money.filter((l) => parseDecimal(l.amount) > 0n);
    const outOf = money.filter((l) => parseDecimal(l.amount) < 0n);
    const moved = into.reduce((t, l) => t + parseDecimal(l.amount), 0n);
    return {
      kind: "transfer",
      amount: formatDecimal(moved),
      moneyAccountIds: [...new Set(money.map((l) => l.accountId))],
      fromAccountId: outOf[0]?.accountId,
      toAccountId: into[0]?.accountId,
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

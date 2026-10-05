import type { TransactionInput } from "../accounting/transactions";
import { formatDecimal, parseDecimal } from "../money";

/**
 * A transaction from a bank, whatever it came from (a connection such as Wise, or later a
 * statement file), and how it's first posted: to the bank account and "Uncategorized" (or the
 * fee account), ready to be categorized on the Transactions screen.
 */

export type BankTransaction = {
  /** Unique and stable for this transaction at this bank: the duplicate check. */
  externalId: string;
  /** Links the two sides of one movement between the company's own accounts (a conversion). */
  pairKey?: string;
  /** The day it happened, in the company's time zone. */
  date: string;
  /** The bank account's currency. */
  currency: string;
  /** Signed, at 4 decimals: positive = money in. Fees are included. */
  amount: string;
  /** Fees within `amount`, positive. */
  fee: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
  kind: "card" | "deposit" | "transfer" | "conversion" | "fee" | "interest" | "other";
  /** For a conversion: the other side's currency and amount (positive). */
  conversion?: { otherCurrency: string; otherAmount: string };
};

export type PostingAccounts = {
  /** The money account the feed fills. */
  moneyAccountId: string;
  uncategorizedIncomeId: string;
  uncategorizedExpenseId: string;
  /** Where the bank's fees go. */
  feeAccountId: string;
};

/**
 * The transaction to post for a bank line on its own: money in or out of the bank account, the
 * amount before fees to "Uncategorized", and any fee as its own split. A deposit that had a fee
 * taken off shows the full amount received less the fee.
 */
export function bankTransactionInput(
  line: BankTransaction,
  accounts: PostingAccounts,
): Extract<TransactionInput, { kind: "deposit" | "withdrawal" }> {
  const amount = parseDecimal(line.amount);
  const fee = parseDecimal(line.fee);
  const moneyIn = amount > 0n;
  const total = moneyIn ? amount : -amount;
  const splits: { accountId: string; amount: string; description?: string }[] = [];
  if (line.kind === "fee") {
    splits.push({ accountId: accounts.feeAccountId, amount: formatDecimal(total) });
  } else if (moneyIn) {
    // What arrived plus the fee kept back, then the fee against it.
    splits.push({ accountId: accounts.uncategorizedIncomeId, amount: formatDecimal(total + fee) });
    if (fee > 0n)
      splits.push({
        accountId: accounts.feeAccountId,
        amount: formatDecimal(-fee),
        description: "Bank fee",
      });
  } else {
    splits.push({ accountId: accounts.uncategorizedExpenseId, amount: formatDecimal(total - fee) });
    if (fee > 0n)
      splits.push({
        accountId: accounts.feeAccountId,
        amount: formatDecimal(fee),
        description: "Bank fee",
      });
  }
  return {
    kind: moneyIn ? "deposit" : "withdrawal",
    moneyAccountId: accounts.moneyAccountId,
    splits: splits.filter((s) => parseDecimal(s.amount) !== 0n),
  };
}

/** What the entry says, e.g. "Card payment · Staples" or the bank's own description. */
export function bankMemo(line: BankTransaction): string {
  const text = line.description.replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/**
 * Both sides of conversions between two of the feed's own accounts, by pair key. Each pair
 * becomes one transfer; lines whose other side isn't being imported stay on their own.
 */
export function pairConversions<T extends BankTransaction>(
  lines: readonly T[],
): {
  pairs: { from: T; to: T }[];
  singles: T[];
} {
  const byKey = new Map<string, T[]>();
  const singles: T[] = [];
  for (const line of lines) {
    if (line.kind !== "conversion" || !line.pairKey) {
      singles.push(line);
      continue;
    }
    const group = byKey.get(line.pairKey) ?? [];
    group.push(line);
    byKey.set(line.pairKey, group);
  }
  const pairs: { from: T; to: T }[] = [];
  for (const group of byKey.values()) {
    const from = group.find((l) => parseDecimal(l.amount) < 0n);
    const to = group.find((l) => parseDecimal(l.amount) > 0n);
    if (group.length === 2 && from && to && from.currency !== to.currency) pairs.push({ from, to });
    else singles.push(...group);
  }
  return { pairs, singles };
}

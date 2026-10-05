import type { AccountType, TransactionKind } from "@bookalyze/core";

/** Shapes passed from the Transactions page (server) to its client components. */

export type ContactOption = {
  id: string;
  name: string;
  type: "customer" | "vendor" | "both";
  isArchived?: boolean;
};

export type MoneyAccountOption = { id: string; label: string; currency: string };

export type CategoryGroup = {
  type: AccountType;
  options: { id: string; label: string }[];
};

export type TxRow = {
  id: string;
  number: string;
  date: string;
  memo: string | null;
  currency: string;
  fxRate: string;
  reviewed: boolean;
  /** Statement date it was reconciled to; reconciled transactions can't be changed. */
  reconciledThrough: string | null;
  contactId: string | null;
  /** Number of receipts and files attached. */
  attachments: number;
  kind: TransactionKind;
  /** Positive amount moved, in the transaction currency. */
  amount: string;
  moneyAccountIds: string[];
  fromAccountId?: string;
  toAccountId?: string;
  /** Transfers between currencies: what arrived, in the receiving account's currency. */
  receivedAmount?: string;
  receivedCurrency?: string;
  splits: { accountId: string; amount: string; description?: string; taxRateId?: string }[];
  /** No bank, card or cash account was ever chosen (an Uncategorized line stands in for it). */
  needsAccount?: boolean;
  /** A transfer made by matching two bank transactions (so it can be unmatched). */
  matchedTransfer?: boolean;
  /** Looks like one side of a transfer: money out of one account and into another. */
  transfer?: {
    outId: string;
    inId: string;
    other: {
      id: string;
      number: string;
      date: string;
      memo: string | null;
      accountId: string;
      amount: string;
      currency: string;
    };
  };
  /** The words of the rule that categorized it, if one did. */
  rule?: string;
  /** Flagged as possibly a copy of a transaction already in the books. */
  duplicate?: {
    suggestionId: string;
    of: { id: string; number: string; date: string; memo: string | null; origin: string };
  };
};

export type TaxRateOption = {
  id: string;
  name: string;
  /** Percent, e.g. "13.0000". */
  rate: string;
  isRecoverable: boolean;
  isArchived: boolean;
};

export type TxFormContext = {
  slug: string;
  today: string;
  baseCurrency: string;
  locale: string;
  lockedThrough: string | null;
  moneyAccounts: MoneyAccountOption[];
  categories: CategoryGroup[];
  accountNames: Record<string, string>;
  contacts: ContactOption[];
  /** Sales tax rates, archived ones included so older transactions still show theirs. */
  taxRates: TaxRateOption[];
  /** Banking rules are available, so a transaction can become a rule. */
  canMakeRules: boolean;
};

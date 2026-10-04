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
};

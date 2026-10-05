import type { AccountType, RuleDirection } from "@bookalyze/core";

/** Shapes passed from the Rules page (server) to its client components. */

export type RuleView = {
  id: string;
  matchText: string;
  direction: RuleDirection;
  amountMin: string | null;
  amountMax: string | null;
  accountId: string | null;
  accountName: string | null;
  categoryAccountId: string;
  categoryName: string;
  contactId: string | null;
  contactName: string | null;
  isActive: boolean;
  /** Current transactions this rule categorized. */
  applied: number;
};

export type RuleFormContext = {
  slug: string;
  currency: string;
  locale: string;
  moneyAccounts: { id: string; label: string }[];
  categories: { type: AccountType; options: { id: string; label: string }[] }[];
  contacts: { id: string; name: string }[];
};

import { parseDecimal } from "../money";

/**
 * Rules that categorize bank transactions as they arrive: "when the description contains BELL,
 * file it under Telephone". The first active rule that matches, in order, wins. A categorized
 * transaction still waits for review on the Transactions screen.
 */

export const RULE_DIRECTIONS = ["any", "in", "out"] as const;
export type RuleDirection = (typeof RULE_DIRECTIONS)[number];

export type BankRule = {
  id: string;
  /** Words the description must contain (case and spacing don't matter). */
  matchText: string;
  direction: RuleDirection;
  /** Positive amounts, inclusive; null for no limit. */
  amountMin: string | null;
  amountMax: string | null;
  /** Only this bank or card account; null for any. */
  accountId: string | null;
  categoryAccountId: string;
  contactId: string | null;
  isActive: boolean;
};

export type RuleSubject = {
  /** Everything the bank said about it: description, counterparty, memo. */
  text: string;
  /** Signed: positive is money in. */
  amount: string;
  /** The bank or card account it's on. */
  accountId: string;
};

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Whether `rule` applies to `subject`. */
export function ruleMatches(rule: BankRule, subject: RuleSubject): boolean {
  if (!rule.isActive) return false;
  const words = normalize(rule.matchText);
  if (!words || !normalize(subject.text).includes(words)) return false;
  const amount = parseDecimal(subject.amount);
  if (rule.direction === "in" && amount <= 0n) return false;
  if (rule.direction === "out" && amount >= 0n) return false;
  const size = amount < 0n ? -amount : amount;
  if (rule.amountMin && size < parseDecimal(rule.amountMin)) return false;
  if (rule.amountMax && size > parseDecimal(rule.amountMax)) return false;
  if (rule.accountId && rule.accountId !== subject.accountId) return false;
  return true;
}

/** The first rule, in order, that applies; null when none does. */
export function firstMatchingRule<R extends BankRule>(
  rules: readonly R[],
  subject: RuleSubject,
): R | null {
  return rules.find((rule) => ruleMatches(rule, subject)) ?? null;
}

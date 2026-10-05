import { parseDecimal } from "../money";
import { type BankRule, type RuleDirection, ruleMatches } from "./rules";

/**
 * Rule suggestions: when the same payee keeps being categorized the same way by hand, offer to
 * make it a rule. A payee is the first few words of what the bank said, without reference
 * numbers and filler like "POS PURCHASE".
 */

/** How many hand-categorized transactions it takes before a rule is suggested. */
export const RULE_SUGGESTION_MIN = 3;
/** Share of them (in percent) that must have gone to the same category. */
export const RULE_SUGGESTION_AGREEMENT = 80;

/** Words banks add that say nothing about who was paid. */
const FILLER = new Set([
  "pos",
  "purchase",
  "debit",
  "credit",
  "card",
  "payment",
  "online",
  "banking",
  "transfer",
  "preauthorized",
  "pre-authorized",
  "interac",
  "e-transfer",
  "etransfer",
  "bill",
  "pay",
  "withdrawal",
  "deposit",
  "the",
  "ref",
  "txn",
  "transaction",
  "mobile",
  "contactless",
  "visa",
  "mastercard",
  "to",
  "from",
  "fee",
  "misc",
  "memo",
]);

const isWord = (token: string) =>
  token.length >= 2 && /^[a-z][a-z&'.-]*$/.test(token) && !FILLER.has(token);

/**
 * The words that identify who a transaction was with, e.g. "POS PURCHASE BELL CANADA 0423" →
 * "bell canada". Up to three words in a row, so the result is always found as-is in the
 * description (which is what a rule looks for). Empty when nothing usable is left.
 */
export function payeeKey(text: string): string {
  const tokens = text.toLowerCase().replace(/\s+/g, " ").trim().split(" ");
  const start = tokens.findIndex(isWord);
  if (start === -1) return "";
  const words: string[] = [];
  for (let i = start; i < tokens.length && words.length < 3; i++) {
    const token = tokens[i] as string;
    if (!isWord(token)) break;
    words.push(token);
  }
  return words.join(" ");
}

/** A transaction someone categorized by hand. */
export type CategorizedTransaction = {
  /** Everything the bank said about it. */
  text: string;
  /** Signed: positive is money in. */
  amount: string;
  accountId: string;
  categoryAccountId: string;
};

export type RuleSuggestion = {
  matchText: string;
  direction: Exclude<RuleDirection, "any">;
  categoryAccountId: string;
  /** How many transactions went to that category. */
  count: number;
};

/**
 * Payees categorized the same way at least `RULE_SUGGESTION_MIN` times (and at least
 * `RULE_SUGGESTION_AGREEMENT`% of the time), most frequent first. Payees an existing rule
 * already covers, or that someone turned down (`dismissed`, by match text), are left out.
 */
export function suggestRules(
  transactions: readonly CategorizedTransaction[],
  rules: readonly BankRule[],
  dismissed: ReadonlySet<string> = new Set(),
  limit = 10,
): RuleSuggestion[] {
  const groups = new Map<string, CategorizedTransaction[]>();
  for (const t of transactions) {
    const key = payeeKey(t.text);
    if (!key || dismissed.has(key)) continue;
    const direction = parseDecimal(t.amount) < 0n ? "out" : "in";
    const id = `${direction}|${key}`;
    groups.set(id, [...(groups.get(id) ?? []), t]);
  }
  const suggestions: RuleSuggestion[] = [];
  for (const [id, items] of groups) {
    if (items.length < RULE_SUGGESTION_MIN) continue;
    const [direction, matchText] = id.split("|") as ["in" | "out", string];
    const byCategory = new Map<string, number>();
    for (const t of items) {
      byCategory.set(t.categoryAccountId, (byCategory.get(t.categoryAccountId) ?? 0) + 1);
    }
    const [categoryAccountId, count] = [...byCategory].sort((a, b) => b[1] - a[1])[0] as [
      string,
      number,
    ];
    if (count < RULE_SUGGESTION_MIN || count * 100 < items.length * RULE_SUGGESTION_AGREEMENT) {
      continue;
    }
    const covered = items.some((t) =>
      rules.some((r) => ruleMatches(r, { text: t.text, amount: t.amount, accountId: t.accountId })),
    );
    if (covered) continue;
    suggestions.push({ matchText, direction, categoryAccountId, count });
  }
  return suggestions
    .sort((a, b) => b.count - a.count || a.matchText.localeCompare(b.matchText))
    .slice(0, limit);
}

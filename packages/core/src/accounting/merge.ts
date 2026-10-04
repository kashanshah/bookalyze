import { parseDecimal } from "../money";
import type { TransactionView } from "./transactions";

/** What `mergeProblem` compares: a transaction as the Transactions screen describes it. */
export type MergeCandidate = Pick<
  TransactionView,
  "kind" | "amount" | "moneyAccountIds" | "fromAccountId" | "toAccountId" | "splits"
> & { currency: string };

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
};

/**
 * Why two transactions can't be merged by hand, or null when they can: they must be the same
 * amount, in the same direction, on the same bank account, with the same category (for a split,
 * the same categories). The same rule as Wave's, so a merge never changes what the books say
 * about where money went.
 */
export function mergeProblem(a: MergeCandidate, b: MergeCandidate): string | null {
  if (
    a.kind !== b.kind ||
    a.currency !== b.currency ||
    parseDecimal(a.amount) !== parseDecimal(b.amount)
  ) {
    return "They need to be the same amount, in the same direction.";
  }
  const sameAccounts =
    a.kind === "transfer"
      ? a.fromAccountId === b.fromAccountId && a.toAccountId === b.toAccountId
      : sameSet(a.moneyAccountIds, b.moneyAccountIds);
  if (!sameAccounts) return "They need to be on the same bank account.";
  if (
    !sameSet(
      a.splits.map((s) => s.accountId),
      b.splits.map((s) => s.accountId),
    )
  ) {
    return "They need the same category. Categorize them the same way first.";
  }
  return null;
}

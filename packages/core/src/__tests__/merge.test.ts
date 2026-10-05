import { describe, expect, it } from "vitest";
import { type MergeCandidate, mergeProblem } from "../accounting/merge";

const expense = (over: Partial<MergeCandidate> = {}): MergeCandidate => ({
  kind: "withdrawal",
  amount: "7.76",
  currency: "CAD",
  moneyAccountIds: ["bank"],
  splits: [{ accountId: "meals", amount: "7.76" }],
  ...over,
});

describe("mergeProblem", () => {
  it("allows the same amount, bank account and category", () => {
    expect(mergeProblem(expense(), expense({ amount: "7.7600" }))).toBeNull();
  });

  it("refuses a different amount, direction or currency", () => {
    expect(mergeProblem(expense(), expense({ amount: "7.75" }))).toMatch(/same amount/);
    expect(mergeProblem(expense(), expense({ kind: "deposit" }))).toMatch(/same amount/);
    expect(mergeProblem(expense(), expense({ currency: "USD" }))).toMatch(/same amount/);
  });

  it("refuses a different bank account", () => {
    expect(mergeProblem(expense(), expense({ moneyAccountIds: ["card"] }))).toMatch(
      /same bank account/,
    );
  });

  it("refuses a different category, including uncategorized against categorized", () => {
    expect(
      mergeProblem(
        expense(),
        expense({ splits: [{ accountId: "uncategorized", amount: "7.76" }] }),
      ),
    ).toMatch(/same category/);
  });

  it("compares transfers by where the money came from and went to", () => {
    const transfer = (from: string, to: string): MergeCandidate => ({
      kind: "transfer",
      amount: "100",
      currency: "CAD",
      moneyAccountIds: [from, to],
      fromAccountId: from,
      toAccountId: to,
      splits: [],
    });
    expect(mergeProblem(transfer("a", "b"), transfer("a", "b"))).toBeNull();
    expect(mergeProblem(transfer("a", "b"), transfer("b", "a"))).toMatch(/same bank account/);
  });
});

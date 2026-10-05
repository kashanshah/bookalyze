import { describe, expect, it } from "vitest";
import { type BankRule, firstMatchingRule, ruleMatches } from "../banking/rules";

const rule = (over: Partial<BankRule> = {}): BankRule => ({
  id: "r1",
  matchText: "bell canada",
  direction: "any",
  amountMin: null,
  amountMax: null,
  accountId: null,
  categoryAccountId: "phone",
  contactId: null,
  isActive: true,
  ...over,
});
const subject = { text: "PAD  BELL  CANADA 123", amount: "-85.0000", accountId: "chequing" };

describe("bank rules", () => {
  it("matches words in the description, whatever the case and spacing", () => {
    expect(ruleMatches(rule(), subject)).toBe(true);
    expect(ruleMatches(rule({ matchText: "rogers" }), subject)).toBe(false);
    expect(ruleMatches(rule({ matchText: "  " }), subject)).toBe(false);
  });

  it("checks money in or out, the amount range and the account", () => {
    expect(ruleMatches(rule({ direction: "out" }), subject)).toBe(true);
    expect(ruleMatches(rule({ direction: "in" }), subject)).toBe(false);
    expect(ruleMatches(rule({ amountMin: "50", amountMax: "100" }), subject)).toBe(true);
    expect(ruleMatches(rule({ amountMax: "80" }), subject)).toBe(false);
    expect(ruleMatches(rule({ accountId: "card" }), subject)).toBe(false);
    expect(ruleMatches(rule({ isActive: false }), subject)).toBe(false);
  });

  it("uses the first matching rule in order", () => {
    const rules = [rule({ id: "a", matchText: "rogers" }), rule({ id: "b" }), rule({ id: "c" })];
    expect(firstMatchingRule(rules, subject)?.id).toBe("b");
    expect(firstMatchingRule([rule({ matchText: "x" })], subject)).toBeNull();
  });
});

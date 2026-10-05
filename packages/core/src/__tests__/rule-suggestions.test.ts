import { describe, expect, it } from "vitest";
import { type CategorizedTransaction, payeeKey, suggestRules } from "../banking/rule-suggestions";
import type { BankRule } from "../banking/rules";

const bell = (
  category = "phone",
  text = "POS PURCHASE BELL CANADA 0423",
): CategorizedTransaction => ({
  text,
  amount: "-85.50",
  accountId: "chequing",
  categoryAccountId: category,
});

describe("payeeKey", () => {
  it("keeps who it was with and drops reference numbers and filler", () => {
    expect(payeeKey("POS PURCHASE BELL CANADA 0423")).toBe("bell canada");
    expect(payeeKey("Interac e-Transfer to Jane Doe ref 88123")).toBe("jane doe");
    expect(payeeKey("AMZN Mktp CA*2K3L9 Amazon.ca")).toBe("amzn mktp");
    expect(payeeKey("SHOPIFY PAYMENTS PAYOUT")).toBe("shopify payments payout");
    expect(payeeKey("12345 / 678")).toBe("");
  });
});

describe("suggestRules", () => {
  it("suggests a payee categorized the same way three times or more", () => {
    expect(suggestRules([bell(), bell(), bell(), bell("phone", "BELL CANADA ONLINE")], [])).toEqual(
      [{ matchText: "bell canada", direction: "out", categoryAccountId: "phone", count: 4 }],
    );
  });

  it("needs enough of them, mostly in one category", () => {
    expect(suggestRules([bell(), bell()], [])).toEqual([]);
    expect(suggestRules([bell(), bell(), bell("meals"), bell("travel")], [])).toEqual([]);
  });

  it("leaves out payees a rule covers or someone turned down", () => {
    const rule: BankRule = {
      id: "r",
      matchText: "Bell",
      direction: "any",
      amountMin: null,
      amountMax: null,
      accountId: null,
      categoryAccountId: "phone",
      contactId: null,
      isActive: true,
    };
    const items = [bell(), bell(), bell()];
    expect(suggestRules(items, [rule])).toEqual([]);
    expect(suggestRules(items, [], new Set(["bell canada"]))).toEqual([]);
  });
});

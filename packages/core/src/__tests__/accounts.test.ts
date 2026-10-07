import { describe, expect, it } from "vitest";
import { ACCOUNT_SUBTYPES, canHoldOneCurrency } from "../accounting/accounts";

describe("account currencies", () => {
  it("lets only assets and liabilities be kept to one currency", () => {
    expect(canHoldOneCurrency("asset")).toBe(true);
    expect(canHoldOneCurrency("liability")).toBe(true);
    expect(canHoldOneCurrency("income")).toBe(false);
    expect(canHoldOneCurrency("expense")).toBe(false);
    expect(canHoldOneCurrency("equity")).toBe(false);
  });

  it("only asks a currency of accounts that can hold one", () => {
    for (const s of ACCOUNT_SUBTYPES) {
      if ("needsCurrency" in s && s.needsCurrency) expect(canHoldOneCurrency(s.type)).toBe(true);
    }
  });
});

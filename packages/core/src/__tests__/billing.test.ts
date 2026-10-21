import { describe, expect, it } from "vitest";
import {
  BILLING_ADD_ONS,
  BILLING_PACKAGES,
  catalogProblems,
  entitledModules,
  parseLookupKey,
  priceLookupKey,
  readOnlyModules,
  selectionProblem,
  selectionTotal,
  suggestedSelection,
} from "../billing";

const now = new Date("2026-12-10T12:00:00Z");
const billing = { now, billingStartsOn: "2026-12-01" };

describe("billing catalogue", () => {
  it("has the prices from the plan, yearly as ten months", () => {
    expect(BILLING_PACKAGES.books.monthly).toBe("9.00");
    expect(BILLING_PACKAGES.seller.monthly).toBe("19.00");
    expect(BILLING_PACKAGES.seller_plus.monthly).toBe("29.00");
    expect(BILLING_ADD_ONS.stock.monthly).toBe("8.00");
    expect(BILLING_ADD_ONS.reviews.monthly).toBe("5.00");
    for (const item of [...Object.values(BILLING_PACKAGES), ...Object.values(BILLING_ADD_ONS)]) {
      expect(Number(item.yearly)).toBe(Number(item.monthly) * 10);
    }
  });

  it("gives every module what it requires", () => {
    expect(catalogProblems()).toEqual([]);
  });

  it("adds up a selection and refuses add-ons that don't fit", () => {
    expect(
      selectionTotal({ package: "seller", addOns: ["stock", "reviews"], interval: "month" }),
    ).toBe("32.00");
    expect(selectionTotal({ package: "books", addOns: [], interval: "year" })).toBe("90.00");
    expect(
      selectionProblem({ package: "seller", addOns: ["stock"], interval: "month" }),
    ).toBeNull();
    expect(selectionProblem({ package: "books", addOns: ["stock"], interval: "month" })).toMatch(
      "can't be added to Books",
    );
  });

  it("names Stripe prices by lookup key", () => {
    expect(priceLookupKey("seller_plus", "year")).toBe("seller_plus_year");
    expect(parseLookupKey("seller_plus_year")).toEqual({ key: "seller_plus", interval: "year" });
    expect(parseLookupKey("seller_month")).toEqual({ key: "seller", interval: "month" });
    expect(parseLookupKey("gold_month")).toBeNull();
  });

  it("suggests a selection from what's switched on", () => {
    expect(suggestedSelection(["accounting", "banking"])).toEqual({ package: "books", addOns: [] });
    expect(suggestedSelection(["accounting", "commerce", "reviews"])).toEqual({
      package: "seller",
      addOns: ["reviews"],
    });
    expect(suggestedSelection(["accounting", "commerce", "inventory", "reviews"])).toEqual({
      package: "seller_plus",
      addOns: [],
    });
  });
});

describe("entitlements", () => {
  it("leaves everything free before billing starts", () => {
    expect(entitledModules(null, { now, billingStartsOn: null }).mode).toBe("early_access");
    const early = entitledModules(null, { now, billingStartsOn: "2027-01-01" });
    expect(early.mode).toBe("early_access");
    expect(early.modules).toContain("inventory");
  });

  it("unlocks the subscription's modules once billing has started", () => {
    const seller = entitledModules({ status: "active", items: ["seller", "stock"] }, billing);
    expect(seller.mode).toBe("subscribed");
    expect(seller.modules).toEqual([
      "accounting",
      "banking",
      "commerce",
      "inventory",
      "analytics",
      "entity",
    ]);
    expect(entitledModules(null, billing)).toMatchObject({ mode: "none", modules: [] });
  });

  it("keeps working for a week after a failed payment, then lapses", () => {
    const failed = new Date("2026-12-06T00:00:00Z");
    expect(
      entitledModules({ status: "past_due", items: ["books"], paymentFailedAt: failed }, billing)
        .mode,
    ).toBe("grace");
    const later = { now: new Date("2026-12-14T00:00:00Z"), billingStartsOn: "2026-12-01" };
    expect(
      entitledModules({ status: "past_due", items: ["books"], paymentFailedAt: failed }, later),
    ).toMatchObject({ mode: "lapsed", modules: [] });
    expect(entitledModules({ status: "canceled", items: ["books"] }, billing).mode).toBe("lapsed");
  });

  it("removing an add-on makes only that module read-only (the independence rule)", () => {
    const enabled = [
      "accounting",
      "banking",
      "commerce",
      "inventory",
      "reviews",
      "entity",
    ] as const;
    const before = entitledModules(
      { status: "active", items: ["seller", "stock", "reviews"] },
      billing,
    );
    expect(readOnlyModules(enabled, before)).toEqual([]);
    const after = entitledModules({ status: "active", items: ["seller", "reviews"] }, billing);
    expect(readOnlyModules(enabled, after)).toEqual(["inventory"]);
    expect(after.modules).toEqual(expect.arrayContaining(["accounting", "commerce", "reviews"]));
  });
});

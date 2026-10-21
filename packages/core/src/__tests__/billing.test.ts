import { describe, expect, it } from "vitest";
import {
  BILLING_ADD_ONS,
  BILLING_PACKAGES,
  CONNECTION_AREA,
  catalogProblems,
  entitledModules,
  firstChargeOn,
  mayChange,
  parseLookupKey,
  priceLookupKey,
  readOnlyModules,
  selectionProblem,
  selectionTotal,
  signupTrialDays,
  suggestedSelection,
  TRIAL_DAYS,
  trialDaysLeft,
  trialEndsOn,
} from "../billing";

const now = new Date("2026-12-10T12:00:00Z");
// Billing started long enough ago that the 30-day trial is over.
const billing = { now, billingStartsOn: "2026-10-01" };

describe("billing catalogue", () => {
  it("has the prices from the plan, yearly as ten months", () => {
    expect(BILLING_PACKAGES.books.monthly).toBe("9.00");
    expect(BILLING_PACKAGES.seller.monthly).toBe("19.00");
    expect(BILLING_PACKAGES.seller_plus.monthly).toBe("29.00");
    expect(BILLING_PACKAGES.reviews_only.monthly).toBe("9.00");
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
    expect(parseLookupKey("reviews_only_year")).toEqual({ key: "reviews_only", interval: "year" });
    expect(parseLookupKey("reviews_month")).toEqual({ key: "reviews", interval: "month" });
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
    const later = { now: new Date("2026-12-14T00:00:00Z"), billingStartsOn: "2026-10-01" };
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

describe("review requests on their own", () => {
  const enabled = ["accounting", "banking", "commerce", "reviews", "entity"] as const;
  const only = entitledModules({ status: "active", items: ["reviews_only"] }, billing);

  it("unlocks Review requests, and Commerce only in part", () => {
    expect(only).toMatchObject({ mode: "subscribed", modules: ["reviews"], partly: ["commerce"] });
    expect(readOnlyModules(enabled, only)).toEqual(["accounting", "banking", "commerce", "entity"]);
  });

  it("lets the company connect marketplaces and bring in orders, and nothing else in Commerce", () => {
    const ctx = { entitlement: only, readOnly: readOnlyModules(enabled, only) };
    expect(mayChange(ctx, "reviews")).toBe(true);
    expect(mayChange(ctx, "commerce", CONNECTION_AREA)).toBe(true);
    expect(mayChange(ctx, "commerce")).toBe(false);
    expect(mayChange(ctx, "accounting", CONNECTION_AREA)).toBe(false);
  });

  it("uses nothing in part on a plan that has Commerce in full", () => {
    const seller = entitledModules({ status: "active", items: ["seller", "reviews"] }, billing);
    expect(seller.partly).toEqual([]);
    expect(entitledModules(null, { now, billingStartsOn: null }).partly).toEqual([]);
    const lapsed = entitledModules({ status: "canceled", items: ["reviews_only"] }, billing);
    expect(lapsed).toMatchObject({ mode: "lapsed", modules: [], partly: [] });
  });

  it("keeps Review requests working when a company moves down from Seller", () => {
    const before = entitledModules({ status: "active", items: ["seller", "reviews"] }, billing);
    expect(readOnlyModules(enabled, before)).toEqual([]);
    expect(only.modules).toContain("reviews");
  });

  it("can't take add-ons", () => {
    expect(
      selectionProblem({ package: "reviews_only", addOns: ["stock"], interval: "month" }),
    ).toMatch("can't be added to Review requests only");
    expect(selectionTotal({ package: "reviews_only", addOns: [], interval: "year" })).toBe("90.00");
  });
});

describe("the free trial", () => {
  it("lasts 30 days from billing starting, or from the company's creation if later", () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(trialEndsOn("2026-12-01", "2026-06-01")).toBe("2026-12-30");
    expect(trialEndsOn("2026-12-01", "2027-02-10")).toBe("2027-03-11");
  });

  it("unlocks every module with no plan, and with a smaller one", () => {
    const during = { now: new Date("2026-12-30T23:00:00Z"), billingStartsOn: "2026-12-01" };
    const none = entitledModules(null, during);
    expect(none.mode).toBe("trial");
    expect(none.modules).toContain("inventory");
    expect(none.trialEndsOn).toBe("2026-12-30");
    expect(entitledModules({ status: "active", items: ["books"] }, during).modules).toContain(
      "reviews",
    );
  });

  it("ends the day after its last day, then the plan decides", () => {
    const after = { now: new Date("2026-12-31T00:00:00Z"), billingStartsOn: "2026-12-01" };
    expect(entitledModules(null, after)).toMatchObject({ mode: "none", modules: [] });
    expect(entitledModules({ status: "active", items: ["books"] }, after).mode).toBe("subscribed");
  });

  it("starts on sign-up for a company created after billing began", () => {
    const opts = {
      now: new Date("2027-02-20T12:00:00Z"),
      billingStartsOn: "2026-12-01",
      companyCreatedOn: "2027-02-10",
    };
    expect(entitledModules(null, opts)).toMatchObject({ mode: "trial", trialEndsOn: "2027-03-11" });
  });

  it("isn't counted during early access", () => {
    const early = entitledModules(null, { now, billingStartsOn: "2027-01-01" });
    expect(early).toMatchObject({ mode: "early_access", trialEndsOn: null });
  });
});

describe("the first charge", () => {
  it("waits for the trial's end, in early access and during the trial", () => {
    expect(
      firstChargeOn(
        { mode: "early_access", billingStartsOn: "2027-01-01", trialEndsOn: null },
        "2026-06-01",
      ),
    ).toBe("2027-01-31");
    expect(
      firstChargeOn(
        { mode: "trial", billingStartsOn: "2026-12-01", trialEndsOn: "2026-12-30" },
        "2026-06-01",
      ),
    ).toBe("2026-12-31");
    expect(
      firstChargeOn(
        { mode: "early_access", billingStartsOn: null, trialEndsOn: null },
        "2026-06-01",
      ),
    ).toBeNull();
    expect(
      firstChargeOn(
        { mode: "none", billingStartsOn: "2026-10-01", trialEndsOn: "2026-10-30" },
        "2026-06-01",
      ),
    ).toBeNull();
  });
});

describe("days left in the trial", () => {
  it("counts today and stops at zero", () => {
    const at = new Date("2026-12-28T18:00:00Z");
    expect(trialDaysLeft("2026-12-30", at)).toBe(3);
    expect(trialDaysLeft("2026-12-28", at)).toBe(1);
    expect(trialDaysLeft("2026-12-27", at)).toBe(0);
    expect(trialDaysLeft(null, at)).toBe(0);
  });
});

describe("a card at sign-up", () => {
  const card = { now, billingStartsOn: null, cardRequired: true };

  it("doesn't open the company until a plan is chosen in Checkout, even in early access", () => {
    expect(entitledModules(null, card)).toMatchObject({ mode: "needs_card", modules: [] });
    expect(entitledModules({ status: "incomplete", items: ["books"] }, card).mode).toBe(
      "needs_card",
    );
  });

  it("opens everything while Stripe's trial runs, whatever the plan", () => {
    const trial = entitledModules(
      {
        status: "trialing",
        items: ["books"],
        currentPeriodEnd: new Date("2027-01-09T12:00:00Z"),
      },
      card,
    );
    expect(trial).toMatchObject({ mode: "trial", trialEndsOn: "2027-01-08" });
    expect(trial.modules).toContain("inventory");
    expect(firstChargeOn(trial, "2026-12-10")).toBe("2027-01-09");
    expect(trialDaysLeft(trial.trialEndsOn, now)).toBe(30);
  });

  it("then gives the plan, or nothing once cancelled", () => {
    const paid = entitledModules({ status: "active", items: ["books"] }, card);
    expect(paid).toMatchObject({ mode: "subscribed", trialEndsOn: null, billingStartsOn: null });
    expect(paid.modules).toEqual(["accounting", "banking", "entity"]);
    expect(entitledModules({ status: "canceled", items: ["books"] }, card)).toMatchObject({
      mode: "lapsed",
      modules: [],
    });
    const reviews = entitledModules({ status: "active", items: ["reviews_only"] }, card);
    expect(reviews.partly).toEqual(["commerce"]);
  });

  it("leaves companies from before the card as they were", () => {
    expect(entitledModules(null, { now, billingStartsOn: null }).mode).toBe("early_access");
  });
});

describe("days free for a plan chosen at sign-up", () => {
  const first = { cardRequired: true, trialDays: 30 };
  it("gives the first company its 30 days once, and none to later companies", () => {
    expect(signupTrialDays(first, null)).toBe(30);
    expect(signupTrialDays(first, { status: "incomplete_expired" })).toBe(30);
    expect(signupTrialDays(first, { status: "canceled" })).toBe(0);
    expect(signupTrialDays({ cardRequired: true, trialDays: 0 }, null)).toBe(0);
    expect(signupTrialDays({ cardRequired: false, trialDays: 0 }, null)).toBe(0);
    expect(signupTrialDays(null, null)).toBe(0);
  });
});

import { BILLING_PACKAGES } from "@bookalyze/core";
import { describe, expect, it } from "vitest";
import { PACKAGES, REVIEWS_ONLY, SELLER_EXTRAS } from "./pricing";

/** The site's prices are the app's (packages/core billing), so they can't drift apart. */
describe("pricing", () => {
  const usd = (amount: string) => Number(amount);

  it("shows the app's package prices", () => {
    const keys = { books: "books", seller: "seller", "seller-plus": "seller_plus" } as const;
    for (const p of PACKAGES) {
      const item = BILLING_PACKAGES[keys[p.id]];
      expect([p.monthly, p.yearly]).toEqual([usd(item.monthly), usd(item.yearly)]);
    }
  });

  it("shows the app's Seller-with-one-extra prices and Review requests only", () => {
    const extras = { "seller-reviews": "seller_reviews", "seller-stock": "seller_stock" } as const;
    for (const a of SELLER_EXTRAS) {
      const item = BILLING_PACKAGES[extras[a.id]];
      expect(a.name).toBe(item.name);
      expect([a.monthly, a.yearly]).toEqual([usd(item.monthly), usd(item.yearly)]);
    }
    const only = BILLING_PACKAGES.reviews_only;
    expect(REVIEWS_ONLY.name).toBe(only.name);
    expect([REVIEWS_ONLY.monthly, REVIEWS_ONLY.yearly]).toEqual([
      usd(only.monthly),
      usd(only.yearly),
    ]);
  });
});

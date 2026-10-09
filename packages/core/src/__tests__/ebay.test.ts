import { describe, expect, it } from "vitest";
import { defaultEbayMarketplace, EBAY_MARKETPLACES, ebayMarketplace } from "../commerce/ebay";
import { minorUnits } from "../currency";

describe("eBay marketplaces", () => {
  it("starts with the US and Canada, each site in its own currency, by eBay's own ids", () => {
    expect(EBAY_MARKETPLACES.slice(0, 2).map((m) => [m.id, m.country, m.currency])).toEqual([
      ["EBAY_US", "US", "USD"],
      ["EBAY_CA", "CA", "CAD"],
    ]);
    for (const m of EBAY_MARKETPLACES) {
      expect(m.id).toBe(`EBAY_${m.country}`);
      expect(minorUnits(m.currency)).toBe(2);
    }
    expect(new Set(EBAY_MARKETPLACES.map((m) => m.id)).size).toBe(EBAY_MARKETPLACES.length);
  });

  it("finds a site by its id", () => {
    expect(ebayMarketplace("EBAY_CA")?.name).toBe("eBay Canada");
    expect(ebayMarketplace("noon-ae")).toBeNull();
  });

  it("suggests the company's own country, else eBay US", () => {
    expect(defaultEbayMarketplace("ca").id).toBe("EBAY_CA");
    expect(defaultEbayMarketplace("AE").id).toBe("EBAY_US");
    expect(defaultEbayMarketplace(null).id).toBe("EBAY_US");
  });
});

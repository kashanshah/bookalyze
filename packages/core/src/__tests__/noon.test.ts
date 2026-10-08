import { describe, expect, it } from "vitest";
import {
  defaultNoonMarketplace,
  isFulfilmentMode,
  NOON_MARKETPLACES,
  noonMarketplace,
} from "../commerce/noon";
import { minorUnits } from "../currency";

describe("Noon marketplaces", () => {
  it("covers the UAE, Saudi Arabia and Egypt, each in its own currency", () => {
    expect(NOON_MARKETPLACES.map((m) => [m.country, m.currency])).toEqual([
      ["AE", "AED"],
      ["SA", "SAR"],
      ["EG", "EGP"],
    ]);
    for (const m of NOON_MARKETPLACES) expect(minorUnits(m.currency)).toBe(2);
  });

  it("finds a marketplace by its key", () => {
    expect(noonMarketplace("noon-sa")?.name).toBe("Noon KSA");
    expect(noonMarketplace("A2VIGQ35RCS4UG")).toBeNull();
  });

  it("suggests the company's own country, else the UAE", () => {
    expect(defaultNoonMarketplace("eg").id).toBe("noon-eg");
    expect(defaultNoonMarketplace("CA").id).toBe("noon-ae");
    expect(defaultNoonMarketplace(null).id).toBe("noon-ae");
  });

  it("knows the fulfilment modes", () => {
    expect(isFulfilmentMode("marketplace")).toBe(true);
    expect(isFulfilmentMode("both")).toBe(true);
    expect(isFulfilmentMode("fbn")).toBe(false);
  });
});

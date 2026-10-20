import { describe, expect, it } from "vitest";
import { FULFILMENT_MODES } from "../commerce/noon";
import {
  defaultWalmartMarketplace,
  WALMART_FULFILMENT,
  WALMART_MARKETPLACES,
  walmartMarketplace,
} from "../commerce/walmart";
import { minorUnits } from "../currency";

describe("Walmart marketplaces", () => {
  it("covers the US, Canada and Mexico, each in its own currency with Walmart's market code", () => {
    expect(WALMART_MARKETPLACES.map((m) => [m.id, m.country, m.currency, m.market])).toEqual([
      ["walmart-us", "US", "USD", "us"],
      ["walmart-ca", "CA", "CAD", "ca"],
      ["walmart-mx", "MX", "MXN", "mx"],
    ]);
    for (const m of WALMART_MARKETPLACES) expect(minorUnits(m.currency)).toBe(2);
  });

  it("finds a marketplace by its key", () => {
    expect(walmartMarketplace("walmart-ca")?.name).toBe("Walmart Canada");
    expect(walmartMarketplace("EBAY_CA")).toBeNull();
  });

  it("suggests the company's own country, else Walmart US", () => {
    expect(defaultWalmartMarketplace("ca").id).toBe("walmart-ca");
    expect(defaultWalmartMarketplace("MX").id).toBe("walmart-mx");
    expect(defaultWalmartMarketplace("AE").id).toBe("walmart-us");
    expect(defaultWalmartMarketplace(null).id).toBe("walmart-us");
  });

  it("names every way of shipping, WFS first", () => {
    expect(Object.keys(WALMART_FULFILMENT).sort()).toEqual([...FULFILMENT_MODES].sort());
    expect(WALMART_FULFILMENT.marketplace.label).toContain("WFS");
  });
});

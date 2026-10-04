import { describe, expect, it } from "vitest";
import { formatMoney, minorUnits } from "../currency";
import { getSubdivision, subdivisionsOf } from "../reference-data";

describe("currency", () => {
  it("knows ISO 4217 minor units", () => {
    expect(minorUnits("CAD")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KWD")).toBe(3);
  });

  it("formats with the currency's precision", () => {
    expect(formatMoney("1234.5", "CAD", "en-CA")).toBe("$1,234.50");
    expect(formatMoney("1234.567", "KWD", "en-US")).toContain("1,234.567");
  });
});

describe("reference data", () => {
  it("has subdivisions for the initial organizations", () => {
    expect(getSubdivision("CA-ON")?.name).toBe("Ontario");
    expect(getSubdivision("AE-DU")?.name).toBe("Dubai");
    expect(subdivisionsOf("PK").length).toBeGreaterThan(0);
  });
});

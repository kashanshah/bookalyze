import { describe, expect, it } from "vitest";
import {
  amazonErrorDetail,
  defaultAmazonRegion,
  parseMarketplaceParticipations,
} from "../commerce/amazon";

describe("parseMarketplaceParticipations", () => {
  it("reads Amazon's list, keeping retail marketplaces only", () => {
    const json = {
      payload: [
        {
          marketplace: {
            id: "A2EUQ1WTGCTBG2",
            countryCode: "CA",
            name: "Amazon.ca",
            defaultCurrencyCode: "CAD",
          },
          participation: { isParticipating: true, hasSuspendedListings: false },
          storeName: "Example Store",
        },
        {
          marketplace: { id: "ATVPDKIKX0DER", countryCode: "US", name: "Amazon.com" },
          participation: { isParticipating: false, hasSuspendedListings: true },
        },
        {
          marketplace: { id: "A2ZV50J4W1RKNI", countryCode: "US", name: "Non-Amazon US" },
          participation: { isParticipating: true },
        },
      ],
    };
    expect(parseMarketplaceParticipations(json)).toEqual([
      {
        marketplaceId: "A2EUQ1WTGCTBG2",
        name: "Amazon.ca",
        country: "CA",
        currency: "CAD",
        participating: true,
        hasSuspendedListings: false,
        storeName: "Example Store",
      },
      {
        marketplaceId: "ATVPDKIKX0DER",
        name: "Amazon.com",
        country: "US",
        currency: "USD",
        participating: false,
        hasSuspendedListings: true,
        storeName: null,
      },
    ]);
    expect(() => parseMarketplaceParticipations({ errors: [] })).toThrow();
  });

  it("guesses the region from the company's country", () => {
    expect(defaultAmazonRegion("CA")).toBe("na");
    expect(defaultAmazonRegion("AE")).toBe("eu");
    expect(defaultAmazonRegion("PK")).toBe("na");
  });
});

describe("amazonErrorDetail", () => {
  it("reads Amazon's explanation of a failed call", () => {
    expect(
      amazonErrorDetail({
        errors: [
          { code: "InvalidInput", message: "Invalid Input", details: "MarketplaceId is invalid." },
        ],
      }),
    ).toBe("Invalid Input MarketplaceId is invalid.");
    expect(amazonErrorDetail({ errors: [{ code: "x", message: "  a\n b " }] })).toBe("a b");
    expect(amazonErrorDetail({ errors: [{ message: "x".repeat(300) }] })).toHaveLength(240);
  });

  it("is null when there's no explanation", () => {
    expect(amazonErrorDetail({})).toBeNull();
    expect(amazonErrorDetail(null)).toBeNull();
    expect(amazonErrorDetail({ errors: [] })).toBeNull();
  });
});

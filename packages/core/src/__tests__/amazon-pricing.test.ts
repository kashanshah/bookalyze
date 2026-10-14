import { describe, expect, it } from "vitest";
import {
  buildPricePatch,
  isAmazonSellerId,
  listingCost,
  parseFeesEstimate,
  parseListingItem,
  parseListingPatchResult,
  parseMyOfferSellerId,
  priceChangePercent,
  priceProfit,
} from "../commerce/pricing";

const CA = "A2EUQ1WTGCTBG2";

// Synthetic: shaped like the Listings Items API's answer.
const listing = {
  sku: "MUG-1",
  summaries: [
    {
      marketplaceId: CA,
      asin: "B0TEST0001",
      productType: "DRINKING_CUP",
      itemName: "Maple mug",
      status: ["BUYABLE", "DISCOVERABLE"],
    },
  ],
  attributes: {
    fulfillment_availability: [{ fulfillment_channel_code: "AMAZON_NA" }],
    purchasable_offer: [
      {
        marketplace_id: CA,
        currency: "CAD",
        audience: "B2B",
        our_price: [{ schedule: [{ value_with_tax: 18 }] }],
      },
      {
        marketplace_id: CA,
        currency: "CAD",
        our_price: [{ schedule: [{ value_with_tax: 19.99 }] }],
        minimum_seller_allowed_price: [{ schedule: [{ value_with_tax: 15 }] }],
      },
    ],
  },
  offers: [{ marketplaceId: CA, offerType: "B2C", price: { currency: "CAD", amount: "19.99" } }],
  issues: [{ severity: "WARNING", message: "Add more photos." }],
};

describe("Amazon listings and prices", () => {
  it("reads a listing's price, product type and status, and keeps its offer for everyone", () => {
    const parsed = parseListingItem(listing, CA);
    expect(parsed).toMatchObject({
      sku: "MUG-1",
      productType: "DRINKING_CUP",
      itemName: "Maple mug",
      status: ["BUYABLE", "DISCOVERABLE"],
      price: "19.9900",
      currency: "CAD",
      fulfilledByAmazon: true,
      issues: [{ severity: "WARNING", message: "Add more photos." }],
    });
    expect(parsed.offer?.minimum_seller_allowed_price).toBeDefined();
    // Without Amazon's offers, the listing's own price.
    expect(parseListingItem({ ...listing, offers: [] }, CA).price).toBe("19.9900");
    expect(parseListingItem({ sku: "NEW" }, CA)).toMatchObject({ price: null, offer: null });
  });

  it("changes only the price, keeping the rest of the offer", () => {
    const parsed = parseListingItem(listing, CA);
    const patch = buildPricePatch({
      productType: "DRINKING_CUP",
      marketplaceId: CA,
      currency: "CAD",
      price: "17.499",
      offer: parsed.offer,
    });
    expect(patch).toEqual({
      productType: "DRINKING_CUP",
      patches: [
        {
          op: "replace",
          path: "/attributes/purchasable_offer",
          value: [
            {
              marketplace_id: CA,
              currency: "CAD",
              our_price: [{ schedule: [{ value_with_tax: 17.5 }] }],
              minimum_seller_allowed_price: [{ schedule: [{ value_with_tax: 15 }] }],
            },
          ],
        },
      ],
    });
    // The listing read stays untouched.
    expect(parseListingItem(listing, CA).price).toBe("19.9900");
  });

  it("reads Amazon's answer to a change", () => {
    expect(
      parseListingPatchResult({ sku: "MUG-1", status: "ACCEPTED", submissionId: "s1", issues: [] }),
    ).toEqual({ status: "ACCEPTED", submissionId: "s1", problems: [] });
    expect(
      parseListingPatchResult({
        status: "INVALID",
        issues: [
          { severity: "WARNING", message: "Ignored." },
          { severity: "ERROR", message: "The price is below your minimum price." },
        ],
      }),
    ).toEqual({
      status: "INVALID",
      submissionId: null,
      problems: ["The price is below your minimum price."],
    });
  });

  it("reads Amazon's fee estimate, or why there isn't one", () => {
    expect(
      parseFeesEstimate({
        payload: {
          FeesEstimateResult: {
            Status: "Success",
            FeesEstimate: {
              TotalFeesEstimate: { CurrencyCode: "CAD", Amount: 8.12 },
              FeeDetailList: [
                { FeeType: "ReferralFee", FinalFee: { CurrencyCode: "CAD", Amount: 3 } },
                { FeeType: "FBAFees", FinalFee: { CurrencyCode: "CAD", Amount: 5.12 } },
              ],
            },
          },
        },
      }),
    ).toEqual({
      total: "8.1200",
      currency: "CAD",
      fees: [
        { type: "ReferralFee", amount: "3.0000" },
        { type: "FBAFees", amount: "5.1200" },
      ],
    });
    expect(
      parseFeesEstimate({
        payload: {
          FeesEstimateResult: { Status: "ClientError", Error: { Message: "Unknown SKU." } },
        },
      }),
    ).toEqual({ error: "Unknown SKU." });
  });

  it("finds the seller's own ID among a listing's offers", () => {
    expect(
      parseMyOfferSellerId({
        payload: {
          Offers: [
            { SellerId: "AOTHERSELLER01", MyOffer: false },
            { SellerId: "AMYSELLERID001", MyOffer: true },
          ],
        },
      }),
    ).toBe("AMYSELLERID001");
    expect(parseMyOfferSellerId({ payload: { Offers: [] } })).toBeNull();
    expect(isAmazonSellerId("A1B2C3D4E5F6G7")).toBe(true);
    expect(isAmazonSellerId("not an id")).toBe(false);
  });

  it("works out profit and margin exactly", () => {
    expect(priceProfit({ price: "19.99", fees: "8.12", cost: "4.50", currency: "CAD" })).toEqual({
      profit: "7.3700",
      margin: "36.9",
    });
    expect(priceProfit({ price: "10", fees: "8.12", cost: "4.50", currency: "CAD" })).toEqual({
      profit: "-2.6200",
      margin: "-26.2",
    });
    expect(priceChangePercent("20.00", "15.00")).toBe("-25.0");
    expect(priceChangePercent(null, "15.00")).toBeNull();
  });

  it("costs a listing's contents, packs and bundles included, in the marketplace's currency", () => {
    const unitCosts = new Map([
      ["mug", { cost: "3.3333", currency: "CAD" }],
      ["coaster", { cost: "1.50", currency: "CAD" }],
    ]);
    const components = [
      { productId: "mug", productName: "Mug", units: 2 },
      { productId: "coaster", productName: "Coaster", units: 1 },
    ];
    expect(listingCost({ components, unitCosts, currency: "CAD", rate: null })).toEqual({
      cost: "8.1700",
      missing: [],
      needsRate: false,
    });
    // Amazon.com in a CAD company: 1 USD = 1.37 CAD.
    expect(listingCost({ components, unitCosts, currency: "USD", rate: "1.37" }).cost).toBe(
      "5.9600",
    );
    expect(listingCost({ components, unitCosts, currency: "USD", rate: null })).toEqual({
      cost: null,
      missing: [],
      needsRate: true,
    });
    expect(
      listingCost({
        components: [...components, { productId: "lamp", productName: "Lamp", units: 1 }],
        unitCosts,
        currency: "CAD",
        rate: null,
      }),
    ).toEqual({ cost: null, missing: ["Lamp"], needsRate: false });
  });
});

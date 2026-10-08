import { describe, expect, it } from "vitest";
import {
  amazonProductUrl,
  changeHeadline,
  checkAgainAt,
  diffListing,
  type ListingObservation,
  listingValues,
  listingWatchIssue,
  normalizeAsin,
  parseCatalogItem,
  parseItemOffers,
  parseReviewTopics,
} from "../commerce/listings";

const catalog = {
  asin: "B0TEST1234",
  summaries: [{ marketplaceId: "ATVPDKIKX0DER", itemName: "Stone coaster" }],
  attributes: {
    item_name: [{ value: "Stone coaster", marketplace_id: "ATVPDKIKX0DER" }],
    bullet_point: [
      { value: "Cork back", marketplace_id: "ATVPDKIKX0DER" },
      { value: "Set of four", marketplace_id: "A2EUQ1WTGCTBG2" },
    ],
    product_description: [{ value: "<p>A heavy coaster.</p>", marketplace_id: "ATVPDKIKX0DER" }],
  },
  images: [
    {
      marketplaceId: "ATVPDKIKX0DER",
      images: [
        { variant: "MAIN", link: "https://m.media-amazon.com/main-small.jpg", height: 75 },
        { variant: "MAIN", link: "https://m.media-amazon.com/main.jpg", height: 500 },
        { variant: "PT01", link: "https://m.media-amazon.com/side.jpg", height: 500 },
      ],
    },
  ],
  salesRanks: [
    {
      marketplaceId: "ATVPDKIKX0DER",
      displayGroupRanks: [{ title: "Kitchen & Dining", rank: 1200 }],
      classificationRanks: [{ title: "Coasters", rank: 40 }],
    },
  ],
};

const offers = {
  payload: {
    Summary: {
      TotalOfferCount: 4,
      BuyBoxPrices: [{ LandedPrice: { CurrencyCode: "USD", Amount: 19.99 } }],
    },
    Offers: [
      {
        SellerId: "A1SELLER",
        IsBuyBoxWinner: true,
        LandedPrice: { CurrencyCode: "USD", Amount: 19.99 },
        PrimeInformation: { IsPrime: true },
      },
    ],
  },
};

const base = (): ListingObservation => ({
  title: "Stone coaster",
  bullets: ["Cork back"],
  description: "A heavy coaster.",
  images: [
    { variant: "MAIN", url: "https://m.media-amazon.com/main.jpg" },
    { variant: "PT01", url: "https://m.media-amazon.com/side.jpg" },
  ],
  price: "19.9900",
  currency: "USD",
  featured: { sellerId: "A1SELLER", price: "19.9900", currency: "USD", prime: true },
  offerCount: 4,
  ranks: [
    { category: "Kitchen & Dining", rank: 1200 },
    { category: "Coasters", rank: 40 },
  ],
  reviewTopics: [{ topic: "easy to clean", sentiment: "positive", share: "12.0" }],
  reviewNote: null,
});

describe("listing watch input", () => {
  it("accepts an ASIN and rejects everything else", () => {
    expect(normalizeAsin(" b0test1234 ")).toBe("B0TEST1234");
    expect(normalizeAsin("not-an-asin")).toBeNull();
    expect(normalizeAsin("B0TEST123")).toBeNull();
  });

  it("keeps hourly checks to price and offers", () => {
    expect(listingWatchIssue({ checks: ["price", "featured"], cadence: "hourly" })).toBeNull();
    expect(listingWatchIssue({ checks: ["price", "images"], cadence: "hourly" })).toMatch(/Hourly/);
    expect(listingWatchIssue({ checks: [], cadence: "daily" })).toMatch(/at least one/);
  });

  it("builds the shopper page and the next check time", () => {
    expect(amazonProductUrl("Amazon.com", "B0TEST1234")).toBe(
      "https://www.amazon.com/dp/B0TEST1234",
    );
    expect(amazonProductUrl("Website", "B0TEST1234")).toBeNull();
    const from = new Date("2026-10-06T15:00:00Z");
    expect(checkAgainAt("hourly", from).toISOString()).toBe("2026-10-06T16:00:00.000Z");
    expect(checkAgainAt("daily", from).toISOString()).toBe("2026-10-07T15:00:00.000Z");
    expect(checkAgainAt("weekly", from).toISOString()).toBe("2026-10-13T15:00:00.000Z");
  });
});

describe("listing values", () => {
  const observed: ListingObservation = {
    title: "Stone coaster",
    bullets: ["Cork back"],
    description: "A heavy coaster.",
    images: [],
    price: "19.9900",
    currency: "USD",
    featured: { sellerId: "A1SELLER", price: "19.9900", currency: "USD", prime: true },
    offerCount: 4,
    ranks: [
      { category: "Kitchen & Dining", rank: 1200 },
      { category: "Coasters", rank: 40 },
    ],
    reviewTopics: [],
    reviewNote: null,
  };

  it("shows the price, featured offer, sellers and ranks", () => {
    const values = listingValues(observed, "en-CA");
    expect(values.map((v) => v.label)).toEqual([
      "Price",
      "Featured offer",
      "Other sellers",
      "Best seller rank",
      "Best seller rank",
    ]);
    expect(values[0]?.value).toContain("19.99");
    expect(values[1]?.value).toContain("Prime");
    expect(values[1]?.value).toContain("19.99");
    expect(values[2]?.value).toBe("4 sellers");
    expect(values[3]?.value).toBe("#1,200 in Kitchen & Dining");
    expect(values[4]?.value).toBe("#40 in Coasters");
  });

  it("adds a short note of the words when asked", () => {
    const words = listingValues(observed, "en-CA", { content: true }).find(
      (v) => v.label === "Title and description",
    );
    expect(words?.value).toBe("1 bullet · A heavy coaster.");
  });

  it("says when there is no featured offer", () => {
    const values = listingValues({ ...observed, featured: null, ranks: [], bullets: [] }, "en-CA");
    expect(values.find((v) => v.label === "Featured offer")?.value).toBe("None right now");
  });
});

describe("Amazon listing responses", () => {
  it("reads the catalog for one marketplace", () => {
    const item = parseCatalogItem(catalog, "ATVPDKIKX0DER");
    expect(item.title).toBe("Stone coaster");
    expect(item.bullets).toEqual(["Cork back"]);
    expect(item.description).toBe("A heavy coaster.");
    expect(item.images).toEqual([
      { variant: "MAIN", url: "https://m.media-amazon.com/main.jpg" },
      { variant: "PT01", url: "https://m.media-amazon.com/side.jpg" },
    ]);
    expect(item.ranks.map((r) => r.category)).toEqual(["Kitchen & Dining", "Coasters"]);
  });

  it("reads the featured offer and the shopper price", () => {
    expect(parseItemOffers(offers)).toMatchObject({
      price: "19.9900",
      currency: "USD",
      offerCount: 4,
      featured: { sellerId: "A1SELLER", prime: true },
    });
  });

  it("reads review topics, quotes and the star rating impact", () => {
    expect(
      parseReviewTopics({
        topics: {
          positiveTopics: [
            {
              topic: "easy to clean",
              asinMetrics: {
                occurrencePercentage: 12.04,
                numberOfMentions: 36,
                starRatingImpact: 4,
              },
              reviewSnippets: ["Wipes clean.", ""],
            },
            { topic: "rare", asinMetrics: { occurrencePercentage: 1 } },
          ],
          negativeTopics: [
            { topic: "chipped", asinMetrics: { occurrencePercentage: 4, starRatingImpact: -1.5 } },
          ],
        },
      }),
    ).toEqual([
      {
        topic: "easy to clean",
        sentiment: "positive",
        share: "12.0",
        mentions: 36,
        starImpact: "4.0",
        snippets: ["Wipes clean."],
      },
      {
        topic: "rare",
        sentiment: "positive",
        share: "1.0",
        mentions: null,
        starImpact: null,
        snippets: [],
      },
      {
        topic: "chipped",
        sentiment: "negative",
        share: "4.0",
        mentions: null,
        starImpact: "-1.5",
        snippets: [],
      },
    ]);
  });
});

describe("listing changes", () => {
  it("treats the first look as a baseline", () => {
    expect(diffListing(null, base(), ["price", "content"], "en-CA")).toEqual([]);
  });

  it("describes a price change, a new seller, and a rewritten title", () => {
    const next = base();
    next.price = "17.4900";
    next.featured = {
      sellerId: "A2OTHER",
      price: "17.4900",
      currency: "USD",
      prime: true,
    };
    next.title = "Slate coaster";
    const changes = diffListing(base(), next, ["price", "featured", "content", "rank"], "en-CA");
    expect(changes.map((c) => c.summary)).toEqual([
      "Price went from US$19.99 to US$17.49.",
      "The featured offer moved to another seller.",
      "The title changed.",
    ]);
    expect(changeHeadline(changes)).toBe("Price went from US$19.99 to US$17.49. 2 more changes.");
  });

  it("ignores a rank that barely moved and a review topic that barely grew", () => {
    const next = base();
    next.ranks = [
      { category: "Kitchen & Dining", rank: 1190 },
      { category: "Coasters", rank: 40 },
    ];
    next.reviewTopics = [{ topic: "easy to clean", sentiment: "positive", share: "12.4" }];
    expect(diffListing(base(), next, ["rank", "reviews"])).toEqual([]);
  });

  it("reports a real rank move and a new complaint", () => {
    const next = base();
    next.ranks = [{ category: "Kitchen & Dining", rank: 800 }];
    next.reviewTopics = [
      { topic: "easy to clean", sentiment: "positive", share: "12.0" },
      { topic: "chipped", sentiment: "negative", share: "6.0" },
    ];
    const changes = diffListing(base(), next, ["rank", "reviews"], "en-CA");
    expect(changes.map((c) => c.field)).toEqual(["rank", "reviews"]);
    expect(changes[0]?.summary).toMatch(/800/);
    expect(changes[0]?.summary).toMatch(/No longer ranked in Coasters/);
    expect(changes[1]?.summary).toMatch(/chipped/);
  });

  it("says when the main photo changes", () => {
    const next = base();
    next.images = [{ variant: "MAIN", url: "https://m.media-amazon.com/new.jpg" }];
    expect(diffListing(base(), next, ["images"])[0]?.summary).toMatch(/main photo/);
  });
});

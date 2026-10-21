import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AdMetricRow,
  amazonAdsConsentUrl,
  amazonAdsErrorDetail,
  amazonAdsReportRequest,
  channelAdSummary,
  duplicateAmazonAdsReportId,
  keepRate,
  mergeAdRows,
  nextAmazonAdsWindow,
  PRODUCT_PROFIT_COLUMNS,
  parseAmazonAdsProfiles,
  parseAmazonAdsReport,
  parseAmazonAdsReportStatus,
  parseAmazonAdsTokens,
  productProfitCsvRows,
  type SkuPeriodInput,
  skuProfit,
  sortSkuProfits,
} from "../index";

const sku = (over: Partial<SkuPeriodInput> = {}): SkuPeriodInput => ({
  sku: "BOARD-TI",
  label: "Titanium cutting board",
  linked: true,
  units: 10,
  orders: 10,
  sales: "649.90",
  unitCost: "12.00",
  adSpend: "0",
  adSales: "0",
  adOrders: 0,
  adUnits: 0,
  clicks: 0,
  impressions: 0,
  ...over,
});

describe("keepRate", () => {
  it("adds the books' advertising back, so ads are counted once, from the reports", () => {
    // Sales 1000, net 500 after 100 of advertising: 600 before ads, 0.6 per unit of sales.
    expect(keepRate({ sales: "1000", net: "500", advertising: "-100" })).toBe("0.6000000000");
  });
  it("is null without sales", () => {
    expect(keepRate({ sales: "0", net: "-29.99", advertising: "0" })).toBeNull();
  });
});

describe("skuProfit", () => {
  it("works out profit before and after ads, ACOS, TACOS and break-even ACOS", () => {
    const r = skuProfit(
      sku({ adSpend: "120.00", adSales: "324.95", adOrders: 5, clicks: 100, impressions: 9000 }),
      { keepRate: "0.6", currency: "CAD" },
    );
    // 649.90 × 0.6 = 389.94; cost 120; before ads 269.94; after ads 149.94.
    expect(r.netBeforeAds).toBe("389.9400");
    expect(r.productCost).toBe("120.0000");
    expect(r.profitBeforeAds).toBe("269.9400");
    expect(r.profitAfterAds).toBe("149.9400");
    expect(r.profitAfterAdsPerUnit).toBe("14.9900");
    expect(r.acos).toBe(36.9);
    expect(r.tacos).toBe(18.5);
    expect(r.breakEvenAcos).toBe(41.5);
    expect(r.organicShare).toBe(50);
    expect(r.cpc).toBe("1.2000");
    expect(r.conversion).toBe(5);
    // 26.99 profit per unit × 5% conversion: a click may cost up to 1.35.
    expect(r.breakEvenCpc).toBe("1.3500");
    expect(r.roas).toBe(2.71);
    expect(r.verdict).toBe("healthy");
  });

  it("says when ads cost more than they earn, eat the profit, or the product loses anyway", () => {
    const above = skuProfit(sku({ adSpend: "200", adSales: "300" }), {
      keepRate: "0.6",
      currency: "CAD",
    });
    expect(above.acos).toBeGreaterThan(above.breakEvenAcos ?? 0);
    expect(above.verdict).toBe("ads_above_break_even");

    const eaten = skuProfit(sku({ adSpend: "300", adSales: "400" }), {
      keepRate: "0.6",
      currency: "CAD",
    });
    expect(eaten.profitAfterAds).toBe("-30.0600");
    expect(eaten.verdict).toBe("ads_eat_profit");

    const losing = skuProfit(sku({ unitCost: "50" }), { keepRate: "0.6", currency: "CAD" });
    expect(losing.profitBeforeAds).toBe("-110.0600");
    expect(losing.verdict).toBe("losing");
  });

  it("flags spend with no sales, a missing cost, and a SKU with only ads", () => {
    expect(
      skuProfit(sku({ adSpend: "40", clicks: 50 }), { keepRate: "0.6", currency: "CAD" }).verdict,
    ).toBe("ads_no_sales");
    const missing = skuProfit(sku({ unitCost: null, linked: false }), {
      keepRate: "0.6",
      currency: "CAD",
    });
    expect(missing.profitBeforeAds).toBeNull();
    expect(missing.verdict).toBe("cost_missing");
    // Ads ran, nothing sold: the loss is the spend.
    const onlyAds = skuProfit(sku({ units: 0, orders: 0, sales: "0", adSpend: "25" }), {
      keepRate: "0.6",
      currency: "CAD",
    });
    expect(onlyAds.profitAfterAds).toBe("-25.0000");
    expect(onlyAds.tacos).toBeNull();
    expect(onlyAds.averagePrice).toBeNull();
    expect(onlyAds.verdict).toBe("ads_no_sales");
  });

  it("keeps organic share at zero when ads claim more than the period's sales", () => {
    const r = skuProfit(sku({ adSales: "900", adSpend: "100" }), {
      keepRate: "0.6",
      currency: "CAD",
    });
    expect(r.organicShare).toBe(0);
  });

  it("needs a keep rate for profit", () => {
    const r = skuProfit(sku(), { keepRate: null, currency: "CAD" });
    expect(r.profitBeforeAds).toBeNull();
    expect(r.verdict).toBe("cost_missing");
  });

  it("rounds to the currency's minor units", () => {
    const r = skuProfit(sku({ sales: "10.005", units: 1 }), { keepRate: "1", currency: "KWD" });
    expect(r.sales).toBe("10.0050");
  });

  it("profit after ads is always profit before ads less spend", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_00 }),
        fc.integer({ min: 0, max: 5_000_00 }),
        fc.integer({ min: 1, max: 100 }),
        (sales, spend, units) => {
          const r = skuProfit(
            sku({
              sales: (sales / 100).toFixed(2),
              adSpend: (spend / 100).toFixed(2),
              units,
              unitCost: "1.00",
            }),
            { keepRate: "0.55", currency: "CAD" },
          );
          const before = Math.round(Number(r.profitBeforeAds) * 100);
          const after = Math.round(Number(r.profitAfterAds) * 100);
          return before - spend === after;
        },
      ),
    );
  });
});

describe("sortSkuProfits and channelAdSummary", () => {
  const rows = [
    skuProfit(sku({ sku: "OK" }), { keepRate: "0.6", currency: "CAD" }),
    skuProfit(sku({ sku: "LOSS", unitCost: "50" }), { keepRate: "0.6", currency: "CAD" }),
    skuProfit(sku({ sku: "WASTE", adSpend: "40" }), { keepRate: "0.6", currency: "CAD" }),
    skuProfit(sku({ sku: "NOCOST", unitCost: null }), { keepRate: "0.6", currency: "CAD" }),
  ];

  it("puts the worst first", () => {
    expect(sortSkuProfits(rows).map((r) => r.sku)).toEqual(["LOSS", "WASTE", "NOCOST", "OK"]);
  });

  it("counts what was lost, spend with no sales, and spend tied to no SKU", () => {
    const s = channelAdSummary(rows, { spend: "60", sales: "200" });
    expect(s.adSpend).toBe("100.0000");
    expect(s.unallocatedSpend).toBe("60.0000");
    expect(s.losing).toBe(1);
    expect(s.lost).toBe("110.0600");
    expect(s.wasted).toBe("40.0000");
    expect(s.costMissing).toBe(1);
    // Before ads: 269.94 + -110.06 + 269.94 (the SKU without a cost isn't in it).
    expect(s.profitBeforeAds).toBe("429.8200");
    expect(s.profitAfterAds).toBe("329.8200");
    expect(s.tacos).toBe(3.8);
  });
});

describe("mergeAdRows", () => {
  const row = (over: Partial<AdMetricRow>): AdMetricRow => ({
    date: "2026-10-01",
    adType: "sponsored_products",
    campaignId: "1",
    campaignName: "Boards",
    sku: "A",
    listingRef: "B0A",
    spend: "1.50",
    impressions: 10,
    clicks: 2,
    attributedSales: "20",
    attributedOrders: 1,
    attributedUnits: 1,
    attributionWindow: "7d",
    ...over,
  });
  it("adds up a SKU's ad groups in one campaign and day, and keeps no-SKU rows apart", () => {
    const merged = mergeAdRows([
      row({}),
      row({ spend: "2.25", clicks: 3 }),
      row({ sku: null, adType: "sponsored_brands" }),
      row({ date: "2026-10-02" }),
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ spend: "3.7500", clicks: 5, attributedSales: "40.0000" });
  });
});

describe("Amazon Ads API", () => {
  it("builds the consent URL with the ads scope", () => {
    const url = new URL(
      amazonAdsConsentUrl({
        authBase: "https://www.amazon.com/ap/oa",
        clientId: "amzn1.application-oa2-client.x",
        redirectUri: "https://app.bookalyze.com/api/amazon-ads/callback",
        state: "s",
      }),
    );
    expect(url.searchParams.get("scope")).toBe("advertising::campaign_management");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("reads tokens and profiles", () => {
    expect(
      parseAmazonAdsTokens({ access_token: "Atza|x", refresh_token: "Atzr|y", expires_in: 3600 }),
    ).toEqual({ accessToken: "Atza|x", refreshToken: "Atzr|y", expiresIn: 3600 });
    expect(() => parseAmazonAdsTokens({})).toThrow();
    const profiles = parseAmazonAdsProfiles([
      {
        profileId: 3456789012,
        countryCode: "CA",
        currencyCode: "CAD",
        timezone: "America/Los_Angeles",
        accountInfo: { marketplaceStringId: "A2EUQ1WTGCTBG2", name: "Kazomo", type: "seller" },
      },
      { countryCode: "US" },
    ]);
    expect(profiles).toEqual([
      {
        profileId: "3456789012",
        countryCode: "CA",
        currency: "CAD",
        timezone: "America/Los_Angeles",
        marketplaceId: "A2EUQ1WTGCTBG2",
        accountName: "Kazomo",
        accountType: "seller",
      },
    ]);
  });

  it("asks for the advertised-product report daily, as gzipped JSON", () => {
    const body = amazonAdsReportRequest("sponsored_products", "2026-10-01", "2026-10-15");
    expect(body.configuration).toMatchObject({
      reportTypeId: "spAdvertisedProduct",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
      groupBy: ["advertiser"],
    });
    expect(body.configuration.columns).toContain("advertisedSku");
    expect(
      amazonAdsReportRequest("sponsored_brands", "2026-10-01", "2026-10-01").configuration,
    ).toMatchObject({ reportTypeId: "sbCampaigns" });
  });

  it("reads report statuses and Amazon's duplicate answer", () => {
    expect(parseAmazonAdsReportStatus({ reportId: "r1", status: "PENDING" }).status).toBe(
      "pending",
    );
    expect(
      parseAmazonAdsReportStatus({ reportId: "r1", status: "COMPLETED", url: "https://s3/x" }),
    ).toMatchObject({ status: "done", url: "https://s3/x" });
    expect(
      parseAmazonAdsReportStatus({ reportId: "r1", status: "FAILURE", failureReason: "No" }),
    ).toMatchObject({ status: "failed", failure: "No" });
    expect(
      duplicateAmazonAdsReportId({
        code: "425",
        detail: "The Request is a duplicate of : 0c5e3c37-6d9e-4a5c-9d0e-1a2b3c4d5e6f",
      }),
    ).toBe("0c5e3c37-6d9e-4a5c-9d0e-1a2b3c4d5e6f");
    expect(amazonAdsErrorDetail({ code: "UNAUTHORIZED", details: "Not authorized" })).toBe(
      "UNAUTHORIZED: Not authorized",
    );
  });

  it("reads Sponsored Products per SKU and Sponsored Brands per campaign, inside the days", () => {
    const sp = parseAmazonAdsReport(
      "sponsored_products",
      [
        {
          date: "2026-10-01",
          campaignId: 111,
          campaignName: "Boards – exact",
          advertisedAsin: "B0TITAN",
          advertisedSku: "BOARD-TI",
          impressions: 1200,
          clicks: 14,
          cost: 17.36,
          sales7d: 129.98,
          purchases7d: 2,
          unitsSoldClicks7d: 2,
        },
        { date: "2026-09-01", cost: 5 },
      ],
      { from: "2026-10-01", to: "2026-10-15" },
    );
    expect(sp).toEqual([
      {
        date: "2026-10-01",
        adType: "sponsored_products",
        campaignId: "111",
        campaignName: "Boards – exact",
        sku: "BOARD-TI",
        listingRef: "B0TITAN",
        spend: "17.3600",
        impressions: 1200,
        clicks: 14,
        attributedSales: "129.9800",
        attributedOrders: 2,
        attributedUnits: 2,
        attributionWindow: "7d",
      },
    ]);
    const sb = parseAmazonAdsReport(
      "sponsored_brands",
      [
        {
          date: "2026-10-02",
          campaignId: "9",
          cost: "3.1",
          sales: "40",
          purchases: 1,
          unitsSold: 1,
        },
      ],
      { from: "2026-10-01", to: "2026-10-15" },
    );
    expect(sb[0]).toMatchObject({ sku: null, spend: "3.1000", attributionWindow: "14d" });
    expect(() => parseAmazonAdsReport("sponsored_products", {}, { from: "a", to: "b" })).toThrow();
  });

  it("plans windows: 60 days back first, 31 at a time, then the last 15 days daily", () => {
    expect(nextAmazonAdsWindow({ today: "2026-10-21", doneThrough: null, doneOn: null })).toEqual({
      from: "2026-08-22",
      to: "2026-09-21",
    });
    expect(
      nextAmazonAdsWindow({ today: "2026-10-21", doneThrough: "2026-09-21", doneOn: "2026-10-21" }),
    ).toEqual({ from: "2026-09-22", to: "2026-10-20" });
    expect(
      nextAmazonAdsWindow({ today: "2026-10-22", doneThrough: "2026-10-20", doneOn: "2026-10-21" }),
    ).toEqual({ from: "2026-10-07", to: "2026-10-21" });
    expect(
      nextAmazonAdsWindow({ today: "2026-10-22", doneThrough: "2026-10-21", doneOn: "2026-10-22" }),
    ).toBeNull();
  });
});

describe("productProfitCsvRows", () => {
  it("writes one row per SKU and one for spend tied to no product", () => {
    const rows = productProfitCsvRows(
      [
        {
          name: "Amazon.ca",
          currency: "CAD",
          rows: [
            skuProfit(sku({ adSpend: "10", adSales: "64.99" }), {
              keepRate: "0.6",
              currency: "CAD",
            }),
          ],
          unallocated: { spend: "7", sales: "0" },
        },
      ],
      (v) => v ?? "",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.slice(0, 5)).toEqual([
      "Amazon.ca",
      "CAD",
      "BOARD-TI",
      "Titanium cutting board",
      "Healthy",
    ]);
    expect(rows[1]?.[13]).toBe("7");
    expect(rows[1]?.[26]).toBe("-7.0000");
    expect(rows[0]).toHaveLength(PRODUCT_PROFIT_COLUMNS.length);
  });
});

import { describe, expect, it } from "vitest";
import {
  nextWalmartAdsWindow,
  parseWalmartAdsCampaigns,
  parseWalmartAdsReport,
  parseWalmartAdsSnapshot,
  parseWalmartAdvertiserId,
  parseWalmartCatalogSku,
  walmartAdsErrorDetail,
  walmartAdsReportRequest,
  walmartAdsSignedText,
} from "../commerce/walmart-ads";

describe("Walmart Connect", () => {
  it("reads an advertiser ID and signs consumer, time and key version on their own lines", () => {
    expect(parseWalmartAdvertiserId(" 600 123 ")).toBe("600123");
    expect(parseWalmartAdvertiserId("abc")).toBeNull();
    expect(
      walmartAdsSignedText({ consumerId: "c-1", timestamp: "1700000000000", keyVersion: "1" }),
    ).toBe("c-1\n1700000000000\n1\n");
  });

  it("asks for the item report day by day, and reads the snapshot's state", () => {
    const body = walmartAdsReportRequest("600123", "2026-10-01", "2026-10-14");
    expect(body).toMatchObject({
      advertiserId: 600123,
      reportType: "adItem",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
    expect(body.reportMetrics).toContain("date");
    expect(body.reportMetrics).toContain("adSpend");
    expect(
      parseWalmartAdsSnapshot({ code: "success", snapshotId: "S1", jobStatus: "pending" }),
    ).toEqual({
      snapshotId: "S1",
      status: "pending",
      url: null,
      failure: null,
    });
    expect(
      parseWalmartAdsSnapshot([{ snapshotId: "S1", jobStatus: "done", details: "https://x/f.gz" }]),
    ).toMatchObject({ status: "done", url: "https://x/f.gz" });
    expect(parseWalmartAdsSnapshot({ snapshotId: "S1", jobStatus: "expired" })).toMatchObject({
      status: "failed",
      failure: "expired",
    });
    expect(() => parseWalmartAdsSnapshot({})).toThrow(/didn't make sense/);
  });

  it("reads the item report as JSON or CSV, one row per day, campaign and item", () => {
    const range = { from: "2026-10-01", to: "2026-10-14" };
    const json = parseWalmartAdsReport(
      JSON.stringify([
        {
          date: "2026-10-05",
          campaignId: 77,
          campaignName: "Mugs",
          itemId: "5551",
          adSpend: 12.3456789,
          numAdsShown: 900,
          numAdsClicks: 30,
          attributedSales14days: "59.97",
          attributedOrders14days: 3,
          attributedUnits14days: 3,
        },
        { date: "2026-09-30", itemId: "5551", adSpend: 1 },
        { date: "2026-10-05", adSpend: 1 },
      ]),
      range,
    );
    expect(json).toEqual([
      {
        date: "2026-10-05",
        adType: "sponsored_products",
        campaignId: "77",
        campaignName: "Mugs",
        sku: null,
        listingRef: "5551",
        spend: "12.3457",
        impressions: 900,
        clicks: 30,
        attributedSales: "59.9700",
        attributedOrders: 3,
        attributedUnits: 3,
        attributionWindow: "14d",
      },
    ]);
    const csv = parseWalmartAdsReport(
      'Date,Campaign Id,Item Id,Ad Spend,Num Ads Clicks\n10/06/2026,77,5551,"$1,004.50",4\n',
      range,
    );
    expect(csv).toMatchObject([
      { date: "2026-10-06", listingRef: "5551", spend: "1004.5000", clicks: 4 },
    ]);
    expect(parseWalmartAdsReport("", range)).toEqual([]);
  });

  it("finds the seller's SKU for an item, counts campaigns and reads Walmart's errors", () => {
    expect(
      parseWalmartCatalogSku({ items: [{ itemId: "5551", sku: "WMT-MAPLE-MUG" }] }, "5551"),
    ).toBe("WMT-MAPLE-MUG");
    expect(parseWalmartCatalogSku({ items: [{ sku: "ONLY" }] }, "5551")).toBe("ONLY");
    expect(parseWalmartCatalogSku({ items: [] }, "5551")).toBeNull();
    expect(parseWalmartAdsCampaigns([{ campaignId: 1 }, { campaignId: 2 }])).toBe(2);
    expect(() => parseWalmartAdsCampaigns({})).toThrow();
    expect(
      walmartAdsErrorDetail({
        errors: [{ code: "UNAUTHORIZED", description: "No access to advertiser" }],
      }),
    ).toBe("UNAUTHORIZED: No access to advertiser");
    expect(walmartAdsErrorDetail(null)).toBeNull();
  });

  it("asks the last 30 days first, then on from the last report but always the last 15 again", () => {
    expect(nextWalmartAdsWindow({ today: "2026-10-22", doneThrough: null, doneOn: null })).toEqual({
      from: "2026-09-22",
      to: "2026-10-21",
    });
    expect(
      nextWalmartAdsWindow({
        today: "2026-10-22",
        doneThrough: "2026-10-20",
        doneOn: "2026-10-21",
      }),
    ).toEqual({ from: "2026-10-07", to: "2026-10-21" });
    expect(
      nextWalmartAdsWindow({
        today: "2026-10-22",
        doneThrough: "2026-10-21",
        doneOn: "2026-10-22",
      }),
    ).toBeNull();
  });
});

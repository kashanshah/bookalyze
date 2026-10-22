import type { AdMetricRow, AmazonOrder, AmazonOrderItem } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adMetricsForProfit,
  adReportState,
  adsBroughtInThrough,
  finishAdReportRequest,
  knownListingRefs,
  listAmazonAdsConnections,
  listWalmartAdsConnections,
  recordAdReportRequest,
  replaceAdMetrics,
  saveChannelSkuListingRef,
  skuSalesForProfit,
} from "../ads";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { saveAmazonChannels, saveOrderItems, upsertOrders } from "../commerce";
import { createProduct, linkSku } from "../inventory";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let orgId: string;
let otherOrgId: string;
let channelId: string;
let adsConnectionId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

const order = (id: string, purchasedAt: string, status = "Shipped"): AmazonOrder => ({
  orderId: id,
  marketplaceId: "A2EUQ1WTGCTBG2",
  purchasedAt,
  lastUpdatedAt: purchasedAt,
  status,
  fulfillment: "amazon",
  currency: "CAD",
  total: "64.99",
  itemsShipped: 1,
  itemsUnshipped: 0,
  shipCountry: "CA",
  shipRegion: "ON",
  isBusiness: false,
  isPrime: false,
  isReplacement: false,
  earliestDelivery: null,
  latestDelivery: null,
});

const item = (sku: string, quantity: number, price: string, promo?: string): AmazonOrderItem => ({
  itemId: `${sku}-${quantity}-${price}`,
  asin: "B0TITAN",
  sku,
  title: sku,
  quantityOrdered: quantity,
  quantityShipped: quantity,
  itemPrice: price,
  itemTax: null,
  shippingPrice: null,
  shippingTax: null,
  promotionDiscount: promo ?? null,
});

const row = (over: Partial<AdMetricRow>): AdMetricRow => ({
  date: "2026-10-05",
  adType: "sponsored_products",
  campaignId: "111",
  campaignName: "Boards",
  sku: "BOARD-TI",
  listingRef: "B0TITAN",
  spend: "10.00",
  impressions: 100,
  clicks: 8,
  attributedSales: "64.99",
  attributedOrders: 1,
  attributedUnits: 1,
  attributionWindow: "7d",
  ...over,
});

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Ads Org", slug: "ads-org", createdAt: new Date() },
      { name: "Other Ads Org", slug: "other-ads-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    const sp = await createConnection(tx, {
      orgId,
      provider: "amazon_sp",
      name: "Amazon",
      settings: { region: "na" },
    });
    await saveAmazonChannels(tx, {
      orgId,
      connectionId: sp.id,
      marketplaces: [
        {
          marketplaceId: "A2EUQ1WTGCTBG2",
          name: "Amazon.ca",
          country: "CA",
          currency: "CAD",
          participating: true,
          hasSuspendedListings: false,
          storeName: null,
        },
      ],
    });
    channelId = (await tx.select().from(schema.salesChannels))[0]?.id ?? "";
    adsConnectionId = (
      await createConnection(tx, {
        orgId,
        provider: "amazon_ads",
        name: "Amazon Ads · North America",
        settings: { region: "na" },
      })
    ).id;
    await tx.insert(schema.channelSkus).values({
      organizationId: orgId,
      channelId,
      sku: "MAG-SET",
      asin: "B0MAGNET",
    });
    const board = await createProduct(tx, {
      orgId,
      userId: null,
      name: "Titanium board",
      sku: null,
      notes: null,
    });
    await linkSku(tx, {
      orgId,
      userId: null,
      productId: board.id,
      channelId,
      sku: "BOARD-TI",
      units: 1,
    });
    await upsertOrders(tx, {
      orgId,
      channelId,
      from: "2000-01-01",
      orders: [
        order("702-1", "2026-10-03T15:00:00Z"),
        order("702-2", "2026-10-04T15:00:00Z"),
        order("702-3", "2026-10-04T16:00:00Z", "Canceled"),
        order("702-4", "2026-09-04T16:00:00Z"),
      ],
    });
    const saved = await tx.select().from(schema.orders);
    const id = (ext: string) => saved.find((o) => o.externalId === ext)?.id ?? "";
    await saveOrderItems(tx, {
      orgId,
      orderId: id("702-1"),
      items: [item("BOARD-TI", 1, "64.99")],
    });
    await saveOrderItems(tx, {
      orgId,
      orderId: id("702-2"),
      items: [item("BOARD-TI", 2, "129.98", "10.00"), item("MAG-SET", 1, "19.99")],
    });
    await saveOrderItems(tx, {
      orgId,
      orderId: id("702-3"),
      items: [item("BOARD-TI", 5, "324.95")],
    });
    await saveOrderItems(tx, {
      orgId,
      orderId: id("702-4"),
      items: [item("BOARD-TI", 1, "64.99")],
    });
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

const replace = (rows: AdMetricRow[], over: Partial<Parameters<typeof replaceAdMetrics>[1]> = {}) =>
  scoped((tx) =>
    replaceAdMetrics(tx, {
      orgId,
      channelId,
      connectionId: adsConnectionId,
      source: "amazon_ads",
      accountRef: "3456789012",
      country: "CA",
      currency: "CAD",
      adType: "sponsored_products",
      from: "2026-10-01",
      to: "2026-10-15",
      rows,
      baseCurrency: "CAD",
      ...over,
    }),
  );

describe("ad metrics", () => {
  it("keeps a report's rows, adding up a SKU's ad groups and finding a SKU from its ASIN", async () => {
    const kept = await replace([
      row({}),
      row({
        spend: "5.50",
        clicks: 2,
        attributedSales: "0",
        attributedOrders: 0,
        attributedUnits: 0,
      }),
      row({ sku: null, listingRef: "B0MAGNET", spend: "3.00", attributedSales: "19.99" }),
      row({ date: "2026-09-30" }),
    ]);
    expect(kept).toBe(2);
    const stored = await scoped((tx) => tx.select().from(schema.adMetrics));
    const board = stored.find((r) => r.sku === "BOARD-TI");
    expect(board).toMatchObject({
      spend: "15.5000",
      clicks: 10,
      spendBase: "15.5000",
      fxRate: "1.0000000000",
    });
    expect(stored.find((r) => r.listingRef === "B0MAGNET")?.sku).toBe("MAG-SET");
  });

  it("replaces the days fetched again (attribution changes), and only that ad type", async () => {
    await replace(
      [
        row({
          sku: null,
          listingRef: null,
          adType: "sponsored_brands",
          campaignId: "9",
          spend: "7.00",
        }),
      ],
      { adType: "sponsored_brands" },
    );
    await replace([row({ spend: "12.00", attributedSales: "129.98", attributedOrders: 2 })]);
    const stored = await scoped((tx) => tx.select().from(schema.adMetrics));
    expect(stored.map((r) => [r.adType, r.sku, r.spend]).sort()).toEqual([
      ["sponsored_brands", null, "7.0000"],
      ["sponsored_products", "BOARD-TI", "12.0000"],
    ]);
  });

  it("leaves the main-currency spend empty without a rate", async () => {
    await replace([row({ date: "2026-10-06", spend: "20.00" })], {
      currency: "AED",
      from: "2026-10-06",
      to: "2026-10-06",
      rates: new Map(),
    });
    const [aed] = await scoped((tx) =>
      tx.select().from(schema.adMetrics).where(eq(schema.adMetrics.date, "2026-10-06")),
    );
    expect(aed?.spendBase).toBeNull();
    // Put the CAD row back for the sums below.
    await replace([], { from: "2026-10-06", to: "2026-10-06" });
  });

  it("sums a period per SKU, with the spend tied to no SKU apart", async () => {
    const [channel] = await scoped((tx) =>
      adMetricsForProfit(tx, { from: "2026-10-01", to: "2026-10-31" }),
    );
    expect(channel?.total.spend).toBe("19.0000");
    expect(channel?.bySku.get("BOARD-TI")).toMatchObject({
      spend: "12.0000",
      orders: 2,
      clicks: 8,
    });
    expect(channel?.unallocated.spend).toBe("7.0000");
    expect(channel?.byType.get("sponsored_brands")?.spend).toBe("7.0000");
  });

  it("sums each SKU's sales in the period, cancelled orders left out, with its product", async () => {
    const data = await scoped((tx) =>
      skuSalesForProfit(tx, { from: "2026-10-01", to: "2026-10-31", timezone: "America/Toronto" }),
    );
    const board = data.sales.find((s) => s.sku === "BOARD-TI");
    expect(board).toMatchObject({ units: 3, orders: 2, sales: "184.9700" });
    expect(data.links.find((l) => l.sku === "BOARD-TI")?.product_name).toBe("Titanium board");
    expect(data.titles.get(`${channelId}|MAG-SET`)).toBeNull();
  });

  it("tracks report requests: pending, then done through a day", async () => {
    const request = await scoped((tx) =>
      recordAdReportRequest(tx, {
        orgId,
        connectionId: adsConnectionId,
        channelId,
        accountRef: "3456789012",
        adType: "sponsored_products",
        from: "2026-10-01",
        to: "2026-10-15",
        reportId: "r-1",
      }),
    );
    let state = await scoped((tx) => adReportState(tx, channelId, "sponsored_products"));
    expect(state.pending.map((p) => p.reportId)).toEqual(["r-1"]);
    expect(state.done).toBeNull();
    await scoped((tx) => finishAdReportRequest(tx, request.id, { status: "done", rows: 2 }));
    state = await scoped((tx) => adReportState(tx, channelId, "sponsored_products"));
    expect(state.pending).toEqual([]);
    expect(state.done?.dateTo).toBe("2026-10-15");
    const through = await scoped((tx) => adsBroughtInThrough(tx));
    expect(through.get(channelId)?.through).toBe("2026-10-15");
    expect((await scoped((tx) => listAmazonAdsConnections(tx))).map((c) => c.id)).toEqual([
      adsConnectionId,
    ]);
  });

  it("keeps each company's ads to itself", async () => {
    expect(await scoped((tx) => tx.select().from(schema.adMetrics), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => tx.select().from(schema.adReportRequests), otherOrgId)).toEqual([]);
    await expect(
      scoped(
        (tx) =>
          tx.insert(schema.adMetrics).values({
            organizationId: orgId,
            channelId,
            source: "upload",
            date: "2026-10-01",
            adType: "other",
            currency: "CAD",
            spend: "1",
          }),
        otherOrgId,
      ),
    ).rejects.toThrow();
  });

  it("keeps Walmart Connect's item IDs on the SKU list, so its spend finds each SKU", async () => {
    const walmartAds = await scoped((tx) =>
      createConnection(tx, {
        orgId,
        provider: "walmart_ads",
        name: "Walmart Connect · 600123",
        settings: { advertiserId: "600123", channelId },
      }),
    );
    expect((await scoped((tx) => listWalmartAdsConnections(tx))).map((c) => c.id)).toEqual([
      walmartAds.id,
    ]);
    expect(await scoped((tx) => knownListingRefs(tx, channelId, ["5551", "5552"]))).toEqual(
      new Set(),
    );
    // An existing SKU takes the item ID; a SKU not on the list yet is added with it.
    await scoped(async (tx) => {
      await saveChannelSkuListingRef(tx, { orgId, channelId, sku: "BOARD-TI", listingRef: "5551" });
      await saveChannelSkuListingRef(tx, { orgId, channelId, sku: "NEW-SKU", listingRef: "5552" });
    });
    expect(await scoped((tx) => knownListingRefs(tx, channelId, ["5551", "5552", "9"]))).toEqual(
      new Set(["5551", "5552"]),
    );
    const kept = await replace(
      [
        row({ date: "2026-11-02", sku: null, listingRef: "5551", attributionWindow: "14d" }),
        row({ date: "2026-11-02", sku: null, listingRef: "5552", campaignId: "222" }),
      ],
      {
        source: "walmart_ads",
        connectionId: walmartAds.id,
        accountRef: "600123",
        from: "2026-11-01",
        to: "2026-11-03",
      },
    );
    expect(kept).toBe(2);
    const stored = await scoped((tx) =>
      tx.select().from(schema.adMetrics).where(eq(schema.adMetrics.source, "walmart_ads")),
    );
    expect(stored.map((r) => [r.listingRef, r.sku]).sort()).toEqual([
      ["5551", "BOARD-TI"],
      ["5552", "NEW-SKU"],
    ]);
  });
});

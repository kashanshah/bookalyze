import { type AmazonOrder, DEFAULT_REVIEW_SETTINGS } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { saveAmazonChannels, saveOrderItems, upsertOrders } from "../commerce";
import {
  clearReviewRequests,
  dueReviewRequests,
  getReviewSettings,
  listReviewOrders,
  planReviewRequests,
  readyToAsk,
  recordReviewOutcome,
  reviewCandidates,
  saveReviewSettings,
} from "../reviews";
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
const ids: Record<string, string> = {};
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

const order = (id: string, over: Partial<AmazonOrder> = {}): AmazonOrder => ({
  orderId: id,
  marketplaceId: "A2EUQ1WTGCTBG2",
  purchasedAt: "2026-09-01T15:00:00Z",
  lastUpdatedAt: "2026-09-01T15:00:00Z",
  status: "Shipped",
  fulfillment: "amazon",
  currency: "CAD",
  total: "25.0000",
  itemsShipped: 1,
  itemsUnshipped: 0,
  shipCountry: "CA",
  shipRegion: "ON",
  isBusiness: false,
  isPrime: false,
  isReplacement: false,
  earliestDelivery: "2026-09-03",
  latestDelivery: "2026-09-05",
  ...over,
});
const today = "2026-09-15";

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Reviews Org", slug: "reviews-org", createdAt: new Date() },
      { name: "Other Reviews Org", slug: "other-reviews-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    const connection = await createConnection(tx, {
      orgId,
      userId: null,
      provider: "amazon_sp",
      name: "Amazon Seller Central · North America",
      settings: { region: "na" },
    });
    await saveAmazonChannels(tx, {
      orgId,
      connectionId: connection.id,
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
    const [channel] = await tx.select().from(schema.salesChannels);
    await upsertOrders(tx, {
      orgId,
      channelId: channel?.id ?? "",
      from: "2026-08-01",
      orders: [
        order("701-0000001-0000001"),
        order("701-0000002-0000002", { isReplacement: true }),
        order("701-0000003-0000003", { status: "Unshipped", latestDelivery: null }),
        // Its window closed on Sep 4.
        order("701-0000004-0000004", {
          purchasedAt: "2026-08-01T15:00:00Z",
          earliestDelivery: "2026-08-03",
          latestDelivery: "2026-08-05",
        }),
        // Delivered recently: its window opens on Sep 19.
        order("701-0000005-0000005", {
          purchasedAt: "2026-09-10T15:00:00Z",
          earliestDelivery: "2026-09-14",
          latestDelivery: "2026-09-16",
        }),
      ],
    });
    for (const row of await tx.select().from(schema.orders)) ids[row.externalId] = row.id;
    await saveOrderItems(tx, {
      orgId,
      orderId: ids["701-0000001-0000001"] ?? "",
      items: [
        {
          itemId: "1",
          asin: "B000TEST01",
          sku: "MAPLE-MUG",
          title: "Maple mug",
          quantityOrdered: 1,
          quantityShipped: 1,
          itemPrice: "22.1200",
          itemTax: "2.8800",
          shippingPrice: null,
          shippingTax: null,
          promotionDiscount: "-2.0000",
        },
      ],
    });
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("review requests", () => {
  it("keeps the settings per company, off until saved", async () => {
    expect(await scoped(getReviewSettings)).toEqual(DEFAULT_REVIEW_SETTINGS);
    const settings = { ...DEFAULT_REVIEW_SETTINGS, enabled: true, excludedSkus: ["OLD-SKU"] };
    await scoped((tx) => saveReviewSettings(tx, { orgId, userId: null, settings }));
    expect(await scoped(getReviewSettings)).toEqual(settings);
    expect(await scoped(getReviewSettings, otherOrgId)).toEqual(DEFAULT_REVIEW_SETTINGS);
    await expect(
      scoped((tx) =>
        saveReviewSettings(tx, {
          orgId,
          userId: null,
          settings: { ...settings, daysAfterDelivery: 40 },
        }),
      ),
    ).rejects.toThrow();
  });

  it("finds shipped orders whose window hasn't closed, and plans them once", async () => {
    const candidates = await scoped((tx) =>
      reviewCandidates(tx, { today, needsItems: false, limit: 10 }),
    );
    expect(candidates.map((c) => c.id).sort()).toEqual(
      [ids["701-0000001-0000001"], ids["701-0000002-0000002"], ids["701-0000005-0000005"]].sort(),
    );
    const mug = candidates.find((c) => c.id === ids["701-0000001-0000001"]);
    expect(mug).toMatchObject({ skus: ["MAPLE-MUG"], hasPromotion: true });
    // Only orders whose items are in, when SKUs or promotions matter.
    expect(
      await scoped((tx) => reviewCandidates(tx, { today, needsItems: true, limit: 10 })),
    ).toHaveLength(1);

    const planned = await scoped((tx) =>
      planReviewRequests(tx, orgId, [
        {
          orderId: ids["701-0000001-0000001"] ?? "",
          status: "scheduled",
          dueAt: new Date("2026-09-15T14:00:00Z"),
          reason: null,
        },
        {
          orderId: ids["701-0000002-0000002"] ?? "",
          status: "skipped",
          dueAt: null,
          reason: "Replacement order",
        },
      ]),
    );
    expect(planned).toBe(2);
    expect(
      await scoped((tx) => reviewCandidates(tx, { today, needsItems: false, limit: 10 })),
    ).toHaveLength(1);

    const due = await scoped((tx) =>
      dueReviewRequests(tx, { now: new Date("2026-09-15T15:00:00Z"), limit: 10 }),
    );
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      externalId: "701-0000001-0000001",
      marketplaceId: "A2EUQ1WTGCTBG2",
      source: "auto",
    });
    expect(
      await scoped((tx) =>
        dueReviewRequests(tx, { now: new Date("2026-09-15T13:00:00Z"), limit: 10 }),
      ),
    ).toHaveLength(0);
    // Another company sees none of it.
    expect(
      await scoped(
        (tx) => dueReviewRequests(tx, { now: new Date("2026-09-15T15:00:00Z"), limit: 10 }),
        otherOrgId,
      ),
    ).toHaveLength(0);
  });

  it("lists orders by tab, and a sent request is final", async () => {
    const ask = await scoped((tx) =>
      listReviewOrders(tx, { tab: "ask", today, limit: 10, offset: 0 }),
    );
    expect(ask.rows.map((r) => r.externalId)).toEqual(["701-0000005-0000005"]);
    expect(ask.rows[0]).toMatchObject({ opens: "2026-09-19", closes: "2026-10-16", request: null });
    expect(ask.counts).toMatchObject({ ask: 1, ready: 0, scheduled: 1, sent: 0, other: 1 });
    expect(await scoped((tx) => readyToAsk(tx, { today, limit: 10 }))).toEqual([]);
    expect(await scoped((tx) => readyToAsk(tx, { today: "2026-09-19", limit: 10 }))).toEqual([
      ids["701-0000005-0000005"],
    ]);

    const mug = ids["701-0000001-0000001"] ?? "";
    await scoped((tx) =>
      recordReviewOutcome(tx, {
        orgId,
        orderId: mug,
        source: "auto",
        status: "sent",
        attempted: true,
      }),
    );
    const overwritten = await scoped((tx) =>
      recordReviewOutcome(tx, { orgId, orderId: mug, source: "manual", status: "failed" }),
    );
    expect(overwritten).toBe(false);
    const sent = await scoped((tx) =>
      listReviewOrders(tx, { tab: "sent", today, limit: 10, offset: 0 }),
    );
    expect(sent.rows[0]?.request).toMatchObject({ status: "sent", source: "auto" });
    expect(sent.counts).toMatchObject({ sent: 1, sentLast30: 1, scheduled: 0 });
    expect(await scoped((tx) => clearReviewRequests(tx, [mug]))).toBe(0);
  });

  it("puts skipped orders back, and saving settings re-plans automatic ones", async () => {
    const recent = ids["701-0000005-0000005"] ?? "";
    await scoped((tx) =>
      recordReviewOutcome(tx, {
        orgId,
        orderId: recent,
        source: "manual",
        status: "skipped",
        reason: "You chose not to ask",
      }),
    );
    // The replacement order was skipped by the automation; the recent one by hand.
    const cleared = await scoped((tx) =>
      saveReviewSettings(tx, {
        orgId,
        userId: null,
        settings: { ...DEFAULT_REVIEW_SETTINGS, enabled: true, skipReplacements: false },
      }),
    );
    expect(cleared).toBe(1);
    const other = await scoped((tx) =>
      listReviewOrders(tx, { tab: "other", today, limit: 10, offset: 0 }),
    );
    expect(other.rows.map((r) => r.externalId)).toEqual(["701-0000005-0000005"]);
    expect(await scoped((tx) => clearReviewRequests(tx, [recent]))).toBe(1);

    const due = await app.db.execute<{ organization_id: string }>(
      sql`select organization_id from review_request_orgs()`,
    );
    expect(due.rows.map((r) => r.organization_id)).toContain(orgId);
    expect(due.rows.map((r) => r.organization_id)).not.toContain(otherOrgId);
  });
});

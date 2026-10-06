import type { AmazonOrder } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import {
  countOrdersNeedingItems,
  getOrder,
  listOrders,
  ordersNeedingItems,
  saveAmazonChannels,
  saveOrderCursor,
  saveOrderItems,
  saveRefunds,
  startOrderSync,
  upsertOrders,
} from "../commerce";
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
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

const order = (id: string, over: Partial<AmazonOrder> = {}): AmazonOrder => ({
  orderId: id,
  marketplaceId: "A2EUQ1WTGCTBG2",
  purchasedAt: "2026-09-10T15:00:00Z",
  lastUpdatedAt: "2026-09-10T15:00:00Z",
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
  latestDelivery: null,
  ...over,
});

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Orders Org", slug: "orders-org", createdAt: new Date() },
      { name: "Other Orders Org", slug: "other-orders-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  channelId = await scoped(async (tx) => {
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
    return channel?.id ?? "";
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("orders", () => {
  it("adds orders from the start date on, and only newer copies change them", async () => {
    await scoped((tx) => startOrderSync(tx, [channelId], "2026-09-01"));
    const added = await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId,
        from: "2026-09-01",
        orders: [
          order("702-0000001-0000001"),
          order("702-0000002-0000002", {
            status: "Pending",
            total: null,
            purchasedAt: "2026-09-12T10:00:00Z",
            lastUpdatedAt: "2026-09-12T10:00:00Z",
          }),
          order("702-0000000-0000000", { purchasedAt: "2026-08-31T23:00:00Z" }),
        ],
      }),
    );
    expect(added).toBe(2);

    // Pending orders aren't priced yet, so only the shipped one needs its items.
    expect(await scoped((tx) => countOrdersNeedingItems(tx))).toBe(1);
    const [first] = await scoped((tx) => ordersNeedingItems(tx, channelId, 10));
    expect(first?.externalId).toBe("702-0000001-0000001");
    await scoped((tx) =>
      saveOrderItems(tx, {
        orgId,
        orderId: first?.id ?? "",
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
            promotionDiscount: null,
          },
        ],
      }),
    );
    expect(await scoped((tx) => countOrdersNeedingItems(tx))).toBe(0);

    // An older copy is ignored; a newer one with a new status asks for the items again.
    const stale = await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId,
        from: "2026-09-01",
        orders: [order("702-0000002-0000002", { lastUpdatedAt: "2026-09-11T00:00:00Z" })],
      }),
    );
    expect(stale).toBe(0);
    await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId,
        from: "2026-09-01",
        orders: [
          order("702-0000002-0000002", {
            purchasedAt: "2026-09-12T10:00:00Z",
            lastUpdatedAt: "2026-09-13T08:00:00Z",
            status: "Unshipped",
            total: "40.0000",
          }),
        ],
      }),
    );
    expect(await scoped((tx) => countOrdersNeedingItems(tx))).toBe(1);
  });

  it("lists and totals orders with filters, and finds them by SKU", async () => {
    const all = await scoped((tx) =>
      listOrders(tx, { timezone: "America/Toronto", limit: 10, offset: 0 }),
    );
    expect(all.count).toBe(2);
    expect(all.rows.map((r) => r.externalId)).toEqual([
      "702-0000002-0000002",
      "702-0000001-0000001",
    ]);
    expect(all.rows[1]).toMatchObject({
      firstTitle: "Maple mug",
      lines: 1,
      channelName: "Amazon.ca",
    });
    expect(all.totals).toEqual([
      { currency: "CAD", orders: 2, sold: 2, units: 2, sales: "65.0000", refunded: "0" },
    ]);

    const bySku = await scoped((tx) =>
      listOrders(tx, { timezone: "America/Toronto", search: "maple-mug", limit: 10, offset: 0 }),
    );
    expect(bySku.rows.map((r) => r.externalId)).toEqual(["702-0000001-0000001"]);

    const open = await scoped((tx) =>
      listOrders(tx, {
        timezone: "America/Toronto",
        statuses: ["Unshipped"],
        from: "2026-09-12",
        to: "2026-09-12",
        limit: 10,
        offset: 0,
      }),
    );
    expect(open.count).toBe(1);

    const detail = await scoped((tx) => getOrder(tx, all.rows[1]?.id ?? ""));
    expect(detail?.items.map((i) => i.sku)).toEqual(["MAPLE-MUG"]);
  });

  it("keeps refunds against their orders once, and totals what was given back", async () => {
    const refund = (adjustmentId: string, amount: string, orderId = "702-0000001-0000001") => ({
      orderId,
      adjustmentId,
      postedAt: "2026-09-20T12:00:00Z",
      sku: "MAPLE-MUG",
      quantity: 1,
      amount,
      currency: "CAD",
    });
    const added = await scoped((tx) =>
      saveRefunds(tx, {
        orgId,
        channelId,
        // An order this channel doesn't have is left out.
        refunds: [refund("adj-1", "10.0000"), refund("adj-x", "5.0000", "702-9999999-9999999")],
      }),
    );
    expect(added).toBe(1);
    // The same events read again change nothing; a second refund adds up.
    expect(
      await scoped((tx) =>
        saveRefunds(tx, {
          orgId,
          channelId,
          refunds: [refund("adj-1", "10.0000"), refund("adj-2", "15.0000")],
        }),
      ),
    ).toBe(1);
    const list = await scoped((tx) =>
      listOrders(tx, { timezone: "UTC", refunded: true, limit: 10, offset: 0 }),
    );
    expect(list.rows.map((r) => [r.externalId, r.refunded])).toEqual([
      ["702-0000001-0000001", "25.0000"],
    ]);
    expect(list.totals[0]?.refunded).toBe("25.0000");
    const detail = await scoped((tx) => getOrder(tx, list.rows[0]?.id ?? ""));
    expect(detail?.refunds.map((r) => r.externalId)).toEqual(["adj-1", "adj-2"]);
    expect(detail?.order.lastRefundAt).toEqual(new Date("2026-09-20T12:00:00Z"));
  });

  it("keeps the sync position, and an earlier start date reads everything again", async () => {
    await scoped((tx) =>
      saveOrderCursor(tx, channelId, {
        nextToken: null,
        syncedThrough: new Date("2026-10-01T00:00:00Z"),
      }),
    );
    await scoped((tx) => startOrderSync(tx, [channelId], "2026-09-15"));
    const later = await scoped((tx) => tx.select().from(schema.salesChannels));
    expect(later[0]?.ordersSyncedThrough).not.toBeNull();
    await scoped((tx) => startOrderSync(tx, [channelId], "2026-06-01"));
    const earlier = await scoped((tx) => tx.select().from(schema.salesChannels));
    expect(earlier[0]).toMatchObject({ ordersFrom: "2026-06-01", ordersSyncedThrough: null });
  });

  it("keeps each company's orders to itself, and lists syncable channels for the daily job", async () => {
    const theirs = await scoped(
      (tx) => listOrders(tx, { timezone: "UTC", limit: 10, offset: 0 }),
      otherOrgId,
    );
    expect(theirs.count).toBe(0);
    const syncable = await app.db.execute<{ channel_id: string }>(
      sql`select channel_id from syncable_sales_channels()`,
    );
    // The connection has no credentials in this test, so nothing is syncable.
    expect(syncable.rows.map((r) => r.channel_id)).not.toContain(channelId);
  });
});

import { type AmazonOrder, formatInvoiceNumber, prepareOrderInvoice } from "@bookalyze/core";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import {
  amazonConnectionsForRegion,
  countOrdersNeedingItems,
  disconnectAmazon,
  getOrder,
  listOrders,
  orderGlance,
  ordersNeedingItems,
  saveAmazonChannels,
  saveOrderCursor,
  saveOrderFinance,
  saveOrderItems,
  saveRefunds,
  startOrderSync,
  upsertOrders,
} from "../commerce";
import {
  getOrderInvoice,
  insertOrderInvoice,
  nextInvoiceNumber,
  updateOrderInvoice,
} from "../invoices";
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
  earliestDelivery: null,
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

    // Two syncs saving the same order at once (the background job and the button) both succeed.
    const mug = {
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
    };
    const save = (wait: number) =>
      scoped(async (tx) => {
        await saveOrderItems(tx, { orgId, orderId: first?.id ?? "", items: [mug] });
        await new Promise((resolve) => setTimeout(resolve, wait));
      });
    await Promise.all([
      save(300),
      new Promise((resolve) => setTimeout(resolve, 100)).then(() => save(0)),
    ]);
    const saved = await scoped((tx) =>
      tx
        .select()
        .from(schema.orderItems)
        .where(sql`order_id = ${first?.id ?? ""}`),
    );
    expect(saved).toHaveLength(1);

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
      {
        channelId: expect.any(String),
        channelName: "Amazon.ca",
        currency: "CAD",
        orders: 2,
        sold: 2,
        units: 2,
        sales: "65.0000",
        refunded: "0",
      },
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

  it("links replacements both ways, and keeps an order's claim", async () => {
    await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId,
        from: "2026-09-01",
        orders: [
          order("702-0000003-0000003", {
            purchasedAt: "2026-09-20T10:00:00Z",
            lastUpdatedAt: "2026-09-20T10:00:00Z",
            isReplacement: true,
            replacedOrderId: "702-0000001-0000001",
            total: "0.0000",
          }),
        ],
      }),
    );
    const list = await scoped((tx) => listOrders(tx, { timezone: "UTC", limit: 10, offset: 0 }));
    const byId = Object.fromEntries(list.rows.map((r) => [r.externalId, r]));
    expect(byId["702-0000001-0000001"]).toMatchObject({ replaced: true, isReplacement: false });
    expect(byId["702-0000003-0000003"]).toMatchObject({ replaced: false, isReplacement: true });

    const original = byId["702-0000001-0000001"]?.id ?? "";
    const replacement = byId["702-0000003-0000003"]?.id ?? "";
    const detail = await scoped((tx) => getOrder(tx, original));
    expect(detail?.replacedBy.map((r) => r.externalId)).toEqual(["702-0000003-0000003"]);
    expect((await scoped((tx) => getOrder(tx, replacement)))?.replaces).toMatchObject({
      id: original,
      externalId: "702-0000001-0000001",
    });

    await scoped((tx) =>
      saveOrderFinance(tx, {
        orgId,
        channelId,
        orderId: original,
        refunds: [],
        claim: "a_to_z",
      }),
    );
    const after = await scoped((tx) => getOrder(tx, original));
    expect(after?.order.buyerClaim).toBe("a_to_z");
    expect(after?.order.financeCheckedAt).toBeInstanceOf(Date);
  });

  it("hides a disconnected account's orders, and finds the region's connections with their latest order", async () => {
    const { connectionId, euChannelId } = await scoped(async (tx) => {
      const connection = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "amazon_sp",
        name: "Amazon Seller Central · Europe",
        settings: { region: "eu" },
      });
      await saveAmazonChannels(tx, {
        orgId,
        connectionId: connection.id,
        marketplaces: [
          {
            marketplaceId: "A2VIGQ35RCS4UG",
            name: "Amazon.ae",
            country: "AE",
            currency: "AED",
            participating: true,
            hasSuspendedListings: false,
            storeName: null,
          },
        ],
      });
      const [channel] = await tx
        .select()
        .from(schema.salesChannels)
        .where(sql`${schema.salesChannels.connectionId} = ${connection.id}`);
      return { connectionId: connection.id, euChannelId: channel?.id ?? "" };
    });
    expect(await scoped((tx) => amazonConnectionsForRegion(tx, "eu"))).toEqual([
      { id: connectionId, status: "active", latestOrderId: null },
    ]);
    await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId: euChannelId,
        from: "2026-09-01",
        orders: [
          order("406-0000001-0000001", { marketplaceId: "A2VIGQ35RCS4UG", currency: "AED" }),
          order("406-0000002-0000002", {
            marketplaceId: "A2VIGQ35RCS4UG",
            currency: "AED",
            purchasedAt: "2026-09-11T15:00:00Z",
          }),
        ],
      }),
    );
    expect(await scoped((tx) => amazonConnectionsForRegion(tx, "eu"))).toEqual([
      { id: connectionId, status: "active", latestOrderId: "406-0000002-0000002" },
    ]);
    const listed = async () =>
      (await scoped((tx) => listOrders(tx, { timezone: "UTC", limit: 50, offset: 0 }))).rows.map(
        (r) => r.externalId,
      );
    expect(await listed()).toContain("406-0000001-0000001");
    const [ae] = (
      await scoped((tx) =>
        listOrders(tx, { timezone: "UTC", channelId: euChannelId, limit: 1, offset: 0 }),
      )
    ).rows;

    await scoped((tx) => disconnectAmazon(tx, connectionId));
    const after = await listed();
    expect(after.some((id) => id.startsWith("406-"))).toBe(false);
    expect(after).toContain("702-0000001-0000001");
    expect(await scoped((tx) => getOrder(tx, ae?.id ?? ""))).toBeNull();
    const totals = await scoped((tx) => listOrders(tx, { timezone: "UTC", limit: 1, offset: 0 }));
    expect(totals.totals.map((t) => t.channelName)).toEqual(["Amazon.ca"]);
    // Still there, for when the same account is connected again.
    expect(await scoped((tx) => amazonConnectionsForRegion(tx, "eu"))).toEqual([
      { id: connectionId, status: "disconnected", latestOrderId: "406-0000002-0000002" },
    ]);
  });

  it("numbers invoices per company and keeps buyer details off the order", async () => {
    await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId,
        from: "2026-09-01",
        orders: [order("702-9990001-0000001"), order("702-9990002-0000002")],
      }),
    );
    const saved = await scoped((tx) =>
      tx
        .select({ id: schema.orders.id, externalId: schema.orders.externalId })
        .from(schema.orders)
        .where(inArray(schema.orders.externalId, ["702-9990001-0000001", "702-9990002-0000002"])),
    );
    const first = saved.find((row) => row.externalId === "702-9990001-0000001");
    const second = saved.find((row) => row.externalId === "702-9990002-0000002");
    const document = (company: string, number: string) =>
      prepareOrderInvoice({
        number,
        seller: {
          legalName: "Orders Org",
          tradeName: null,
          address: "Toronto",
          tradeLicense: null,
          taxNumber: null,
          taxName: "GST/HST",
          registered: false,
        },
        buyer: { name: null, company, taxNumber: "100234567800003", address: null },
        orderNumber: "702-9990001-0000001",
        marketplace: "Amazon.ca",
        currency: "CAD",
        purchasedOn: "2026-09-10",
        invoiceDate: "2026-10-07",
        total: "25.0000",
        refunded: null,
        items: [],
      });

    const created = await scoped(async (tx) => {
      const n = await nextInvoiceNumber(tx, orgId);
      const id = crypto.randomUUID();
      const snapshot = document("Acme Trading LLC", formatInvoiceNumber(n));
      await insertOrderInvoice(tx, {
        id,
        orgId,
        orderId: first?.id ?? "",
        invoiceNumber: n,
        snapshot,
        storageKey: `org/${orgId}/invoices/${id}/first.pdf`,
        fileName: `${snapshot.number}.pdf`,
        userId: null,
      });
      return { id, number: snapshot.number };
    });
    expect(created.number).toBe("INV-0001");

    const secondNumber = await scoped(async (tx) => {
      const n = await nextInvoiceNumber(tx, orgId);
      const id = crypto.randomUUID();
      const snapshot = document("Other Buyer", formatInvoiceNumber(n));
      await insertOrderInvoice(tx, {
        id,
        orgId,
        orderId: second?.id ?? "",
        invoiceNumber: n,
        snapshot,
        storageKey: `org/${orgId}/invoices/${id}/second.pdf`,
        fileName: `${snapshot.number}.pdf`,
        userId: null,
      });
      return snapshot.number;
    });
    expect(secondNumber).toBe("INV-0002");

    const stored = await scoped((tx) => getOrderInvoice(tx, first?.id ?? ""));
    expect(stored?.snapshot.buyer.company).toBe("Acme Trading LLC");
    expect(JSON.stringify(stored?.snapshot)).not.toContain("email");
    const detail = await scoped((tx) => getOrder(tx, first?.id ?? ""));
    expect(JSON.stringify(detail?.order)).not.toContain("Acme Trading LLC");
    expect(JSON.stringify(detail?.order)).not.toContain("100234567800003");
    const columns = await owner.pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'orders'",
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain("buyer_email");
    expect(names).not.toContain("buyer_name");
    expect(await scoped((tx) => getOrderInvoice(tx, first?.id ?? ""), otherOrgId)).toBeNull();

    await scoped((tx) =>
      updateOrderInvoice(tx, {
        id: created.id,
        snapshot: document("Corrected Co", "INV-0001"),
        storageKey: `org/${orgId}/invoices/${created.id}/corrected.pdf`,
        fileName: "INV-0001.pdf",
        userId: null,
      }),
    );
    const corrected = await scoped((tx) => getOrderInvoice(tx, first?.id ?? ""));
    expect(corrected?.invoiceNumber).toBe(1);
    expect(corrected?.snapshot.number).toBe("INV-0001");
    expect(corrected?.snapshot.buyer.company).toBe("Corrected Co");
  });
});

describe("order glance", () => {
  it("counts a day's orders, units and sales, and skips canceled ones", async () => {
    await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId,
        from: "2026-01-01",
        orders: [
          order("702-glance-1", {
            purchasedAt: "2026-01-10T12:00:00Z",
            lastUpdatedAt: "2026-01-10T12:00:00Z",
            total: "10.5000",
            itemsShipped: 2,
            itemsUnshipped: 1,
          }),
          order("702-glance-2", {
            purchasedAt: "2026-01-10T18:00:00Z",
            lastUpdatedAt: "2026-01-10T18:00:00Z",
            status: "Canceled",
            total: "99.0000",
            itemsShipped: 5,
          }),
          order("702-glance-3", {
            purchasedAt: "2026-01-11T08:00:00Z",
            lastUpdatedAt: "2026-01-11T08:00:00Z",
            status: "Pending",
            total: null,
            itemsShipped: 0,
            itemsUnshipped: 1,
          }),
        ],
      }),
    );
    const rows = await scoped((tx) =>
      orderGlance(tx, { timezone: "UTC", from: "2026-01-10", to: "2026-01-11" }),
    );
    expect(rows).toEqual([
      { date: "2026-01-10", currency: "CAD", orders: 1, units: 3, sales: "10.5000" },
      { date: "2026-01-11", currency: "CAD", orders: 1, units: 1, sales: "0.0000" },
    ]);
  });
});

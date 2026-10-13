import { parseEbayOrdersPage } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { salesByMonth } from "../cogs";
import { addEbayChannel, saveOrdersWithItems } from "../commerce";
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

// Synthetic eBay orders, as the Fulfillment API pages them.
const ebayOrder = (over: { id: string; modified: string; status: string; qty: number }) => ({
  orderId: over.id,
  creationDate: "2026-09-02T14:05:00.000Z",
  lastModifiedDate: over.modified,
  orderFulfillmentStatus: over.status,
  orderPaymentStatus: "PAID",
  pricingSummary: { total: { value: "31.98", currency: "USD" } },
  lineItems: [
    {
      lineItemId: `${over.id}-1`,
      legacyItemId: "110550001",
      sku: "EB-MUG",
      title: "Maple leaf ceramic mug",
      quantity: over.qty,
      lineItemCost: { value: "31.98", currency: "USD" },
      lineItemFulfillmentStatus: over.status === "FULFILLED" ? "FULFILLED" : "NOT_STARTED",
      listingMarketplaceId: "EBAY_US",
    },
  ],
});
const save = (orders: ReturnType<typeof ebayOrder>[], from = "2026-01-01") =>
  scoped((tx) =>
    saveOrdersWithItems(tx, {
      orgId,
      channelId,
      from,
      orders: parseEbayOrdersPage({ total: orders.length, orders }, "EBAY_US").orders,
    }),
  );

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "eBay Orders Org", slug: "ebay-orders-org", createdAt: new Date() },
      { name: "Other eBay Orders Org", slug: "other-ebay-orders-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  channelId = (
    await scoped((tx) =>
      addEbayChannel(tx, {
        orgId,
        marketplace: { id: "EBAY_US", name: "eBay US", country: "US", currency: "USD" },
      }),
    )
  ).channel.id;
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("eBay orders", () => {
  it("saves an order with its items in one go", async () => {
    expect(
      await save([
        ebayOrder({ id: "A", modified: "2026-09-02T15:00:00Z", status: "NOT_STARTED", qty: 2 }),
      ]),
    ).toBe(1);
    const [order] = await scoped((tx) => tx.select().from(schema.orders));
    expect(order).toMatchObject({
      externalId: "A",
      status: "Unshipped",
      fulfillment: "merchant",
      itemsUnshipped: 2,
    });
    expect(order?.itemsSyncedAt).not.toBeNull();
    const items = await scoped((tx) => tx.select().from(schema.orderItems));
    expect(items.map((i) => [i.sku, i.asin, i.quantityOrdered, i.quantityShipped])).toEqual([
      ["EB-MUG", "110550001", 2, 0],
    ]);
  });

  it("brings a shipped order up to date, and an older copy changes nothing", async () => {
    await save([
      ebayOrder({ id: "A", modified: "2026-09-04T10:00:00Z", status: "FULFILLED", qty: 2 }),
    ]);
    expect(
      await save([
        ebayOrder({ id: "A", modified: "2026-09-02T15:00:00Z", status: "NOT_STARTED", qty: 2 }),
      ]),
    ).toBe(0);
    const orders = await scoped((tx) => tx.select().from(schema.orders));
    expect(orders.map((o) => [o.externalId, o.status, o.itemsShipped])).toEqual([
      ["A", "Shipped", 2],
    ]);
    const items = await scoped((tx) => tx.select().from(schema.orderItems));
    expect(items.map((i) => [i.sku, i.quantityShipped])).toEqual([["EB-MUG", 2]]);
  });

  it("leaves out orders placed before the start date", async () => {
    expect(
      await save(
        [ebayOrder({ id: "OLD", modified: "2026-09-02T15:00:00Z", status: "FULFILLED", qty: 1 })],
        "2026-10-01",
      ),
    ).toBe(0);
    expect(await scoped((tx) => tx.select().from(schema.orders))).toHaveLength(1);
  });

  it("counts eBay's units shipped for cost of goods sold", async () => {
    const months = await scoped((tx) => salesByMonth(tx, { timezone: "America/Toronto" }));
    expect(months.map((m) => [m.channelName, m.month, m.unlinkedUnits, m.unlinkedSkus])).toEqual([
      ["eBay US", "2026-09", 2, ["EB-MUG"]],
    ]);
  });

  it("keeps each company's eBay orders to itself", async () => {
    expect(await scoped((tx) => tx.select().from(schema.orders), otherOrgId)).toEqual([]);
  });
});

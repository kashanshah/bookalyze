import { type AmazonOrder, type AmazonOrderItem, planReorder } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { addOpeningStock } from "../cogs";
import { saveAmazonChannels, saveOrderItems, upsertOrders } from "../commerce";
import { createProduct, linkSku } from "../inventory";
import { createDefaultChart } from "../ledger";
import {
  getReorderSettings,
  reorderProducts,
  saveProductReorder,
  saveReorderSettings,
} from "../reorder";
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
let mugId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);
const where = { timezone: "America/Toronto", baseCurrency: "CAD" };
const today = "2026-10-15";

const order = (id: string, purchasedAt: string): AmazonOrder => ({
  orderId: id,
  marketplaceId: "A2EUQ1WTGCTBG2",
  purchasedAt,
  lastUpdatedAt: purchasedAt,
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
});

const item = (sku: string, quantity: number): AmazonOrderItem => ({
  itemId: `${sku}-${quantity}`,
  asin: "B000TEST01",
  sku,
  title: sku,
  quantityOrdered: quantity,
  quantityShipped: quantity,
  itemPrice: "20.0000",
  itemTax: null,
  shippingPrice: null,
  shippingTax: null,
  promotionDiscount: null,
});

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Reorder Org", slug: "reorder-org", createdAt: new Date() },
      { name: "Other Reorder Org", slug: "other-reorder-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    await createDefaultChart(tx, { orgId, baseCurrency: "CAD" });
    const connection = await createConnection(tx, {
      orgId,
      userId: null,
      provider: "amazon_sp",
      name: "Amazon",
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
    channelId = (await tx.select().from(schema.salesChannels))[0]?.id ?? "";
    mugId = (await createProduct(tx, { orgId, userId: null, name: "Mug", sku: null, notes: null }))
      .id;
    await createProduct(tx, { orgId, userId: null, name: "Idle vase", sku: null, notes: null });
    for (const [sku, units] of [
      ["MUG", 1],
      ["MUG-2PK", 2],
    ] as const) {
      await linkSku(tx, { orgId, userId: null, productId: mugId, channelId, sku, units });
    }
    // 20 mugs counted at the end of September; cost of goods sold starts in September.
    await addOpeningStock(tx, {
      orgId,
      userId: null,
      productId: mugId,
      quantity: 20,
      unitCost: "2.00",
      date: "2026-09-30",
      notes: null,
      baseCurrency: "CAD",
    });
    // October: 3 mugs and a 2-pack (5), not costed yet. June: before the 90 days and the start.
    await upsertOrders(tx, {
      orgId,
      channelId,
      from: "2000-01-01",
      orders: [
        order("702-1", "2026-10-10T15:00:00Z"),
        order("702-2", "2026-10-12T15:00:00Z"),
        order("702-3", "2026-06-01T15:00:00Z"),
      ],
    });
    const saved = await tx.select().from(schema.orders);
    const id = (ext: string) => saved.find((o) => o.externalId === ext)?.id ?? "";
    await saveOrderItems(tx, { orgId, orderId: id("702-1"), items: [item("MUG", 3)] });
    await saveOrderItems(tx, { orgId, orderId: id("702-2"), items: [item("MUG-2PK", 1)] });
    await saveOrderItems(tx, { orgId, orderId: id("702-3"), items: [item("MUG", 7)] });
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("reorder planner", () => {
  it("brings each product's daily sales, stock left and what's on order", async () => {
    const rows = await scoped((tx) => reorderProducts(tx, { timezone: where.timezone, today }));
    // The vase isn't selling, in stock or on order: left out.
    expect(rows.map((r) => r.name)).toEqual(["Mug"]);
    const [mug] = rows;
    expect(mug?.dailyUnits).toHaveLength(90);
    // Oldest first, ending yesterday: Oct 10 is 5 days back, Oct 12 three days back.
    expect(mug?.dailyUnits.slice(-6)).toEqual([0, 3, 0, 2, 0, 0]);
    expect(mug?.dailyUnits.reduce((a, b) => a + b, 0)).toBe(5);
    // 20 counted, less the 5 shipped in October (not costed yet).
    expect(mug).toMatchObject({ inStock: 15, onOrder: 0, leadTimeDays: null });
  });

  it("uses the company's defaults until they're saved, and a product's own lead time", async () => {
    expect(await scoped((tx) => getReorderSettings(tx))).toEqual({
      leadTimeDays: 45,
      coverDays: 60,
      saved: false,
    });
    await scoped((tx) =>
      saveReorderSettings(tx, { orgId, userId: null, leadTimeDays: 30, coverDays: 90 }),
    );
    expect(await scoped((tx) => getReorderSettings(tx))).toEqual({
      leadTimeDays: 30,
      coverDays: 90,
      saved: true,
    });
    expect(
      await scoped((tx) =>
        saveProductReorder(tx, {
          productId: mugId,
          leadTimeDays: 20,
          minimumOrder: 50,
          casePack: 12,
        }),
      ),
    ).toBe(true);
    const [mug] = await scoped((tx) => reorderProducts(tx, { timezone: where.timezone, today }));
    expect(mug).toMatchObject({ leadTimeDays: 20, minimumOrder: 50, casePack: 12 });
    const plan = planReorder({
      today,
      dailyUnits: mug?.dailyUnits ?? [],
      inStock: mug?.inStock ?? 0,
      onOrder: mug?.onOrder ?? 0,
      leadTimeDays: 20,
      coverDays: 90,
      minimumOrder: 50,
      casePack: 12,
    });
    expect(plan.velocity).toBeGreaterThan(0);
    expect(plan.orderQuantity % 12).toBe(0);
  });

  it("keeps each company's plan to itself", async () => {
    expect(
      await scoped((tx) => reorderProducts(tx, { timezone: "UTC", today }), otherOrgId),
    ).toEqual([]);
    expect((await scoped((tx) => getReorderSettings(tx), otherOrgId)).saved).toBe(false);
    expect(
      await scoped(
        (tx) =>
          saveProductReorder(tx, {
            productId: mugId,
            leadTimeDays: 1,
            minimumOrder: null,
            casePack: null,
          }),
        otherOrgId,
      ),
    ).toBe(false);
  });
});

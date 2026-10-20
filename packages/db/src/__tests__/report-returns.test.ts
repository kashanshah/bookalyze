import type { AmazonOrder, AmazonOrderItem, LedgerEvent } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { addOpeningStock, previewCogs, salesByMonth } from "../cogs";
import { saveAmazonChannels, saveOrderItems, upsertOrders } from "../commerce";
import { createProduct, linkSku } from "../inventory";
import { addReportReturns, importLedgerEvents } from "../inventory-ledger";
import { createDefaultChart } from "../ledger";
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
let channelId: string;
let mugId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId }, fn);
const where = { timezone: "America/Toronto", baseCurrency: "CAD" };

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
const ledger = (date: string, quantity: number, n: number): LedgerEvent => ({
  date,
  sku: "MUG",
  fnsku: null,
  asin: null,
  title: null,
  eventType: "CustomerReturns",
  referenceId: null,
  quantity,
  fulfillmentCenter: "YYZ4",
  disposition: "SELLABLE",
  reason: null,
  country: "CA",
  key: `${date}|MUG|CustomerReturns|${n}`,
});
const reportReturns = () =>
  scoped((tx) =>
    tx
      .select({
        date: schema.inventoryLedgerEvents.eventDate,
        quantity: schema.inventoryLedgerEvents.quantity,
        key: schema.inventoryLedgerEvents.key,
      })
      .from(schema.inventoryLedgerEvents)
      .orderBy(schema.inventoryLedgerEvents.eventDate),
  );

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: "Refund Returns Org", slug: "refund-returns-org", createdAt: new Date() })
    .returning({ id: schema.organization.id });
  orgId = org?.id ?? "";
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
    await linkSku(tx, { orgId, userId: null, productId: mugId, channelId, sku: "MUG", units: 1 });
    await upsertOrders(tx, {
      orgId,
      channelId,
      from: "2000-01-01",
      orders: [order("702-1", "2024-03-10T15:00:00Z")],
    });
    const [saved] = await tx.select().from(schema.orders);
    await saveOrderItems(tx, { orgId, orderId: saved?.id ?? "", items: [item("MUG", 3)] });
    await addOpeningStock(tx, {
      orgId,
      userId: null,
      productId: mugId,
      quantity: 10,
      unitCost: "2.00",
      date: "2024-02-29",
      notes: null,
      baseCurrency: "CAD",
    });
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("refunds counted as returns before the inventory ledger", () => {
  it("adds them once, and cost of goods sold puts the units back into stock", async () => {
    const returns = [
      { date: "2024-03-15", orderId: "702-1", sku: "MUG", quantity: 1 },
      { date: "2024-06-02", orderId: "702-9", sku: "MUG", quantity: 2 },
    ];
    expect(await scoped((tx) => addReportReturns(tx, { orgId, channelId, returns }))).toEqual({
      added: 2,
      covered: 0,
    });
    // The same report again adds nothing.
    expect((await scoped((tx) => addReportReturns(tx, { orgId, channelId, returns }))).added).toBe(
      0,
    );

    const months = await scoped((tx) => salesByMonth(tx, { timezone: where.timezone }));
    expect(months.find((m) => m.month === "2024-03")).toMatchObject({ units: 3, returned: 1 });
    // No ledger brought in, yet the return counts: back at this month's cost of one.
    const preview = await scoped((tx) =>
      previewCogs(tx, { channelId, month: "2024-03", ...where }),
    );
    expect(preview).toMatchObject({
      problems: [],
      units: 3,
      cost: "6.0000",
      returned: 1,
      returnedCost: "2.0000",
      ledgerThrough: null,
    });
  });

  it("leaves the days the ledger covers to the ledger", async () => {
    // Amazon's own ledger, from 1 May 2024: the June refund is its to count, so it goes.
    await scoped((tx) =>
      importLedgerEvents(tx, {
        orgId,
        channelId,
        events: [ledger("2024-05-01", 1, 1), ledger("2024-06-03", 2, 2)],
        through: "2024-06-30",
      }),
    );
    expect((await reportReturns()).map((r) => [r.date, r.quantity, r.key.split(":")[0]])).toEqual([
      ["2024-03-15", 1, "report-refund"],
      ["2024-05-01", 1, "2024-05-01|MUG|CustomerReturns|1"],
      ["2024-06-03", 2, "2024-06-03|MUG|CustomerReturns|2"],
    ]);
    // Brought in again later: only refunds before the ledger's first day are added.
    const again = await scoped((tx) =>
      addReportReturns(tx, {
        orgId,
        channelId,
        returns: [
          { date: "2024-04-20", orderId: "702-5", sku: "MUG", quantity: 1 },
          { date: "2024-06-02", orderId: "702-9", sku: "MUG", quantity: 2 },
        ],
      }),
    );
    expect(again).toEqual({ added: 1, covered: 1 });
  });
});

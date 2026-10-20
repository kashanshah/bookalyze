import type { AmazonOrder, AmazonOrderItem } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { addOpeningStock, postCogs } from "../cogs";
import { saveAmazonChannels, saveOrderItems, upsertOrders } from "../commerce";
import { createProduct, linkSku, saveChannelSkus } from "../inventory";
import { importLedgerEvents } from "../inventory-ledger";
import { createDefaultChart } from "../ledger";
import * as schema from "../schema";
import { addStockCount, removeStockCount, stockOverview } from "../stock-overview";

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

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: "Stock Overview Org", slug: "stock-overview-org", createdAt: new Date() })
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
      orders: [order("702-1", "2024-03-10T15:00:00Z"), order("702-2", "2024-04-10T15:00:00Z")],
    });
    const saved = await tx.select().from(schema.orders);
    const id = (ext: string) => saved.find((o) => o.externalId === ext)?.id ?? "";
    await saveOrderItems(tx, { orgId, orderId: id("702-1"), items: [item("MUG", 3)] });
    await saveOrderItems(tx, { orgId, orderId: id("702-2"), items: [item("MUG", 2)] });
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

describe("stock in one place", () => {
  it("sets the books (less months not posted) against Amazon, Noon and the count at hand", async () => {
    // March posted: 10 − 3 = 7 in the lots. April (2 sold, 1 returned) isn't posted yet.
    await scoped((tx) =>
      postCogs(tx, {
        orgId,
        userId: null,
        channelId,
        month: "2024-03",
        ...where,
        currentMonth: "2024-05",
      }),
    );
    await scoped((tx) =>
      importLedgerEvents(tx, {
        orgId,
        channelId,
        events: [
          {
            date: "2024-04-20",
            sku: "MUG",
            fnsku: null,
            asin: null,
            title: null,
            eventType: "CustomerReturns",
            referenceId: null,
            quantity: 1,
            fulfillmentCenter: null,
            disposition: "SELLABLE",
            reason: null,
            country: "CA",
            key: "r1",
          },
        ],
        through: "2024-04-30",
      }),
    );
    await scoped((tx) =>
      saveChannelSkus(tx, {
        orgId,
        channelId,
        skus: [
          {
            sku: "MUG",
            asin: null,
            title: "Mug",
            fulfillable: 3,
            reserved: 1,
            inbound: 0,
            unfulfillable: 1,
            researching: 0,
          },
        ],
      }),
    );
    const first = await scoped((tx) => stockOverview(tx, { timezone: where.timezone }));
    expect(first.monthsNotPosted).toEqual(["2024-04"]);
    expect(first.rows[0]).toMatchObject({
      inLots: 7,
      notPosted: 1,
      expected: 6,
      amazon: { sellable: 3, reserved: 1, inbound: 0, unsellable: 1, researching: 0, total: 5 },
      noon: null,
      atHand: null,
      difference: 1,
    });

    // One more with you: counted, it all matches. The latest count is the one that counts.
    await scoped((tx) =>
      addStockCount(tx, {
        orgId,
        userId: null,
        productId: mugId,
        quantity: 3,
        countedOn: "2024-05-01",
        notes: null,
      }),
    );
    const latest = await scoped((tx) =>
      addStockCount(tx, {
        orgId,
        userId: null,
        productId: mugId,
        quantity: 1,
        countedOn: "2024-05-02",
        notes: "Home",
      }),
    );
    const second = await scoped((tx) => stockOverview(tx, { timezone: where.timezone }));
    expect(second.rows[0]).toMatchObject({
      atHand: { quantity: 1, countedOn: "2024-05-02", notes: "Home" },
      difference: 0,
    });
    await scoped((tx) => removeStockCount(tx, { productId: mugId, countId: latest.id }));
    const third = await scoped((tx) => stockOverview(tx, { timezone: where.timezone }));
    expect(third.rows[0]).toMatchObject({ atHand: { quantity: 3 }, difference: -2 });
  });
});

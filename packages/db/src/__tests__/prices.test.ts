import { parseListingItem } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { addOpeningStock } from "../cogs";
import { saveAmazonChannels } from "../commerce";
import { createProduct, linkSku } from "../inventory";
import { createDefaultChart } from "../ledger";
import {
  amazonSellerId,
  expireStalePriceChanges,
  markPriceChange,
  nextUnitCosts,
  pendingPriceChanges,
  pricedSkus,
  recordPriceChange,
  saveAmazonSellerId,
  saveListingPrice,
} from "../prices";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

const CA = "A2EUQ1WTGCTBG2";
let orgId: string;
let otherOrgId: string;
let connectionId: string;
let channelId: string;
let mugId: string;
let coasterId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Prices Org", slug: "prices-org", createdAt: new Date() },
      { name: "Other Prices Org", slug: "other-prices-org", createdAt: new Date() },
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
    connectionId = connection.id;
    await saveAmazonChannels(tx, {
      orgId,
      connectionId,
      marketplaces: [
        {
          marketplaceId: CA,
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
    const product = (name: string) =>
      createProduct(tx, { orgId, userId: null, name, sku: null, notes: null });
    mugId = (await product("Mug")).id;
    coasterId = (await product("Coaster")).id;
    await linkSku(tx, {
      orgId,
      userId: null,
      productId: mugId,
      channelId,
      sku: "MUG-2PK",
      units: 2,
    });
    await linkSku(tx, {
      orgId,
      userId: null,
      productId: coasterId,
      channelId,
      sku: "COASTER",
      units: 1,
    });
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("listing prices", () => {
  it("lists linked SKUs with what each listing holds, and keeps what Amazon reports", async () => {
    const before = await scoped((tx) => pricedSkus(tx));
    expect(before.map((r) => [r.sku, r.components, r.price])).toEqual([
      ["COASTER", [{ productId: coasterId, productName: "Coaster", units: 1 }], null],
      ["MUG-2PK", [{ productId: mugId, productName: "Mug", units: 2 }], null],
    ]);
    await scoped((tx) =>
      saveListingPrice(tx, {
        orgId,
        channelId,
        sku: "MUG-2PK",
        listing: parseListingItem(
          {
            sku: "MUG-2PK",
            summaries: [{ marketplaceId: CA, productType: "DRINKING_CUP", status: ["BUYABLE"] }],
            offers: [
              { marketplaceId: CA, offerType: "B2C", price: { currency: "CAD", amount: "29.99" } },
            ],
            issues: [{ severity: "ERROR", message: "Missing a main photo." }],
          },
          CA,
        ),
      }),
    );
    await scoped((tx) => saveListingPrice(tx, { orgId, channelId, sku: "COASTER", listing: null }));
    const after = await scoped((tx) => pricedSkus(tx));
    expect(after.find((r) => r.sku === "MUG-2PK")).toMatchObject({
      price: "29.9900",
      currency: "CAD",
      status: ["BUYABLE"],
      problems: ["Missing a main photo."],
      found: true,
    });
    expect(after.find((r) => r.sku === "COASTER")).toMatchObject({ price: null, found: false });
  });

  it("records changes, finds those to check, and marks them", async () => {
    const change = await scoped((tx) =>
      recordPriceChange(tx, {
        orgId,
        userId: null,
        channelId,
        sku: "MUG-2PK",
        currency: "CAD",
        oldPrice: "29.99",
        newPrice: "27.50",
        status: "sent",
        submissionId: "sub-1",
        message: null,
      }),
    );
    const soon = new Date(Date.now() + 60_000);
    expect((await scoped((tx) => pendingPriceChanges(tx, soon))).map((c) => c.id)).toEqual([
      change.id,
    ]);
    // Not before it's had time to apply.
    expect(await scoped((tx) => pendingPriceChanges(tx, new Date(Date.now() - 60_000)))).toEqual(
      [],
    );
    const row = (await scoped((tx) => pricedSkus(tx))).find((r) => r.sku === "MUG-2PK");
    expect(row?.lastChange).toMatchObject({ newPrice: "27.5000", status: "sent" });

    await scoped((tx) => markPriceChange(tx, change.id, "applied"));
    expect(await scoped((tx) => pendingPriceChanges(tx, soon))).toEqual([]);

    // A change Amazon took but never showed is given up after a day.
    const stale = await scoped((tx) =>
      recordPriceChange(tx, {
        orgId,
        userId: null,
        channelId,
        sku: "COASTER",
        currency: "CAD",
        oldPrice: null,
        newPrice: "9.99",
        status: "sent",
        submissionId: null,
        message: null,
      }),
    );
    await scoped((tx) => expireStalePriceChanges(tx, soon));
    const coaster = (await scoped((tx) => pricedSkus(tx))).find((r) => r.sku === "COASTER");
    expect(coaster?.lastChange).toMatchObject({ id: stale.id, status: "refused" });
    expect(coaster?.lastChange?.message).toMatch(/Seller Central/);
  });

  it("costs the next unit from the oldest lot with stock left", async () => {
    expect((await scoped((tx) => nextUnitCosts(tx, [mugId]))).size).toBe(0);
    const ctx = { orgId, userId: null };
    for (const [quantity, unitCost, date] of [
      [10, "3.00", "2026-08-01"],
      [10, "4.00", "2026-09-01"],
    ] as const) {
      await scoped((tx) =>
        addOpeningStock(tx, {
          ...ctx,
          productId: mugId,
          quantity,
          unitCost,
          date,
          notes: null,
          baseCurrency: "CAD",
        }),
      );
    }
    expect(await scoped((tx) => nextUnitCosts(tx, [mugId, coasterId]))).toEqual(
      new Map([[mugId, { cost: "3.0000", currency: "CAD", source: "stock" }]]),
    );
  });

  it("keeps the seller ID on the connection, and each company's prices to itself", async () => {
    expect(await scoped((tx) => amazonSellerId(tx, connectionId))).toBeNull();
    await scoped((tx) => saveAmazonSellerId(tx, connectionId, "A1TESTSELLER01"));
    expect(await scoped((tx) => amazonSellerId(tx, connectionId))).toBe("A1TESTSELLER01");
    const [settings] = await scoped((tx) =>
      tx.select({ s: schema.connections.settings }).from(schema.connections),
    );
    expect(settings?.s).toMatchObject({ region: "na", sellerId: "A1TESTSELLER01" });
    expect(await scoped((tx) => pricedSkus(tx), otherOrgId)).toEqual([]);
  });
});

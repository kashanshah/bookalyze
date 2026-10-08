import type { AmazonOrder, AmazonOrderItem } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { saveAmazonChannels, saveOrderItems, upsertOrders } from "../commerce";
import {
  createProduct,
  createProductFromSku,
  getProduct,
  InventoryError,
  linkBundle,
  linkSku,
  listProducts,
  saveChannelSkus,
  setProductArchived,
  unlinkedSkus,
  unlinkSku,
  updateProduct,
} from "../inventory";
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

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const order = (id: string, purchasedAt: string, status = "Shipped"): AmazonOrder => ({
  orderId: id,
  marketplaceId: "A2EUQ1WTGCTBG2",
  purchasedAt,
  lastUpdatedAt: purchasedAt,
  status,
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

const item = (sku: string, title: string, quantity: number): AmazonOrderItem => ({
  itemId: `${sku}-${quantity}`,
  asin: "B000TEST01",
  sku,
  title,
  quantityOrdered: quantity,
  quantityShipped: quantity,
  itemPrice: "20.0000",
  itemTax: null,
  shippingPrice: null,
  shippingTax: null,
  promotionDiscount: null,
});

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Inventory Org", slug: "inventory-org", createdAt: new Date() },
      { name: "Other Inventory Org", slug: "other-inventory-org", createdAt: new Date() },
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
    const id = channel?.id ?? "";
    // A mug sold 3 times in the last month (one order cancelled), an old one, and a candle.
    await upsertOrders(tx, {
      orgId,
      channelId: id,
      from: "2000-01-01",
      orders: [
        order("702-0000001-0000001", daysAgo(3)),
        order("702-0000002-0000002", daysAgo(5)),
        order("702-0000003-0000003", daysAgo(4), "Canceled"),
        order("702-0000004-0000004", daysAgo(60)),
        order("702-0000005-0000005", daysAgo(1)),
      ],
    });
    const saved = await tx
      .select({ id: schema.orders.id, externalId: schema.orders.externalId })
      .from(schema.orders);
    const orderId = (externalId: string) => saved.find((o) => o.externalId === externalId)?.id;
    const items: [string, AmazonOrderItem[]][] = [
      ["702-0000001-0000001", [item("MAPLE-MUG", "Maple mug", 1)]],
      ["702-0000002-0000002", [item("MAPLE-MUG-2PK", "Maple mug, set of 2", 1)]],
      ["702-0000003-0000003", [item("MAPLE-MUG", "Maple mug", 5)]],
      ["702-0000004-0000004", [item("MAPLE-MUG", "Maple mug (old title)", 7)]],
      ["702-0000005-0000005", [item("PINE-CANDLE", "Pine candle", 2)]],
    ];
    for (const [externalId, list] of items) {
      await saveOrderItems(tx, { orgId, orderId: orderId(externalId) ?? "", items: list });
    }
    return id;
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("products", () => {
  it("creates, edits, archives and refuses a second product with the same own SKU", async () => {
    const created = await scoped((tx) =>
      createProduct(tx, {
        orgId,
        userId: null,
        name: "Linen napkins",
        sku: "NAP-01",
        notes: "Set of four",
      }),
    );
    await expect(
      scoped((tx) =>
        createProduct(tx, { orgId, userId: null, name: "Other", sku: "nap-01", notes: null }),
      ),
    ).rejects.toBeInstanceOf(InventoryError);

    const updated = await scoped((tx) =>
      updateProduct(tx, { id: created.id, name: "Linen napkins (4)", sku: "NAP-04", notes: null }),
    );
    expect(updated.name).toBe("Linen napkins (4)");

    await scoped((tx) => setProductArchived(tx, created.id, true));
    const visible = await scoped((tx) => listProducts(tx));
    expect(visible.some((p) => p.id === created.id)).toBe(false);
    const all = await scoped((tx) => listProducts(tx, { includeArchived: true }));
    expect(all.find((p) => p.id === created.id)?.isArchived).toBe(true);

    // The database refuses an empty name.
    await expect(
      scoped((tx) =>
        createProduct(tx, { orgId, userId: null, name: "  ", sku: null, notes: null }),
      ),
    ).rejects.toThrow();
  });

  it("lists unlinked SKUs, links them, counts units sold and refuses a second link", async () => {
    const before = await scoped((tx) => unlinkedSkus(tx, { limit: 10 }));
    expect(before.total).toBe(3);
    expect(before.rows.map((r) => r.sku)).toEqual(["PINE-CANDLE", "MAPLE-MUG", "MAPLE-MUG-2PK"]);
    const mugRow = before.rows.find((r) => r.sku === "MAPLE-MUG");
    expect(mugRow).toMatchObject({
      title: "Maple mug",
      orders: 3,
      units: 8,
      channelName: "Amazon.ca",
    });

    const { product } = await scoped((tx) =>
      createProductFromSku(tx, { orgId, userId: null, channelId, sku: "MAPLE-MUG" }),
    );
    expect(product.name).toBe("Maple mug");
    expect(product.sku).toBe("MAPLE-MUG");

    await scoped((tx) =>
      linkSku(tx, {
        orgId,
        userId: null,
        productId: product.id,
        channelId,
        sku: "MAPLE-MUG-2PK",
        units: 2,
      }),
    );
    const after = await scoped((tx) => unlinkedSkus(tx, { limit: 10 }));
    expect(after.rows.map((r) => r.sku)).toEqual(["PINE-CANDLE"]);
    expect(after.total).toBe(1);

    // Last 30 days: 1 mug + one 2-pack (2) = 3; the cancelled and the 60-day-old orders don't count.
    const mug = await scoped((tx) => getProduct(tx, product.id));
    expect(mug?.unitsSold30d).toBe(3);
    expect(mug?.skus.map((s) => [s.sku, s.units, s.channelName])).toEqual([
      ["MAPLE-MUG", 1, "Amazon.ca"],
      ["MAPLE-MUG-2PK", 2, "Amazon.ca"],
    ]);

    // Linking again to the same product changes its units; to another product is refused.
    await scoped((tx) =>
      linkSku(tx, {
        orgId,
        userId: null,
        productId: product.id,
        channelId,
        sku: "MAPLE-MUG",
        units: 3,
      }),
    );
    expect((await scoped((tx) => getProduct(tx, product.id)))?.unitsSold30d).toBe(5);
    const candle = await scoped((tx) =>
      createProduct(tx, { orgId, userId: null, name: "Pine candle", sku: null, notes: null }),
    );
    await expect(
      scoped((tx) =>
        linkSku(tx, {
          orgId,
          userId: null,
          productId: candle.id,
          channelId,
          sku: "MAPLE-MUG",
          units: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "linked" });
    // Units are between 1 and 1000.
    await expect(
      scoped((tx) =>
        linkSku(tx, {
          orgId,
          userId: null,
          productId: candle.id,
          channelId,
          sku: "PINE-CANDLE",
          units: 0,
        }),
      ),
    ).rejects.toThrow();

    // Search finds a product by a linked SKU.
    const found = await scoped((tx) => listProducts(tx, { search: "2pk" }));
    expect(found.map((p) => p.id)).toEqual([product.id]);

    // Unlinking puts the SKU back on the list.
    const link = mug?.skus.find((s) => s.sku === "MAPLE-MUG-2PK");
    await scoped((tx) => unlinkSku(tx, link?.id ?? ""));
    const again = await scoped((tx) => unlinkedSkus(tx, { limit: 10 }));
    expect(again.rows.map((r) => r.sku).sort()).toEqual(["MAPLE-MUG-2PK", "PINE-CANDLE"]);
    await expect(scoped((tx) => unlinkSku(tx, link?.id ?? ""))).rejects.toBeInstanceOf(
      InventoryError,
    );
  });

  it("lists SKUs the marketplace has that were never ordered, after the ordered ones", async () => {
    // FBA inventory: one SKU already on orders (PINE-CANDLE), two variations never sold.
    const saved = await scoped((tx) =>
      saveChannelSkus(tx, {
        orgId,
        channelId,
        skus: [
          { sku: "PINE-CANDLE", asin: "B0PINE", title: "Pine candle (listing)", fulfillable: 4 },
          { sku: "MUG-500", asin: "B0MUG5", title: "Maple mug, 500ml", fulfillable: 12 },
          { sku: "MUG-100", asin: "B0MUG1", title: "Maple mug, 100ml", fulfillable: 0 },
        ],
      }),
    );
    expect(saved).toBe(3);
    const list = await scoped((tx) => unlinkedSkus(tx, { limit: 10 }));
    expect(list.rows.map((r) => [r.sku, r.orders, r.fulfillable])).toEqual([
      ["PINE-CANDLE", 1, 4],
      ["MAPLE-MUG-2PK", 1, null],
      ["MUG-100", 0, 0],
      ["MUG-500", 0, 12],
    ]);
    // The order title wins over the listing's; a never-ordered SKU uses the listing's.
    expect(list.rows[0]?.title).toBe("Pine candle");
    expect(list.rows[2]?.lastOrderedAt).toBeNull();
    expect(list.total).toBe(4);

    const { product } = await scoped((tx) =>
      createProductFromSku(tx, { orgId, userId: null, channelId, sku: "MUG-500" }),
    );
    expect(product.name).toBe("Maple mug, 500ml");
    expect((await scoped((tx) => unlinkedSkus(tx, { limit: 10 }))).total).toBe(3);
  });

  it("links one listing to several products as a bundle", async () => {
    const mug = (await scoped((tx) => listProducts(tx))).find((p) => p.name === "Maple mug");
    const box = await scoped((tx) =>
      createProduct(tx, { orgId, userId: null, name: "Gift box", sku: null, notes: null }),
    );
    // Linking a second product to a linked SKU needs the bundle box ticked.
    await scoped((tx) =>
      linkSku(tx, {
        orgId,
        userId: null,
        productId: box.id,
        channelId,
        sku: "PINE-CANDLE",
        units: 1,
      }),
    );
    await expect(
      scoped((tx) =>
        linkSku(tx, {
          orgId,
          userId: null,
          productId: mug?.id ?? "",
          channelId,
          sku: "PINE-CANDLE",
          units: 1,
        }),
      ),
    ).rejects.toThrow(/It's a bundle/);
    // The candle listing (2 sold yesterday) is one mug and two gift boxes.
    await scoped((tx) =>
      linkBundle(tx, {
        orgId,
        userId: null,
        channelId,
        sku: "PINE-CANDLE",
        components: [
          { productId: mug?.id ?? "", units: 1 },
          { productId: box.id, units: 2 },
        ],
      }),
    );
    const giftBox = await scoped((tx) => getProduct(tx, box.id));
    expect(giftBox?.unitsSold30d).toBe(4);
    expect(giftBox?.skus.map((s) => [s.sku, s.units, s.bundleWith.map((b) => b.name)])).toEqual([
      ["PINE-CANDLE", 2, ["Maple mug"]],
    ]);
    expect((await scoped((tx) => getProduct(tx, mug?.id ?? "")))?.unitsSold30d).toBe(3 + 2);
    expect(
      (await scoped((tx) => unlinkedSkus(tx, { limit: 10 }))).rows.map((r) => r.sku),
    ).not.toContain("PINE-CANDLE");
    await expect(
      scoped((tx) =>
        linkBundle(tx, {
          orgId,
          userId: null,
          channelId,
          sku: "PINE-CANDLE",
          components: [{ productId: box.id, units: 1 }],
        }),
      ),
    ).rejects.toThrow(/two or more/);
  });

  it("keeps products to their own company", async () => {
    const theirs = await scoped((tx) => listProducts(tx, { includeArchived: true }), otherOrgId);
    expect(theirs).toEqual([]);
    expect((await scoped((tx) => unlinkedSkus(tx, { limit: 10 }), otherOrgId)).total).toBe(0);
    const ours = await scoped((tx) => listProducts(tx));
    const id = ours[0]?.id ?? "";
    expect(await scoped((tx) => getProduct(tx, id), otherOrgId)).toBeNull();
    // Another company can't link to our product or channel.
    await expect(
      scoped(
        (tx) =>
          linkSku(tx, {
            orgId: otherOrgId,
            userId: null,
            productId: id,
            channelId,
            sku: "X",
            units: 1,
          }),
        otherOrgId,
      ),
    ).rejects.toBeInstanceOf(InventoryError);
    await expect(
      scoped(
        (tx) =>
          tx
            .insert(schema.products)
            .values({ organizationId: orgId, name: "Sneaky", sku: null, notes: null }),
        otherOrgId,
      ),
    ).rejects.toThrow();
  });
});

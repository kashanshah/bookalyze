import type { AmazonOrder, AmazonOrderItem } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import {
  addOpeningStock,
  channelsNotCosted,
  cogsMonthsToPost,
  cogsStartMonth,
  earliestOpeningStock,
  ensureSystemAccount,
  listCogsPeriods,
  postCogs,
  previewCogs,
  removeOpeningStock,
  salesByMonth,
  undoCogs,
} from "../cogs";
import {
  disconnectAmazon,
  saveAmazonChannels,
  saveOrderItems,
  setChannelActive,
  upsertOrders,
} from "../commerce";
import { createProduct, getProduct, linkSku, updateProduct } from "../inventory";
import { importLedgerEvents } from "../inventory-ledger";
import { listLots } from "../landed-costs";
import { accountBalances, createDefaultChart } from "../ledger";
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
const ctx: { orgId: string; userId: null } = { orgId: "", userId: null };

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
      { name: "Cogs Org", slug: "cogs-org", createdAt: new Date() },
      { name: "Other Cogs Org", slug: "other-cogs-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  ctx.orgId = orgId;
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
    for (const [sku, units] of [
      ["MUG", 1],
      ["MUG-2PK", 2],
    ] as const) {
      await linkSku(tx, { orgId, userId: null, productId: mugId, channelId, sku, units });
    }
    // August: 3 mugs + one 2-pack = 5. September: 4. October: 1 candle, never linked.
    await upsertOrders(tx, {
      orgId,
      channelId,
      from: "2000-01-01",
      orders: [
        order("701-1", "2026-08-10T15:00:00Z"),
        order("701-2", "2026-08-20T15:00:00Z"),
        order("701-3", "2026-09-05T15:00:00Z"),
        order("701-4", "2026-10-02T15:00:00Z"),
      ],
    });
    const saved = await tx.select().from(schema.orders);
    const id = (ext: string) => saved.find((o) => o.externalId === ext)?.id ?? "";
    await saveOrderItems(tx, { orgId, orderId: id("701-1"), items: [item("MUG", 3)] });
    await saveOrderItems(tx, { orgId, orderId: id("701-2"), items: [item("MUG-2PK", 1)] });
    await saveOrderItems(tx, { orgId, orderId: id("701-3"), items: [item("MUG", 4)] });
    await saveOrderItems(tx, { orgId, orderId: id("701-4"), items: [item("CANDLE", 1)] });
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

const balance = async (
  key: "inventory" | "cost_of_goods_sold" | "opening_balance_equity" | "inventory_write_offs",
) => {
  const id = await scoped((tx) => ensureSystemAccount(tx, orgId, key));
  const rows = await scoped((tx) => accountBalances(tx, {}));
  return rows.find((r) => r.accountId === id)?.balance ?? "0";
};

describe("cost of goods sold", () => {
  it("counts units shipped per month, packs included, and flags unlinked SKUs", async () => {
    const months = await scoped((tx) => salesByMonth(tx, { timezone: where.timezone }));
    expect(months.map((m) => [m.month, m.units, m.unlinkedSkus])).toEqual([
      ["2026-10", 0, ["CANDLE"]],
      ["2026-09", 4, []],
      ["2026-08", 5, []],
    ]);
  });

  it("needs stock lots to cost what sold", async () => {
    const preview = await scoped((tx) =>
      previewCogs(tx, { channelId, month: "2026-08", ...where }),
    );
    expect(preview.problems).toEqual([
      "Mug: 5 went out, but only 0 were in stock lots by the month's end. Add opening stock or record the delivery.",
    ]);
  });

  it("leaves out a product made to order: nothing waits for its stock", async () => {
    const mug = await scoped((tx) => getProduct(tx, mugId));
    if (!mug) throw new Error("no mug");
    const keep = { name: mug.name, sku: mug.sku, notes: mug.notes };
    await scoped((tx) => updateProduct(tx, { ...keep, id: mugId, tracksStock: false }));
    const preview = await scoped((tx) =>
      previewCogs(tx, { channelId, month: "2026-08", ...where }),
    );
    expect(preview.problems).toEqual([]);
    expect(preview.lines).toEqual([]);
    await scoped((tx) => updateProduct(tx, { ...keep, id: mugId, tracksStock: true }));
  });

  it("books opening stock against opening balance equity", async () => {
    await scoped((tx) =>
      addOpeningStock(tx, {
        ...ctx,
        productId: mugId,
        quantity: 4,
        unitCost: "2.00",
        date: "2026-07-31",
        notes: "Counted at the FBA warehouse",
        baseCurrency: "CAD",
      }),
    );
    await scoped((tx) =>
      addOpeningStock(tx, {
        ...ctx,
        productId: mugId,
        quantity: 10,
        unitCost: "3.00",
        date: "2026-08-15",
        notes: null,
        baseCurrency: "CAD",
      }),
    );
    expect(await balance("inventory")).toBe("38.0000");
    expect(await balance("opening_balance_equity")).toBe("-38.0000");
  });

  it("starts at the opening stock's month (or the first posted, if earlier)", async () => {
    const openingDay = await scoped((tx) => earliestOpeningStock(tx));
    expect(openingDay).toBe("2026-07-31");
    // Sales from before it (a marketplace's longer history) don't hold the months up.
    expect(cogsStartMonth({ openingDay, postedMonths: [] })).toBe("2026-07");
    expect(cogsStartMonth({ openingDay, postedMonths: ["2026-06", "2026-08"] })).toBe("2026-06");
    expect(cogsStartMonth({ openingDay: null, postedMonths: ["2026-09"] })).toBe("2026-09");
    expect(cogsStartMonth({ openingDay: null, postedMonths: [] })).toBeNull();
    // What's left to post: the finished months from the start on, oldest first.
    const toPost = await scoped((tx) =>
      cogsMonthsToPost(tx, { timezone: where.timezone, currentMonth: "2026-10" }),
    );
    expect(toPost.map((m) => m.month)).toEqual(["2026-08", "2026-09"]);
  });

  it("posts months in order, oldest stock first, and undoes newest first", async () => {
    const post = (month: string) =>
      scoped((tx) => postCogs(tx, { ...ctx, channelId, month, ...where, currentMonth: "2026-10" }));
    await expect(post("2026-09")).rejects.toThrow(/Post August 2026 on Amazon.ca first/);
    // A sale from before the start (the opening stock covers it) doesn't hold August up.
    const june = await scoped(async (tx) => {
      await upsertOrders(tx, {
        orgId,
        channelId,
        from: "2000-01-01",
        orders: [order("701-0", "2026-06-10T15:00:00Z")],
      });
      const [saved] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.externalId, "701-0"));
      await saveOrderItems(tx, { orgId, orderId: saved?.id ?? "", items: [item("MUG", 1)] });
      return saved?.id ?? "";
    });
    // August: 4 at 2.00 + 1 at 3.00.
    expect(await post("2026-08")).toMatchObject({ units: 5, cost: "11.0000" });
    await expect(post("2026-08")).rejects.toThrow(/already in the books/);
    expect(await post("2026-09")).toMatchObject({ units: 4, cost: "12.0000" });
    await owner.db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, june));
    await owner.db.delete(schema.orders).where(eq(schema.orders.id, june));
    await expect(post("2026-10")).rejects.toThrow(/once it's over/);
    expect(await balance("cost_of_goods_sold")).toBe("23.0000");
    expect(await balance("inventory")).toBe("15.0000");
    const lots = await scoped((tx) => listLots(tx));
    expect(lots.map((l) => [l.receivedOn, l.consumed, l.source])).toEqual([
      ["2026-07-31", 4, "opening"],
      ["2026-08-15", 5, "opening"],
    ]);

    // Stock already costed can't be removed; months undo newest first.
    await expect(
      scoped((tx) => removeOpeningStock(tx, { ...ctx, lotId: lots[0]?.id ?? "" })),
    ).rejects.toThrow(/Undo those months first/);
    const periods = await scoped((tx) => listCogsPeriods(tx));
    const [aug, sep] = periods;
    await expect(scoped((tx) => undoCogs(tx, { ...ctx, periodId: aug?.id ?? "" }))).rejects.toThrow(
      /Undo September 2026 first/,
    );
    await scoped((tx) => undoCogs(tx, { ...ctx, periodId: sep?.id ?? "" }));
    expect(await balance("cost_of_goods_sold")).toBe("11.0000");
    expect((await scoped((tx) => listLots(tx)))[1]?.consumed).toBe(1);
  });

  it("counts the ledger: returns come back as lots, losses net of units found are written off", async () => {
    const ledger = (date: string, sku: string, eventType: string, quantity: number, n: number) => ({
      date,
      sku,
      fnsku: null,
      asin: null,
      title: null,
      eventType: eventType as "Adjustments",
      referenceId: null,
      quantity,
      fulfillmentCenter: "YYZ4",
      disposition: "SELLABLE",
      reason: null,
      country: "CA",
      key: `${date}|${sku}|${eventType}|${n}`,
    });
    await scoped((tx) =>
      importLedgerEvents(tx, {
        orgId,
        channelId,
        events: [
          ledger("2026-09-12", "MUG", "CustomerReturns", 1, 1),
          ledger("2026-09-20", "MUG", "Adjustments", -2, 2),
          ledger("2026-09-25", "MUG-2PK", "Adjustments", 1, 3),
          ledger("2026-09-28", "MUG", "VendorReturns", -3, 4),
        ],
        through: "2026-09-20",
      }),
    );
    // In through the 20th only: September waits for the rest.
    const early = await scoped((tx) => previewCogs(tx, { channelId, month: "2026-09", ...where }));
    expect(early.problems[0]).toMatch(/in through 2026-09-20/);
    const again = await scoped((tx) =>
      importLedgerEvents(tx, {
        orgId,
        channelId,
        events: [ledger("2026-09-12", "MUG", "CustomerReturns", 1, 1)],
        through: "2026-09-30",
      }),
    );
    expect(again.added).toBe(0);

    const months = await scoped((tx) => salesByMonth(tx, { timezone: where.timezone }));
    expect(months.find((m) => m.month === "2026-09")).toMatchObject({ returned: 1, adjusted: -1 });
    const preview = await scoped((tx) =>
      previewCogs(tx, { channelId, month: "2026-09", ...where }),
    );
    // Sales 4 at 3.00; lost 2 (−2) but the 2-pack found counts 2 units (+2): net nothing lost.
    expect(preview).toMatchObject({
      problems: [],
      units: 4,
      cost: "12.0000",
      returned: 1,
      returnedCost: "3.0000",
      lost: 0,
      found: 0,
    });
    await scoped((tx) =>
      postCogs(tx, { ...ctx, channelId, month: "2026-09", ...where, currentMonth: "2026-10" }),
    );
    // August 11.00 + September 12.00 − 3.00 returned.
    expect(await balance("cost_of_goods_sold")).toBe("20.0000");
    expect(await balance("inventory")).toBe("18.0000");
    const lots = await scoped((tx) => listLots(tx));
    expect(lots.map((l) => [l.source, l.receivedOn, l.quantity, l.consumed])).toEqual([
      ["opening", "2026-07-31", 4, 4],
      ["opening", "2026-08-15", 10, 5],
      ["return", "2026-09-30", 1, 0],
    ]);

    // Undoing September removes its return lot too.
    const sep = (await scoped((tx) => listCogsPeriods(tx))).find((p) => p.month === "2026-09");
    await scoped((tx) => undoCogs(tx, { ...ctx, periodId: sep?.id ?? "" }));
    expect((await scoped((tx) => listLots(tx))).map((l) => l.source)).toEqual([
      "opening",
      "opening",
    ]);
  });

  it("writes off units lost at FIFO cost", async () => {
    await scoped((tx) =>
      importLedgerEvents(tx, {
        orgId,
        channelId,
        events: [
          {
            date: "2026-09-21",
            sku: "MUG",
            fnsku: null,
            asin: null,
            title: null,
            eventType: "Adjustments",
            referenceId: null,
            quantity: -2,
            fulfillmentCenter: "YYZ4",
            disposition: "SELLABLE",
            reason: "M",
            country: "CA",
            key: "lost-more",
          },
        ],
        through: "2026-09-30",
      }),
    );
    const preview = await scoped((tx) =>
      previewCogs(tx, { channelId, month: "2026-09", ...where }),
    );
    // In product units: −2 −2 +2 (the 2-pack found) = 2 lost, after 4 sold from the 9 left.
    expect(preview).toMatchObject({ problems: [], lost: 2, lostCost: "6.0000", found: 0 });
    await scoped((tx) =>
      postCogs(tx, { ...ctx, channelId, month: "2026-09", ...where, currentMonth: "2026-10" }),
    );
    expect(await balance("inventory_write_offs")).toBe("6.0000");
    expect(await balance("inventory")).toBe("12.0000");
  });

  it("adopts an existing account for a company set up before the system keys", async () => {
    const id = await scoped(async (tx) => {
      const inventory = await ensureSystemAccount(tx, orgId, "inventory");
      await tx
        .update(schema.accounts)
        .set({ systemKey: null })
        .where(eq(schema.accounts.id, inventory));
      return { before: inventory, after: await ensureSystemAccount(tx, orgId, "inventory") };
    });
    expect(id.after).toBe(id.before);
  });

  it("leaves out a disconnected account's and a switched-off marketplace's months, but not posted ones", async () => {
    // Another company's marketplace connected here by mistake: an unlinked July sale on it
    // would hold up every month after it.
    const aeChannelId = await scoped(async (tx) => {
      const connection = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "amazon_sp",
        name: "Amazon Europe",
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
      const [ae] = await tx
        .select()
        .from(schema.salesChannels)
        .where(eq(schema.salesChannels.connectionId, connection.id));
      const aeId = ae?.id ?? "";
      await upsertOrders(tx, {
        orgId,
        channelId: aeId,
        from: "2000-01-01",
        orders: [{ ...order("406-1", "2026-07-10T15:00:00Z"), marketplaceId: "A2VIGQ35RCS4UG" }],
      });
      const [saved] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.channelId, aeId));
      await saveOrderItems(tx, { orgId, orderId: saved?.id ?? "", items: [item("AE-LAMP", 2)] });
      return { aeId, connectionId: connection.id };
    });
    const channels = async () =>
      (await scoped((tx) => salesByMonth(tx, { timezone: where.timezone }))).map(
        (m) => `${m.channelName} ${m.month}`,
      );
    expect(await channels()).toContain("Amazon.ae 2026-07");

    await scoped((tx) => disconnectAmazon(tx, aeChannelId.connectionId));
    expect((await channels()).some((c) => c.startsWith("Amazon.ae"))).toBe(false);
    expect(await scoped((tx) => channelsNotCosted(tx, { timezone: where.timezone }))).toEqual([
      "Amazon.ae",
    ]);

    // Switched off, a marketplace keeps only the months already in the books.
    const posted = (await scoped((tx) => listCogsPeriods(tx)))
      .filter((p) => p.channelId === channelId)
      .map((p) => `Amazon.ca ${p.month}`);
    expect(posted.length).toBeGreaterThan(0);
    await scoped((tx) => setChannelActive(tx, channelId, false));
    expect((await channels()).sort()).toEqual(posted.sort());
    await scoped((tx) => setChannelActive(tx, channelId, true));
    expect(await channels()).toContain("Amazon.ca 2026-10");
  });

  it("keeps each company's months and lots to itself", async () => {
    expect(await scoped((tx) => listCogsPeriods(tx), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => listLots(tx), otherOrgId)).toEqual([]);
  });
});

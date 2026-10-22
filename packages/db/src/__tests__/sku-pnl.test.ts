import {
  type AmazonOrder,
  type AmazonOrderItem,
  parseNoonTransactions,
  type Settlement,
} from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { salesAfter } from "../ads";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { addNoonChannel, saveAmazonChannels, saveOrderItems, upsertOrders } from "../commerce";
import { fxRatesForDays } from "../fx";
import { createProduct } from "../inventory";
import { importNoonTransactions } from "../noon-transactions";
import * as schema from "../schema";
import {
  reportsWithoutSkuDetail,
  saveSettlement,
  saveSettlementSkuLines,
  settledSkuLinesForProfit,
  settlementByExternalId,
  settlementsWithoutSkuDetail,
} from "../settlements";
import { amazonSkuRows, noonSkuMoneyRows, postedUnitCosts, skuOrderLines } from "../sku-pnl";

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
let noonId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);
const range = { from: "2026-09-01", to: "2026-09-30", timezone: "America/Toronto" };

// Synthetic data only.
const order = (id: string, purchasedAt: string, status = "Shipped"): AmazonOrder => ({
  orderId: id,
  marketplaceId: "A2EUQ1WTGCTBG2",
  purchasedAt,
  lastUpdatedAt: purchasedAt,
  status,
  fulfillment: "amazon",
  currency: "CAD",
  total: "60.00",
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
const item = (sku: string, quantity: number, price: string): AmazonOrderItem => ({
  itemId: `${sku}-${quantity}`,
  asin: "B0MUG",
  sku,
  title: sku,
  quantityOrdered: quantity,
  quantityShipped: quantity,
  itemPrice: price,
  itemTax: null,
  shippingPrice: null,
  shippingTax: null,
  promotionDiscount: null,
});
const skuLine = (
  orderId: string | null,
  sku: string | null,
  amountDescription: string,
  amount: string,
  postedDate = "2026-09-05",
) => ({
  orderId,
  sku,
  postedDate,
  transactionType: orderId ? "Order" : "ServiceFee",
  amountType: orderId
    ? amountDescription === "Principal"
      ? "ItemPrice"
      : "ItemFees"
    : "other-transaction",
  amountDescription,
  amount,
  quantity: amountDescription === "Principal" ? 1 : 0,
  count: 1,
});
const settlement = (id: string, skuLines?: Settlement["skuLines"]): Settlement => ({
  settlementId: id,
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2026-09-15T00:00:00.000Z",
  depositDate: "2026-09-17",
  total: "10.00",
  currency: "CAD",
  marketplace: "Amazon.ca",
  lines: [
    {
      transactionType: "Order",
      amountType: "ItemPrice",
      amountDescription: "Principal",
      amount: "10.00",
      count: 1,
    },
  ],
  ...(skuLines ? { skuLines } : {}),
  orderCount: 1,
  balanced: true,
});

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([
      { code: "CAD", name: "Canadian Dollar", minorUnits: 2 },
      { code: "AED", name: "UAE Dirham", minorUnits: 2 },
      { code: "USD", name: "US Dollar", minorUnits: 2 },
    ])
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "SKU P&L Org", slug: "sku-pnl-org", createdAt: new Date() },
      { name: "Other SKU P&L Org", slug: "other-sku-pnl-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    const sp = await createConnection(tx, {
      orgId,
      provider: "amazon_sp",
      name: "Amazon",
      settings: { region: "na" },
    });
    await saveAmazonChannels(tx, {
      orgId,
      connectionId: sp.id,
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
    await upsertOrders(tx, {
      orgId,
      channelId,
      from: "2000-01-01",
      orders: [
        order("702-1", "2026-09-03T15:00:00Z"),
        order("702-2", "2026-08-20T15:00:00Z"),
        order("702-3", "2026-09-04T15:00:00Z", "Canceled"),
      ],
    });
    const saved = await tx.select().from(schema.orders);
    const id = (ext: string) => saved.find((o) => o.externalId === ext)?.id ?? "";
    await saveOrderItems(tx, {
      orgId,
      orderId: id("702-1"),
      items: [item("MUG-1", 2, "40.00"), item("CUP-2", 1, "20.00")],
    });
    await saveOrderItems(tx, { orgId, orderId: id("702-2"), items: [item("MUG-1", 1, "20.00")] });
    await saveOrderItems(tx, { orgId, orderId: id("702-3"), items: [item("MUG-1", 1, "20.00")] });
    await tx
      .update(schema.orders)
      .set({ refunded: "30.00" })
      .where(eq(schema.orders.id, id("702-1")));
    noonId =
      (
        await addNoonChannel(tx, {
          orgId,
          marketplace: { id: "noon-ae", name: "Noon UAE", country: "AE", currency: "AED" },
          fulfilment: "marketplace",
        })
      ).channel?.id ?? "";
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("settlement amounts by order and SKU", () => {
  it("keeps them when a settlement comes in, and marks it as having them", async () => {
    await scoped((tx) =>
      saveSettlement(tx, {
        orgId,
        connectionId: null,
        channelId,
        reportId: "R1",
        source: "amazon",
        settlement: settlement("S1", [
          skuLine("702-1", "MUG-1", "Principal", "40.00"),
          skuLine("702-1", "MUG-1", "Commission", "-6.00"),
          skuLine("702-2", "MUG-1", "Commission", "-3.00"),
          skuLine("702-9", "LOST-1", "Principal", "15.00"),
          skuLine(null, null, "Subscription Fee", "-7.50", "2026-09-10"),
          skuLine(null, null, "Storage Fee", "-2.00", "2026-10-02"),
        ]),
      }),
    );
    const found = await scoped((tx) => settlementByExternalId(tx, "S1"));
    expect(found?.skuDetailAt).toBeInstanceOf(Date);
    expect(await scoped((tx) => reportsWithoutSkuDetail(tx))).toEqual(new Set());
  });

  it("reads them for the period's orders, and amounts on no order the company has by their day", async () => {
    const rows = await scoped((tx) => amazonSkuRows(tx, range));
    const seen = rows.map((r) => [r.orderRef, r.sku, r.kind, r.amount]).sort();
    expect(seen).toEqual(
      [
        ["702-1", "MUG-1", "sales", "40.0000"],
        ["702-1", "MUG-1", "referral", "-6.0000"],
        // An order Bookalyze doesn't have: dated by its rows.
        ["702-9", "LOST-1", "sales", "15.0000"],
        [null, null, "otherFees", "-7.5000"],
      ].sort(),
    );
    // 702-2 was bought in August: its fee counts there. October's storage counts in October.
    expect(rows.every((r) => r.channelId === channelId)).toBe(true);
  });

  it("a settlement brought in before is filled without changing it, and counted until it is", async () => {
    await scoped((tx) =>
      saveSettlement(tx, {
        orgId,
        connectionId: null,
        channelId,
        reportId: "R2",
        source: "amazon",
        settlement: settlement("S2"),
      }),
    );
    expect(await scoped((tx) => reportsWithoutSkuDetail(tx))).toEqual(new Set(["R2"]));
    expect(
      (await scoped((tx) => settlementsWithoutSkuDetail(tx, range))).map((s) => s.externalId),
    ).toEqual(["S2"]);
    const s2 = await scoped((tx) => settlementByExternalId(tx, "S2"));
    await scoped((tx) =>
      saveSettlementSkuLines(tx, {
        orgId,
        settlementId: s2?.id ?? "",
        lines: [skuLine("702-1", "CUP-2", "Principal", "20.00")],
        replace: true,
        complete: false,
      }),
    );
    // Part of an upload: not complete yet.
    expect(await scoped((tx) => settlementsWithoutSkuDetail(tx, range))).toHaveLength(1);
    await scoped((tx) =>
      saveSettlementSkuLines(tx, {
        orgId,
        settlementId: s2?.id ?? "",
        lines: [skuLine("702-1", "CUP-2", "Commission", "-3.00")],
        replace: false,
        complete: true,
      }),
    );
    expect(await scoped((tx) => settlementsWithoutSkuDetail(tx, range))).toEqual([]);
    const cup = (await scoped((tx) => amazonSkuRows(tx, range))).filter((r) => r.sku === "CUP-2");
    expect(cup.map((r) => r.amount).sort()).toEqual(["-3.0000", "20.0000"]);
    const [stored] = await scoped((tx) =>
      tx.select().from(schema.settlements).where(eq(schema.settlements.externalId, "S2")),
    );
    expect(stored?.total).toBe("10.0000");
  });

  it("keeps each company's to itself", async () => {
    expect(await scoped((tx) => tx.select().from(schema.settlementSkuLines), otherOrgId)).toEqual(
      [],
    );
    const s1 = await scoped((tx) => settlementByExternalId(tx, "S1"));
    await expect(
      scoped(
        (tx) =>
          tx.insert(schema.settlementSkuLines).values({
            organizationId: orgId,
            settlementId: s1?.id ?? "",
            transactionType: "Order",
            amountType: "ItemPrice",
            amountDescription: "Principal",
            amount: "1",
          }),
        otherOrgId,
      ),
    ).rejects.toThrow();
  });
});

describe("order lines", () => {
  it("shares the order's refund by item price, and leaves cancelled orders out", async () => {
    const lines = await scoped((tx) => skuOrderLines(tx, range));
    expect(lines.map((l) => [l.orderRef, l.sku, l.units, l.gross, l.refunded]).sort()).toEqual(
      [
        ["702-1", "CUP-2", 1, "20.0000", "10.0000"],
        ["702-1", "MUG-1", 2, "40.0000", "20.0000"],
      ].sort(),
    );
  });
});

describe("Noon rows by SKU", () => {
  it("reads each transaction row's columns, by partner SKU", async () => {
    const parsed = parseNoonTransactions(
      [
        "Contract,Contract Title,Reference Nr,Order Nr,Item Nr,Order Date,Transaction Date,Title,SKUs,Partner SKUs,Transaction Type,Currency,Net Proceeds,Referral Fee including VAT,Fullfilment & Logistics Fees including VAT,Shipping Credits including VAT,Other Order Fees including VAT,Order Subsidies including VAT,Non-Order Fees including VAT,Non-Order Subsidies including VAT,Others including VAT,Total",
        "C1,Noon AE,REF-1,NAE001,ITEM-1,2026-09-01,2026-09-02,Maple mug,Z1,MUG-1,order,AED,100.00,-8.40,-6.30,0,0,0,0,0,0,85.30",
        "C1,Noon AE,PS-1,,,,2026-09-09,Advertising Fee,,,statement_fee,AED,0,0,0,0,0,0,-30.00,0,0,-30.00",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    await scoped((tx) =>
      importNoonTransactions(tx, {
        orgId,
        rows: parsed.rows,
        source: "upload",
        connectionId: null,
      }),
    );
    const rows = await scoped((tx) => noonSkuMoneyRows(tx, { ...range, timezone: "Asia/Dubai" }));
    expect(rows.every((r) => r.channelId === noonId)).toBe(true);
    expect(rows.map((r) => [r.orderRef, r.sku, r.kind, r.amount]).sort()).toEqual(
      [
        ["NAE001", "MUG-1", "sales", "100.0000"],
        ["NAE001", "MUG-1", "referral", "-8.4000"],
        ["NAE001", "MUG-1", "fulfilment", "-6.3000"],
        [null, null, "advertising", "-30.0000"],
      ].sort(),
    );
  });
});

describe("posted unit costs", () => {
  it("is what a month's sales consumptions cost per unit, by product", async () => {
    await scoped(async (tx) => {
      const product = await createProduct(tx, {
        orgId,
        userId: null,
        name: "Maple mug",
        sku: null,
        notes: null,
      });
      const [lot] = await tx
        .insert(schema.inventoryLots)
        .values({
          organizationId: orgId,
          productId: product.id,
          source: "opening",
          receivedOn: "2026-08-01",
          quantity: 10,
          currency: "CAD",
          productCost: "40.00",
          landedCost: "10.00",
        })
        .returning();
      const [period] = await tx
        .insert(schema.cogsPeriods)
        .values({
          organizationId: orgId,
          channelId,
          month: "2026-09",
          units: 3,
          cost: "15.00",
          currency: "CAD",
        })
        .returning();
      await tx.insert(schema.lotConsumptions).values({
        organizationId: orgId,
        cogsPeriodId: period?.id ?? "",
        lotId: lot?.id ?? "",
        kind: "sale",
        quantity: 3,
        cost: "15.00",
      });
      const costs = await postedUnitCosts(tx, { fromMonth: "2026-09", toMonth: "2026-09" });
      expect(costs.get(channelId)?.get("2026-09")?.get(product.id)).toBe("5.0000");
    });
  });
});

describe("rates for each day", () => {
  it("carries the last published rate over weekends, within a week", async () => {
    await owner.db
      .insert(schema.fxRates)
      .values([
        { date: "2026-09-04", base: "CAD", quote: "USD", rate: "1.3700000000", source: "Test" },
        { date: "2026-09-08", base: "CAD", quote: "USD", rate: "1.3800000000", source: "Test" },
      ])
      .onConflictDoNothing();
    const rates = await fxRatesForDays(app.db, {
      base: "CAD",
      quote: "USD",
      from: "2026-09-04",
      to: "2026-09-08",
    });
    expect(Object.fromEntries(rates)).toEqual({
      "2026-09-04": "1.3700000000",
      "2026-09-05": "1.3700000000",
      "2026-09-06": "1.3700000000",
      "2026-09-07": "1.3700000000",
      "2026-09-08": "1.3800000000",
    });
  });
});

describe("what Profit by product's keep rates learn from", () => {
  it("reads each SKU's settled amounts on orders, summed by kind, never the account's own", async () => {
    const lines = await scoped((tx) => settledSkuLinesForProfit(tx, range));
    expect(lines.every((l) => l.channelId === channelId && l.sku)).toBe(true);
    const mug = lines
      .filter((l) => l.sku === "MUG-1")
      .map((l) => [l.amountDescription, l.amount, l.quantity])
      .sort();
    // Both orders' referral fees in one line; the subscription and storage (no order) left out.
    expect(mug).toEqual([
      ["Commission", "-9.0000", 0],
      ["Principal", "40.0000", 1],
    ]);
    expect(lines.some((l) => /subscription|storage/i.test(l.amountDescription))).toBe(false);
    // Settlements ending outside the period aren't read.
    expect(
      await scoped((tx) =>
        settledSkuLinesForProfit(tx, { ...range, from: "2026-10-01", to: "2026-10-31" }),
      ),
    ).toEqual([]);
  });

  it("keeps each company's to itself", async () => {
    expect(await scoped((tx) => settledSkuLinesForProfit(tx, range), otherOrgId)).toEqual([]);
  });

  it("adds up the sales bought after the last settled day (cancelled orders left out)", async () => {
    const sold = (day: string) =>
      scoped((tx) =>
        salesAfter(tx, { channelId, after: day, to: range.to, timezone: range.timezone }),
      );
    // 702-1 (Sep 3 in Toronto): 40 + 20; 702-3 is cancelled.
    expect(await sold("2026-09-02")).toBe("60.0000");
    expect(await sold("2026-09-03")).toBe("0");
  });
});

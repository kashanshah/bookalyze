import { parseNoonTransactions } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { salesByMonth } from "../cogs";
import { addNoonChannel, listOrders } from "../commerce";
import { importNoonTransactions } from "../noon-transactions";
import { reviewCandidates } from "../reviews";
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
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

// Noon's header; synthetic rows: an order of two items, one returned later, and a fee.
const HEADER =
  "Contract,Contract Title,Reference Nr,Order Nr,Item Nr,Order Date,Transaction Date,Title,SKUs,Partner SKUs,Transaction Type,Currency,Net Proceeds,Referral Fee including VAT,Fullfilment & Logistics Fees including VAT,Shipping Credits including VAT,Other Order Fees including VAT,Order Subsidies including VAT,Non-Order Fees including VAT,Non-Order Subsidies including VAT,Others including VAT,Total";
const SOLD = [
  "C1,Noon AE,REF-1,NAE001,ITEM-1,2026-09-01,2026-09-02,Maple mug,Z1,MUG-1,order,AED,100.00,-8.40,-6.30,0,0,0,0,0,0,85.30",
  "C1,Noon AE,REF-2,NAE001,ITEM-2,2026-09-01,2026-09-02,Maple mug,Z1,MUG-1,order,AED,100.00,-8.40,-6.30,0,0,0,0,0,0,85.30",
  "C1,Noon AE,PS-1,,,,2026-09-09,Advertising Fee,,,statement_fee,AED,0,0,0,0,0,0,-30.00,0,0,-30.00",
];
const RETURNED =
  "C1,Noon AE,REF-1,NAE001,ITEM-1,2026-09-01,2026-09-20,,Z1,MUG-1,order_update,AED,-100.00,8.40,0,0,0,0,0,0,0,-91.60";

const bring = (lines: string[]) => {
  const parsed = parseNoonTransactions([HEADER, ...lines].join("\n"));
  if (!parsed.ok) throw new Error(parsed.error);
  return scoped((tx) =>
    importNoonTransactions(tx, { orgId, rows: parsed.rows, source: "upload", connectionId: null }),
  );
};

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Noon Orders Org", slug: "noon-orders-org", createdAt: new Date() },
      { name: "Other Noon Orders Org", slug: "other-noon-orders-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped((tx) =>
    addNoonChannel(tx, {
      orgId,
      marketplace: { id: "noon-ae", name: "Noon UAE", country: "AE", currency: "AED" },
      fulfilment: "marketplace",
    }),
  );
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("Noon orders", () => {
  it("makes an order from Noon's rows, an item per unit, shipped by Noon", async () => {
    await bring(SOLD);
    const list = await scoped((tx) =>
      listOrders(tx, { timezone: "Asia/Dubai", limit: 10, offset: 0 }),
    );
    expect(list.rows.map((o) => [o.externalId, o.channelKind, o.status, o.total])).toEqual([
      ["NAE001", "noon", "Shipped", "200.0000"],
    ]);
    const [order] = await scoped((tx) => tx.select().from(schema.orders));
    expect(order).toMatchObject({
      fulfillment: "amazon",
      itemsShipped: 2,
      refunded: null,
      currency: "AED",
    });
    expect(order?.itemsSyncedAt).not.toBeNull();
    const items = await scoped((tx) =>
      tx.select().from(schema.orderItems).orderBy(schema.orderItems.externalId),
    );
    expect(items.map((i) => [i.externalId, i.sku, i.quantityShipped, i.itemPrice])).toEqual([
      ["ITEM-1", "MUG-1", 1, "100.0000"],
      ["ITEM-2", "MUG-1", 1, "100.0000"],
    ]);
  });

  it("keeps one order when rows come in again, with a return as its refund", async () => {
    await bring([...SOLD, RETURNED]);
    const orders = await scoped((tx) => tx.select().from(schema.orders));
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ refunded: "100.0000", total: "200.0000" });
    expect(await scoped((tx) => tx.select().from(schema.orderItems))).toHaveLength(2);
  });

  it("leaves Noon orders out of Amazon's review requests", async () => {
    expect(
      await scoped((tx) =>
        reviewCandidates(tx, { today: "2026-09-10", needsItems: false, limit: 10 }),
      ),
    ).toEqual([]);
  });

  it("counts Noon's units sold for cost of goods sold, by order month", async () => {
    const months = await scoped((tx) => salesByMonth(tx, { timezone: "Asia/Dubai" }));
    expect(months.map((m) => [m.channelName, m.month, m.unlinkedUnits, m.unlinkedSkus])).toEqual([
      ["Noon UAE", "2026-09", 2, ["MUG-1"]],
    ]);
  });

  it("keeps each company's Noon orders to itself", async () => {
    expect(await scoped((tx) => tx.select().from(schema.orders), otherOrgId)).toEqual([]);
  });
});

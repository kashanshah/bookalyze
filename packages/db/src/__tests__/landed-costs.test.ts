import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createProduct } from "../inventory";
import {
  deliveryCostSummary,
  getDeliveryCosting,
  listLots,
  saveDeliveryCosts,
} from "../landed-costs";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
} from "../purchasing";
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
let supplierId: string;
let mugId: string;
let lampId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

/** A sent USD order for 100 mugs at 2.00 and 10 lamps at 20.00, received in full. */
async function receivedOrder(rate: string | null) {
  const { id } = await scoped((tx) =>
    createPurchaseOrder(tx, {
      orgId,
      userId: null,
      supplierId,
      currency: "USD",
      orderDate: "2026-09-01",
      expectedDate: null,
      reference: null,
      notes: null,
      lines: [
        { productId: mugId, quantity: 100, unitCost: "2.0000" },
        { productId: lampId, quantity: 10, unitCost: "20.0000" },
      ],
    }),
  );
  await scoped((tx) => markPurchaseOrderOrdered(tx, id));
  const lines = (await scoped((tx) => getPurchaseOrder(tx, id)))?.lines ?? [];
  const receive = () =>
    scoped((tx) =>
      receivePurchaseOrder(tx, {
        orgId,
        id,
        baseCurrency: "CAD",
        exchangeRate: rate,
        receivedOn: "2026-09-10",
        notes: null,
        quantities: Object.fromEntries(lines.map((line) => [line.id, line.quantity])),
      }),
    );
  return { id, receive };
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([
      { code: "CAD", name: "Canadian Dollar", minorUnits: 2 },
      { code: "USD", name: "US Dollar", minorUnits: 2 },
    ])
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Landed Org", slug: "landed-org", createdAt: new Date() },
      { name: "Other Landed Org", slug: "other-landed-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    const [vendor] = await tx
      .insert(schema.contacts)
      .values({ organizationId: orgId, type: "vendor", name: "Shenzhen Lights" })
      .returning({ id: schema.contacts.id });
    supplierId = vendor?.id ?? "";
    mugId = (
      await createProduct(tx, {
        orgId,
        userId: null,
        name: "Mug",
        sku: null,
        notes: null,
        unitWeight: "0.5",
      })
    ).id;
    lampId = (
      await createProduct(tx, {
        orgId,
        userId: null,
        name: "Lamp",
        sku: null,
        notes: null,
        unitWeight: "2",
      })
    ).id;
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("landed costs and lots", () => {
  it("needs the exchange rate for a foreign-currency order", async () => {
    const { receive } = await receivedOrder(null);
    await expect(receive()).rejects.toThrow(/USD to CAD exchange rate/);
  });

  it("makes one lot per line at the PO cost, then adds extra costs to them", async () => {
    const { id, receive } = await receivedOrder("1.4");
    const { receiptId } = await receive();
    const lots = (await scoped((tx) => listLots(tx))).filter((lot) => lot.purchaseOrderId === id);
    // 100 × 2.00 × 1.4 = 280.00 CAD; 10 × 20.00 × 1.4 = 280.00 CAD.
    expect(lots.map((lot) => [lot.productName, lot.quantity, lot.productCost])).toEqual([
      ["Lamp", 10, "280.0000"],
      ["Mug", 100, "280.0000"],
    ]);
    const lotIds = lots.map((lot) => lot.id);

    // Freight 70 CAD by weight (mugs 50 kg, lamps 20 kg); duty 40 USD by value (half each).
    const costing = await scoped((tx) =>
      saveDeliveryCosts(tx, {
        orgId,
        receiptId,
        baseCurrency: "CAD",
        exchangeRate: "1.4",
        costs: [
          {
            kind: "freight",
            description: "Sea freight",
            amount: "70",
            currency: "CAD",
            exchangeRate: null,
            allocation: "weight",
          },
          {
            kind: "duty",
            description: null,
            amount: "40",
            currency: "USD",
            exchangeRate: "1.4",
            allocation: "value",
          },
        ],
      }),
    );
    expect(costing.landedCost).toBe("126.0000");
    const after = (await scoped((tx) => listLots(tx))).filter((lot) => lot.purchaseOrderId === id);
    expect(after.map((lot) => [lot.productName, lot.landedCost])).toEqual([
      ["Lamp", "48.0000"],
      ["Mug", "78.0000"],
    ]);
    // Rebuilt in place: same lots.
    expect(after.map((lot) => lot.id)).toEqual(lotIds);

    const detail = await scoped((tx) => getDeliveryCosting(tx, receiptId));
    expect(detail?.costed).toBe(true);
    expect(detail?.costs.map((cost) => cost.kind)).toEqual(["freight", "duty"]);
    const summary = await scoped((tx) => deliveryCostSummary(tx, [receiptId]));
    expect(summary.get(receiptId)).toEqual({
      landedCost: "126.0000",
      totalCost: "686.0000",
      currency: "CAD",
    });

    // A rate change re-costs the products too.
    await scoped((tx) =>
      saveDeliveryCosts(tx, {
        orgId,
        receiptId,
        baseCurrency: "CAD",
        exchangeRate: "1.5",
        costs: [],
      }),
    );
    expect((await scoped((tx) => deliveryCostSummary(tx, [receiptId]))).get(receiptId)).toEqual({
      landedCost: "0.0000",
      totalCost: "600.0000",
      currency: "CAD",
    });
  });

  it("refuses a weight split when a product has no weight", async () => {
    await scoped((tx) =>
      tx.update(schema.products).set({ unitWeight: null }).where(eq(schema.products.id, lampId)),
    );
    const { receive } = await receivedOrder("1.4");
    const { receiptId } = await receive();
    await expect(
      scoped((tx) =>
        saveDeliveryCosts(tx, {
          orgId,
          receiptId,
          baseCurrency: "CAD",
          exchangeRate: "1.4",
          costs: [
            {
              kind: "freight",
              description: null,
              amount: "10",
              currency: "CAD",
              exchangeRate: null,
              allocation: "weight",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/Add a weight to Lamp/);
  });

  it("keeps each company's lots to itself", async () => {
    expect(await scoped((tx) => listLots(tx), otherOrgId)).toEqual([]);
  });
});

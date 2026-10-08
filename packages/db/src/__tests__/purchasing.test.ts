import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createProduct } from "../inventory";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  markPurchaseOrderOrdered,
  PurchasingError,
  receivePurchaseOrder,
  supplierOptions,
  unitsOnOrder,
  updatePurchaseOrder,
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
let customerId: string;
let mugId: string;
let candleId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

const draft = (overrides: Partial<Parameters<typeof createPurchaseOrder>[1]> = {}) => ({
  orgId,
  userId: null,
  supplierId,
  currency: "USD",
  orderDate: "2026-09-01",
  expectedDate: "2026-09-20",
  reference: "PI-889",
  notes: null,
  lines: [
    { productId: mugId, quantity: 100, unitCost: "2.4500" },
    { productId: candleId, quantity: 3, unitCost: "0.3333" },
  ],
  ...overrides,
});

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
      { name: "Purchasing Org", slug: "purchasing-org", createdAt: new Date() },
      { name: "Other Purchasing Org", slug: "other-purchasing-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    const contacts = await tx
      .insert(schema.contacts)
      .values([
        { organizationId: orgId, type: "vendor", name: "Ningbo Ceramics" },
        { organizationId: orgId, type: "customer", name: "A buyer" },
      ])
      .returning({ id: schema.contacts.id });
    supplierId = contacts[0]?.id ?? "";
    customerId = contacts[1]?.id ?? "";
    mugId = (await createProduct(tx, { orgId, userId: null, name: "Mug", sku: "MUG", notes: null }))
      .id;
    candleId = (
      await createProduct(tx, { orgId, userId: null, name: "Candle", sku: null, notes: null })
    ).id;
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("purchase orders", () => {
  it("numbers drafts, totals them exactly and edits only drafts", async () => {
    const first = await scoped((tx) => createPurchaseOrder(tx, draft()));
    const second = await scoped((tx) => createPurchaseOrder(tx, draft({ reference: null })));
    expect(second.number).toBe(first.number + 1);

    const po = await scoped((tx) => getPurchaseOrder(tx, first.id));
    expect(po?.status).toBe("draft");
    expect(po?.supplierName).toBe("Ningbo Ceramics");
    // 100 × 2.45 + 3 × 0.3333 (= 0.9999, rounded to 1.00)
    expect(po?.lines.map((line) => line.total)).toEqual(["245.0000", "1.0000"]);
    expect(po?.total).toBe("246.0000");

    await scoped((tx) =>
      updatePurchaseOrder(tx, {
        ...draft({ lines: [{ productId: mugId, quantity: 10, unitCost: "3.0000" }] }),
        id: first.id,
      }),
    );
    expect((await scoped((tx) => getPurchaseOrder(tx, first.id)))?.total).toBe("30.0000");

    const listed = await scoped((tx) => listPurchaseOrders(tx, { search: `PO-${first.number}` }));
    expect(listed.map((row) => row.id)).toEqual([first.id]);
    expect((await scoped((tx) => listPurchaseOrders(tx, { search: "ningbo" }))).length).toBe(2);

    await scoped((tx) => deletePurchaseOrder(tx, second.id));
    expect(await scoped((tx) => getPurchaseOrder(tx, second.id))).toBeNull();
  });

  it("refuses a customer as supplier and an empty order", async () => {
    await expect(
      scoped((tx) => createPurchaseOrder(tx, draft({ supplierId: customerId }))),
    ).rejects.toThrow(/vendors/);
    await expect(scoped((tx) => createPurchaseOrder(tx, draft({ lines: [] })))).rejects.toThrow(
      /at least one product/,
    );
    expect((await scoped((tx) => supplierOptions(tx))).map((s) => s.id)).toEqual([supplierId]);
  });

  it("receives deliveries in parts, then in full, and never more than ordered", async () => {
    const { id } = await scoped((tx) => createPurchaseOrder(tx, draft()));
    const lineIds = (await scoped((tx) => getPurchaseOrder(tx, id)))?.lines.map((l) => l.id) ?? [];
    const [mugLine = "", candleLine = ""] = lineIds;

    // A draft can't be received yet.
    await expect(
      scoped((tx) =>
        receivePurchaseOrder(tx, {
          orgId,
          id,
          receivedOn: "2026-09-10",
          notes: null,
          quantities: { [mugLine]: 1 },
        }),
      ),
    ).rejects.toThrow(/Mark the order as sent/);
    await scoped((tx) => markPurchaseOrderOrdered(tx, id));
    await expect(scoped((tx) => updatePurchaseOrder(tx, { ...draft(), id }))).rejects.toThrow(
      /Only a draft/,
    );
    expect((await scoped((tx) => unitsOnOrder(tx))).get(mugId)).toBeGreaterThanOrEqual(100);

    const part = await scoped((tx) =>
      receivePurchaseOrder(tx, {
        orgId,
        id,
        receivedOn: "2026-09-15",
        notes: "First pallet",
        quantities: { [mugLine]: 60 },
      }),
    );
    expect(part.status).toBe("partial");

    const over = await scoped((tx) =>
      receivePurchaseOrder(tx, {
        orgId,
        id,
        receivedOn: "2026-09-16",
        notes: null,
        quantities: { [mugLine]: 41 },
      }),
    ).catch((error: unknown) => error);
    expect(over).toBeInstanceOf(PurchasingError);
    expect((over as PurchasingError).lineErrors[mugLine]).toBe("Only 40 still to come.");
    await expect(
      scoped((tx) =>
        receivePurchaseOrder(tx, {
          orgId,
          id,
          receivedOn: "2026-08-01",
          notes: null,
          quantities: { [mugLine]: 1 },
        }),
      ),
    ).rejects.toThrow(/before the order date/);

    const rest = await scoped((tx) =>
      receivePurchaseOrder(tx, {
        orgId,
        id,
        receivedOn: "2026-09-20",
        notes: null,
        quantities: { [mugLine]: 40, [candleLine]: 3 },
      }),
    );
    expect(rest.status).toBe("received");
    const po = await scoped((tx) => getPurchaseOrder(tx, id));
    expect(po?.lines.map((line) => line.received)).toEqual([100, 3]);
    expect(po?.receipts).toHaveLength(2);
    expect(po?.receipts[0]?.receivedOn).toBe("2026-09-20");
    await expect(scoped((tx) => cancelPurchaseOrder(tx, id))).rejects.toThrow(/can't be cancelled/);
  });

  it("cancels an order nothing has arrived for", async () => {
    const { id } = await scoped((tx) => createPurchaseOrder(tx, draft()));
    await scoped((tx) => markPurchaseOrderOrdered(tx, id));
    await scoped((tx) => cancelPurchaseOrder(tx, id));
    expect((await scoped((tx) => getPurchaseOrder(tx, id)))?.status).toBe("cancelled");
    await expect(scoped((tx) => deletePurchaseOrder(tx, id))).rejects.toThrow(/Only a draft/);
  });

  it("keeps each company's purchase orders to itself", async () => {
    const { id } = await scoped((tx) => createPurchaseOrder(tx, draft()));
    expect(await scoped((tx) => getPurchaseOrder(tx, id), otherOrgId)).toBeNull();
    expect(await scoped((tx) => listPurchaseOrders(tx), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => supplierOptions(tx), otherOrgId)).toEqual([]);
    // Another company can't order from this company's supplier.
    await expect(
      scoped((tx) => createPurchaseOrder(tx, { ...draft(), orgId: otherOrgId }), otherOrgId),
    ).rejects.toThrow();
  });
});

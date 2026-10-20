import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { addOpeningStock, ensureSystemAccount, removeOpeningStock } from "../cogs";
import { createProduct } from "../inventory";
import { listLots } from "../landed-costs";
import { accountBalances, createDefaultChart } from "../ledger";
import * as schema from "../schema";
import { moveStock, putBackInStock, stockRemovalsFor, takeOutOfStock } from "../stock-removals";

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
let lotId: string;
let drawingsId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);
const base = { userId: null, baseCurrency: "CAD" };
const balance = async (accountId: string) =>
  (await scoped((tx) => accountBalances(tx, {}))).find((r) => r.accountId === accountId)?.balance ??
  "0";

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Removals Org", slug: "removals-org", createdAt: new Date() },
      { name: "Other Removals Org", slug: "other-removals-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    await createDefaultChart(tx, { orgId, baseCurrency: "CAD" });
    const mug = await createProduct(tx, {
      orgId,
      userId: null,
      name: "Mug",
      sku: null,
      notes: null,
    });
    lotId = (
      await addOpeningStock(tx, {
        ...base,
        orgId,
        productId: mug.id,
        quantity: 3,
        unitCost: "3.3333",
        date: "2026-01-31",
        notes: null,
      })
    ).id;
    const [drawings] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.code, "3100"));
    drawingsId = drawings?.id ?? "";
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("taking units out of stock by hand", () => {
  it("takes them from the lot at its cost, and the last one takes what's left", async () => {
    const inventory = await scoped((tx) => ensureSystemAccount(tx, orgId, "inventory"));
    // The lot: 3 at 3.3333 = 10.00 (rounded to cents).
    expect(await balance(inventory)).toBe("10.0000");
    const first = await scoped((tx) =>
      takeOutOfStock(tx, {
        ...base,
        orgId,
        lotId,
        quantity: 2,
        date: "2026-03-15",
        accountId: drawingsId,
        notes: "Sold at cost outside Amazon",
      }),
    );
    expect(first.cost).toBe("6.6700");
    expect((await scoped((tx) => listLots(tx)))[0]).toMatchObject({ quantity: 3, consumed: 2 });
    // More than is left is refused.
    await expect(
      scoped((tx) =>
        takeOutOfStock(tx, {
          ...base,
          orgId,
          lotId,
          quantity: 2,
          date: "2026-03-15",
          accountId: drawingsId,
          notes: null,
        }),
      ),
    ).rejects.toThrow(/Only 1 unit is left/);
    // Before the lot arrived is refused, and so is a bank account or Inventory itself.
    await expect(
      scoped((tx) =>
        takeOutOfStock(tx, {
          ...base,
          orgId,
          lotId,
          quantity: 1,
          date: "2026-01-01",
          accountId: drawingsId,
          notes: null,
        }),
      ),
    ).rejects.toThrow(/on or after the lot arrived/);
    await expect(
      scoped((tx) =>
        takeOutOfStock(tx, {
          ...base,
          orgId,
          lotId,
          quantity: 1,
          date: "2026-03-15",
          accountId: inventory,
          notes: null,
        }),
      ),
    ).rejects.toThrow(/Choose where its cost goes/);
    const last = await scoped((tx) =>
      takeOutOfStock(tx, {
        ...base,
        orgId,
        lotId,
        quantity: 1,
        date: "2026-04-01",
        accountId: drawingsId,
        notes: null,
      }),
    );
    expect(last.cost).toBe("3.3300");
    expect(await balance(inventory)).toBe("0.0000");
    expect(await balance(drawingsId)).toBe("10.0000");
    // An opening lot with units taken out can't be removed.
    await expect(
      scoped((tx) => removeOpeningStock(tx, { orgId, userId: null, lotId })),
    ).rejects.toThrow(/already in cost of goods sold/);

    const removals = await scoped((tx) => stockRemovalsFor(tx, [lotId]));
    expect(removals.map((r) => [r.removedOn, r.quantity, r.cost, r.notes])).toEqual([
      ["2026-03-15", 2, "6.6700", "Sold at cost outside Amazon"],
      ["2026-04-01", 1, "3.3300", null],
    ]);
  });

  it("puts units back, reversing the entry", async () => {
    const inventory = await scoped((tx) => ensureSystemAccount(tx, orgId, "inventory"));
    const [first] = await scoped((tx) => stockRemovalsFor(tx, [lotId]));
    await scoped((tx) => putBackInStock(tx, { orgId, userId: null, removalId: first?.id ?? "" }));
    expect((await scoped((tx) => listLots(tx)))[0]).toMatchObject({ consumed: 1 });
    expect(await balance(inventory)).toBe("6.6700");
    await expect(
      scoped((tx) => putBackInStock(tx, { orgId, userId: null, removalId: first?.id ?? "" })),
    ).rejects.toThrow(/already put back/);
  });

  it("moves units to the product they really are, at their cost, posting nothing", async () => {
    const inventory = await scoped((tx) => ensureSystemAccount(tx, orgId, "inventory"));
    const { pair, glass, from } = await scoped(async (tx) => {
      const pair = await createProduct(tx, {
        orgId,
        userId: null,
        name: "Cup pair 350",
        sku: null,
        notes: null,
      });
      const glass = await createProduct(tx, {
        orgId,
        userId: null,
        name: "Cup pair 250",
        sku: null,
        notes: null,
      });
      const lot = await addOpeningStock(tx, {
        ...base,
        orgId,
        productId: pair.id,
        quantity: 10,
        unitCost: "2.00",
        date: "2026-02-28",
        notes: null,
      });
      return { pair, glass, from: lot.id };
    });
    const stockBefore = await balance(inventory);
    const moved = await scoped((tx) =>
      moveStock(tx, {
        ...base,
        orgId,
        lotId: from,
        quantity: 4,
        date: "2026-03-10",
        productId: glass.id,
        notes: "Labelled as the 250",
      }),
    );
    expect(moved.cost).toBe("8.0000");
    // Stock is stock: Inventory doesn't change, and nothing was posted.
    expect(await balance(inventory)).toBe(stockBefore);
    const lots = await scoped((tx) => listLots(tx));
    expect(lots.find((l) => l.id === from)).toMatchObject({ quantity: 10, consumed: 4 });
    expect(lots.find((l) => l.id === moved.lotId)).toMatchObject({
      productId: glass.id,
      source: "moved",
      receivedOn: "2026-03-10",
      quantity: 4,
      productCost: "8.0000",
      notes: "From Cup pair 350 · Labelled as the 250",
    });
    const [row] = await scoped((tx) => stockRemovalsFor(tx, [from]));
    expect(row).toMatchObject({
      quantity: 4,
      accountId: null,
      movedToProductName: "Cup pair 250",
      journalEntryId: null,
    });
    // Not to the same product.
    await expect(
      scoped((tx) =>
        moveStock(tx, {
          ...base,
          orgId,
          lotId: from,
          quantity: 1,
          date: "2026-03-10",
          productId: pair.id,
          notes: null,
        }),
      ),
    ).rejects.toThrow(/Choose another product/);

    // Once some moved units are gone, the move can't be put back; after, it can.
    const drawn = await scoped((tx) =>
      takeOutOfStock(tx, {
        ...base,
        orgId,
        lotId: moved.lotId,
        quantity: 1,
        date: "2026-03-11",
        accountId: drawingsId,
        notes: null,
      }),
    );
    await expect(
      scoped((tx) => putBackInStock(tx, { orgId, userId: null, removalId: moved.id })),
    ).rejects.toThrow(/already sold or taken out/);
    await scoped((tx) => putBackInStock(tx, { orgId, userId: null, removalId: drawn.id }));
    await scoped((tx) => putBackInStock(tx, { orgId, userId: null, removalId: moved.id }));
    const after = await scoped((tx) => listLots(tx));
    expect(after.find((l) => l.id === moved.lotId)).toBeUndefined();
    expect(after.find((l) => l.id === from)).toMatchObject({ consumed: 0 });
  });

  it("keeps each company's removals to itself", async () => {
    expect(await scoped((tx) => stockRemovalsFor(tx, [lotId]), otherOrgId)).toEqual([]);
  });
});

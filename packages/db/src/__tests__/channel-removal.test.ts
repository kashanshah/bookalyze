import { noonMarketplace } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { channelRemovalBlockers, describeBlockers, removeChannel } from "../channel-removal";
import { createDb, type Transaction, withOrg } from "../client";
import { addNoonChannel } from "../commerce";
import { createProduct, linkSku } from "../inventory";
import { createDefaultChart, postJournalEntry, reverseJournalEntry } from "../ledger";
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
let noonId: string;
let amazonId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

const uae = noonMarketplace("noon-ae");
const ksa = noonMarketplace("noon-sa");

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([
      { code: "AED", name: "UAE Dirham", minorUnits: 2 },
      { code: "SAR", name: "Saudi Riyal", minorUnits: 2 },
    ])
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Channel Removal Org", slug: "channel-removal-org", createdAt: new Date() },
      { name: "Other Removal Org", slug: "other-removal-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  if (!uae || !ksa) throw new Error("Noon marketplaces missing");
  await scoped(async (tx) => {
    await createDefaultChart(tx, { orgId, baseCurrency: "AED" });
    noonId = (await addNoonChannel(tx, { orgId, marketplace: uae, fulfilment: "marketplace" }))
      .channel.id;
    const [amazon] = await tx
      .insert(schema.salesChannels)
      .values({
        organizationId: orgId,
        kind: "amazon",
        name: "Amazon.ae",
        marketplaceId: "A2VIGQ35RCS4UG",
        currency: "AED",
        isActive: false,
      })
      .returning();
    amazonId = amazon?.id ?? "";
    // What was brought in for the Noon country: an order with its item, and a SKU link.
    const [order] = await tx
      .insert(schema.orders)
      .values({
        organizationId: orgId,
        channelId: noonId,
        externalId: "NAE-1",
        purchasedAt: new Date("2026-03-10T10:00:00Z"),
        lastUpdatedAt: new Date("2026-03-10T10:00:00Z"),
        status: "Shipped",
        fulfillment: "amazon",
        currency: "AED",
      })
      .returning();
    await tx.insert(schema.orderItems).values({
      organizationId: orgId,
      orderId: order?.id ?? "",
      externalId: "NAE-1-1",
      sku: "MUG-4",
      quantityOrdered: 1,
      quantityShipped: 1,
    });
    const mug = await createProduct(tx, {
      orgId,
      userId: null,
      name: "Mug",
      sku: null,
      notes: null,
    });
    await linkSku(tx, {
      orgId,
      userId: null,
      productId: mug.id,
      channelId: noonId,
      sku: "MUG-4",
      units: 1,
    });
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

/** A balanced entry, standing in for a posted Noon month. */
const monthEntry = (date: string) =>
  scoped(async (tx) => {
    const accounts = await tx.select().from(schema.accounts);
    const bank = accounts.find((a) => a.subtype === "cash_bank");
    const sales = accounts.find((a) => a.type === "income");
    return postJournalEntry(tx, {
      orgId,
      date,
      memo: "Noon UAE · March 2026",
      source: "noon",
      entry: {
        currency: "AED",
        fxRate: "1",
        total: "50.00",
        lines: [
          {
            index: 0,
            accountId: bank?.id ?? "",
            description: null,
            currency: "AED",
            amount: "50.00",
            baseAmount: "50.00",
          },
          {
            index: 1,
            accountId: sales?.id ?? "",
            description: null,
            currency: "AED",
            amount: "-50.00",
            baseAmount: "-50.00",
          },
        ],
      },
    });
  });

describe("removing a channel", () => {
  it("waits while a month of it is in the books, and goes once it's taken out", async () => {
    const entry = await monthEntry("2026-03-31");
    await scoped((tx) =>
      tx.insert(schema.noonPeriods).values({
        organizationId: orgId,
        channelId: noonId,
        month: "2026-03",
        currency: "AED",
        earned: "50.0000",
        rows: 1,
        journalEntryId: entry.id,
      }),
    );
    const blockers = await scoped((tx) => channelRemovalBlockers(tx, noonId));
    expect(blockers).toEqual([{ kind: "noon_months", count: 1 }]);
    expect(describeBlockers(blockers)).toBe("1 posted Noon month");
    await expect(scoped((tx) => removeChannel(tx, noonId))).rejects.toThrow(
      /still has 1 posted Noon month in your books/,
    );

    // Taken out of the books (reversed): nothing holds it any more.
    await scoped((tx) => reverseJournalEntry(tx, { orgId, entryId: entry.id, date: "2026-03-31" }));
    expect(await scoped((tx) => channelRemovalBlockers(tx, noonId))).toEqual([]);
    expect(await scoped((tx) => removeChannel(tx, noonId))).toMatchObject({ name: "Noon UAE" });

    // Its orders, items, SKU links and months went with it; the journal keeps both entries.
    await scoped(async (tx) => {
      expect(
        await tx.select().from(schema.salesChannels).where(eq(schema.salesChannels.id, noonId)),
      ).toEqual([]);
      expect(await tx.select().from(schema.orders)).toEqual([]);
      expect(await tx.select().from(schema.orderItems)).toEqual([]);
      expect(await tx.select().from(schema.productSkus)).toEqual([]);
      expect(await tx.select().from(schema.noonPeriods)).toEqual([]);
      expect(await tx.select().from(schema.journalEntries)).toHaveLength(2);
    });
  });

  it("refuses an Amazon marketplace and a channel with settlements", async () => {
    await expect(scoped((tx) => removeChannel(tx, amazonId))).rejects.toThrow(
      /switch this one off/,
    );
    if (!ksa) throw new Error("Noon KSA missing");
    const ksaId = await scoped(async (tx) => {
      const id = (await addNoonChannel(tx, { orgId, marketplace: ksa, fulfilment: "marketplace" }))
        .channel.id;
      await tx.insert(schema.settlements).values({
        organizationId: orgId,
        channelId: id,
        externalId: "S-1",
        source: "upload",
        startAt: new Date("2026-03-01T00:00:00Z"),
        endAt: new Date("2026-03-15T00:00:00Z"),
        total: "10.0000",
        currency: "SAR",
        balanced: true,
      });
      return id;
    });
    await expect(scoped((tx) => removeChannel(tx, ksaId))).rejects.toThrow(/1 Amazon settlement/);
  });

  it("only removes the company's own channels", async () => {
    await expect(scoped((tx) => removeChannel(tx, amazonId), otherOrgId)).rejects.toThrow(
      /no longer exists/,
    );
  });
});

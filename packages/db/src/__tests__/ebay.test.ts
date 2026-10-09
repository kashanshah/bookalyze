import { ebayMarketplace } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { addEbayChannel, listEbayChannels, listNoonChannels, setChannelActive } from "../commerce";
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

const us = ebayMarketplace("EBAY_US");
const ca = ebayMarketplace("EBAY_CA");
if (!us || !ca) throw new Error("eBay marketplaces are missing.");

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "eBay Org", slug: "ebay-org", createdAt: new Date() },
      { name: "Other eBay Org", slug: "other-ebay-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("eBay channels", () => {
  it("adds a site as a channel without a connection, shipped by the seller, once per company", async () => {
    const first = await scoped((tx) => addEbayChannel(tx, { orgId, marketplace: us }));
    expect(first.created).toBe(true);
    expect(first.channel).toMatchObject({
      kind: "ebay",
      name: "eBay US",
      marketplaceId: "EBAY_US",
      country: "US",
      currency: "USD",
      fulfilment: "seller",
      connectionId: null,
      isActive: true,
    });

    // Switched off, then added again: the same channel comes back on.
    await scoped((tx) => setChannelActive(tx, first.channel.id, false));
    const again = await scoped((tx) => addEbayChannel(tx, { orgId, marketplace: us }));
    expect(again.created).toBe(false);
    expect(again.channel.id).toBe(first.channel.id);
    expect(again.channel.isActive).toBe(true);

    // The database refuses a second eBay US for the company.
    await expect(
      owner.db.insert(schema.salesChannels).values({
        organizationId: orgId,
        kind: "ebay",
        name: "eBay US",
        marketplaceId: "EBAY_US",
        currency: "USD",
      }),
    ).rejects.toThrow();
  });

  it("lists only the company's own eBay channels, apart from its Noon ones", async () => {
    await scoped((tx) => addEbayChannel(tx, { orgId, marketplace: ca }));
    await scoped((tx) => addEbayChannel(tx, { orgId: otherOrgId, marketplace: us }), otherOrgId);
    expect((await scoped((tx) => listEbayChannels(tx))).map((c) => c.name)).toEqual([
      "eBay Canada",
      "eBay US",
    ]);
    expect((await scoped((tx) => listEbayChannels(tx), otherOrgId)).map((c) => c.name)).toEqual([
      "eBay US",
    ]);
    expect(await scoped((tx) => listNoonChannels(tx))).toEqual([]);
  });

  it("refuses a channel kind the database doesn't know", async () => {
    const [channel] = await scoped((tx) => listEbayChannels(tx));
    await expect(
      owner.db
        .update(schema.salesChannels)
        .set({ kind: "etsy" as never })
        .where(eq(schema.salesChannels.id, channel?.id ?? "")),
    ).rejects.toThrow();
  });
});

import { ebayMarketplace } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection, getConnection, listConnections, setConnectionSecret } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import {
  addEbayChannel,
  attachEbayChannels,
  disconnectEbay,
  forgetEbayUser,
  getEbayConnection,
  listEbayChannels,
  listNoonChannels,
  setChannelActive,
} from "../commerce";
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

  it("puts the company's eBay sites on its eBay connection, and takes them off on disconnect", async () => {
    const connection = await scoped(async (tx) => {
      const c = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "ebay",
        name: "eBay · maple_goods",
        settings: { userId: "ebay-user-1", username: "maple_goods" },
      });
      await setConnectionSecret(tx, c.id, "sealed-refresh-token");
      await attachEbayChannels(tx, c.id);
      return c;
    });
    const sites = await scoped((tx) => listEbayChannels(tx));
    expect(sites.every((c) => c.connectionId === connection.id)).toBe(true);
    expect((await scoped((tx) => getEbayConnection(tx)))?.hasSecret).toBe(true);

    // A site added later joins the live connection.
    const uk = ebayMarketplace("EBAY_GB");
    if (!uk) throw new Error("eBay UK is missing.");
    const added = await scoped((tx) => addEbayChannel(tx, { orgId, marketplace: uk }));
    expect(added.channel.connectionId).toBe(connection.id);

    // Not a bank: Bank accounts doesn't list it. Another company doesn't see it.
    expect((await scoped((tx) => listConnections(tx))).map((c) => c.provider)).not.toContain(
      "ebay",
    );
    expect(await scoped((tx) => getEbayConnection(tx), otherOrgId)).toBeNull();

    await scoped((tx) => disconnectEbay(tx, connection.id));
    const after = await scoped((tx) => getConnection(tx, connection.id));
    expect(after).toMatchObject({ status: "disconnected", secret: null });
    expect((await scoped((tx) => listEbayChannels(tx))).every((c) => c.connectionId === null)).toBe(
      true,
    );
  });

  it("forgets an eBay user who closed their account, in the company that connected them", async () => {
    const connection = await scoped(async (tx) => {
      const c = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "ebay",
        name: "eBay · maple_goods",
        settings: { userId: "ebay-user-2", username: "maple_goods", marketplace: "EBAY_CA" },
      });
      await setConnectionSecret(tx, c.id, "sealed-refresh-token");
      await attachEbayChannels(tx, c.id);
      return c;
    });
    // Another company's lookup doesn't reach it.
    expect(await scoped((tx) => forgetEbayUser(tx, "ebay-user-2"), otherOrgId)).toBe(0);
    expect(await scoped((tx) => forgetEbayUser(tx, "ebay-user-2"))).toBe(1);
    const after = await scoped((tx) => getConnection(tx, connection.id));
    expect(after).toMatchObject({ status: "disconnected", secret: null, name: "eBay" });
    expect(after?.settings).toEqual({ marketplace: "EBAY_CA", forgotten: true });
  });
});

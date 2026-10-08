import { type AmazonOrder, noonMarketplace } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection, listConnections, setConnectionSecret } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import {
  addNoonChannel,
  attachNoonChannels,
  disconnectNoon,
  getNoonConnection,
  listNoonChannels,
  listOrders,
  saveAmazonChannels,
  setChannelActive,
  setChannelFulfilment,
  upsertOrders,
} from "../commerce";
import * as schema from "../schema";
import { settlementChannel } from "../settlements";

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

const uae = noonMarketplace("noon-ae");
const ksa = noonMarketplace("noon-sa");
if (!uae || !ksa) throw new Error("Noon marketplaces are missing.");

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Noon Org", slug: "noon-org", createdAt: new Date() },
      { name: "Other Noon Org", slug: "other-noon-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("Noon channels", () => {
  it("adds a country as a channel without a connection, once per company", async () => {
    const first = await scoped((tx) =>
      addNoonChannel(tx, { orgId, marketplace: uae, fulfilment: "marketplace" }),
    );
    expect(first.created).toBe(true);
    expect(first.channel).toMatchObject({
      kind: "noon",
      name: "Noon UAE",
      marketplaceId: "noon-ae",
      country: "AE",
      currency: "AED",
      fulfilment: "marketplace",
      connectionId: null,
      isActive: true,
    });

    // Switched off, then added again: the same channel comes back on, with the new choice.
    await scoped((tx) => setChannelActive(tx, first.channel.id, false));
    const again = await scoped((tx) =>
      addNoonChannel(tx, { orgId, marketplace: uae, fulfilment: "both" }),
    );
    expect(again.created).toBe(false);
    expect(again.channel.id).toBe(first.channel.id);
    expect(again.channel).toMatchObject({ isActive: true, fulfilment: "both" });

    // The database refuses a second Noon UAE for the company.
    await expect(
      owner.db.insert(schema.salesChannels).values({
        organizationId: orgId,
        kind: "noon",
        name: "Noon UAE",
        marketplaceId: "noon-ae",
        currency: "AED",
      }),
    ).rejects.toThrow();
  });

  it("lists only the company's own Noon channels", async () => {
    await scoped(
      (tx) => addNoonChannel(tx, { orgId: otherOrgId, marketplace: ksa, fulfilment: "seller" }),
      otherOrgId,
    );
    await scoped(
      (tx) => addNoonChannel(tx, { orgId: otherOrgId, marketplace: uae, fulfilment: "seller" }),
      otherOrgId,
    );
    const mine = await scoped((tx) => listNoonChannels(tx));
    expect(mine.map((c) => c.name)).toEqual(["Noon UAE"]);
    const theirs = await scoped((tx) => listNoonChannels(tx), otherOrgId);
    expect(theirs.map((c) => c.name)).toEqual(["Noon KSA", "Noon UAE"]);
  });

  it("changes who ships the orders, and refuses anything else", async () => {
    const [channel] = await scoped((tx) => listNoonChannels(tx));
    const updated = await scoped((tx) => setChannelFulfilment(tx, channel?.id ?? "", "seller"));
    expect(updated?.fulfilment).toBe("seller");
    await expect(
      owner.db
        .update(schema.salesChannels)
        .set({ fulfilment: "dropship" as never })
        .where(eq(schema.salesChannels.id, channel?.id ?? "")),
    ).rejects.toThrow();
  });

  it("shows a Noon channel's orders, though it has no connection", async () => {
    const [channel] = await scoped((tx) => listNoonChannels(tx));
    const order: AmazonOrder = {
      orderId: "NAE00000000001",
      marketplaceId: "noon-ae",
      purchasedAt: "2026-09-10T08:00:00Z",
      lastUpdatedAt: "2026-09-10T08:00:00Z",
      status: "Shipped",
      fulfillment: "amazon",
      currency: "AED",
      total: "120.0000",
      itemsShipped: 1,
      itemsUnshipped: 0,
      shipCountry: "AE",
      shipRegion: null,
      isBusiness: false,
      isPrime: false,
      isReplacement: false,
      earliestDelivery: null,
      latestDelivery: null,
    };
    await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId: channel?.id ?? "",
        from: "2026-09-01",
        orders: [order],
      }),
    );
    const list = await scoped((tx) =>
      listOrders(tx, { timezone: "Asia/Dubai", limit: 10, offset: 0 }),
    );
    expect(list.rows.map((o) => o.externalId)).toEqual(["NAE00000000001"]);
  });

  it("keeps Amazon.ae's uploaded settlements on Amazon.ae, beside Noon UAE", async () => {
    await scoped(async (tx) => {
      const connection = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "amazon_sp",
        name: "Amazon Seller Central · Europe",
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
    });
    const channelId = await scoped((tx) =>
      settlementChannel(tx, { connectionId: null, marketplace: null, currency: "AED" }),
    );
    const [amazonAe] = await scoped((tx) =>
      tx
        .select()
        .from(schema.salesChannels)
        .where(eq(schema.salesChannels.marketplaceId, "A2VIGQ35RCS4UG")),
    );
    expect(channelId).toBe(amazonAe?.id);
  });
});

describe("Noon's API connection", () => {
  it("puts the Noon channels on the connection, and new ones too", async () => {
    const connectionId = await scoped(async (tx) => {
      const { id } = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "noon",
        name: "Noon",
        settings: { projectCode: "PRJ000001", reports: ["transactions"], payoutsReport: true },
      });
      await setConnectionSecret(tx, id, "sealed-synthetic");
      await attachNoonChannels(tx, id);
      return id;
    });
    const connection = await scoped((tx) => getNoonConnection(tx));
    expect(connection).toMatchObject({ id: connectionId, status: "active", hasSecret: true });
    expect(connection).not.toHaveProperty("secret");

    const channels = await scoped((tx) => listNoonChannels(tx));
    expect(channels.every((c) => c.connectionId === connectionId)).toBe(true);
    const added = await scoped((tx) =>
      addNoonChannel(tx, { orgId, marketplace: ksa, fulfilment: "marketplace" }),
    );
    expect(added.channel.connectionId).toBe(connectionId);

    // Amazon Seller Central stays out of Banking, and so does Noon.
    const banking = await scoped((tx) => listConnections(tx));
    expect(banking.map((c) => c.provider)).not.toContain("noon");

    // The other company's channels aren't touched.
    const theirs = await scoped((tx) => listNoonChannels(tx), otherOrgId);
    expect(theirs.every((c) => c.connectionId === null)).toBe(true);
  });

  it("disconnecting forgets the key and keeps the channels and their orders", async () => {
    const connection = await scoped((tx) => getNoonConnection(tx));
    await scoped((tx) => disconnectNoon(tx, connection?.id ?? ""));
    expect(await scoped((tx) => getNoonConnection(tx))).toMatchObject({
      status: "disconnected",
      hasSecret: false,
    });
    const channels = await scoped((tx) => listNoonChannels(tx));
    expect(channels.map((c) => [c.name, c.connectionId, c.isActive])).toEqual([
      ["Noon KSA", null, true],
      ["Noon UAE", null, true],
    ]);
    const list = await scoped((tx) =>
      listOrders(tx, { timezone: "Asia/Dubai", limit: 10, offset: 0 }),
    );
    expect(list.rows.map((o) => o.externalId)).toEqual(["NAE00000000001"]);

    // A channel added now isn't put on the old connection.
    const egypt = noonMarketplace("noon-eg");
    const added = await scoped((tx) =>
      addNoonChannel(tx, { orgId, marketplace: egypt ?? ksa, fulfilment: "seller" }),
    );
    expect(added.channel.connectionId).toBeNull();
  });
});

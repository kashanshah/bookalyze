import { walmartMarketplace } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection, getConnection, listConnections, setConnectionSecret } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import {
  addWalmartChannel,
  attachWalmartChannel,
  disconnectWalmart,
  getWalmartConnection,
  listEbayChannels,
  listWalmartChannels,
  setChannelActive,
  setChannelFulfilment,
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

const us = walmartMarketplace("walmart-us");
const ca = walmartMarketplace("walmart-ca");
const mx = walmartMarketplace("walmart-mx");
if (!us || !ca || !mx) throw new Error("Walmart marketplaces are missing.");

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Walmart Org", slug: "walmart-org", createdAt: new Date() },
      { name: "Other Walmart Org", slug: "other-walmart-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("Walmart channels", () => {
  it("adds a country as a channel without a connection, with who ships it, once per company", async () => {
    const first = await scoped((tx) =>
      addWalmartChannel(tx, { orgId, marketplace: us, fulfilment: "marketplace" }),
    );
    expect(first.created).toBe(true);
    expect(first.channel).toMatchObject({
      kind: "walmart",
      name: "Walmart US",
      marketplaceId: "walmart-us",
      country: "US",
      currency: "USD",
      fulfilment: "marketplace",
      connectionId: null,
      isActive: true,
    });

    // Switched off, then added again: the same channel comes back on, with the new answer.
    await scoped((tx) => setChannelActive(tx, first.channel.id, false));
    const again = await scoped((tx) =>
      addWalmartChannel(tx, { orgId, marketplace: us, fulfilment: "both" }),
    );
    expect(again.created).toBe(false);
    expect(again.channel.id).toBe(first.channel.id);
    expect(again.channel).toMatchObject({ isActive: true, fulfilment: "both" });

    // Who ships it can change on its page.
    const changed = await scoped((tx) => setChannelFulfilment(tx, first.channel.id, "seller"));
    expect(changed?.fulfilment).toBe("seller");

    // The database refuses a second Walmart US for the company.
    await expect(
      owner.db.insert(schema.salesChannels).values({
        organizationId: orgId,
        kind: "walmart",
        name: "Walmart US",
        marketplaceId: "walmart-us",
        currency: "USD",
      }),
    ).rejects.toThrow();
  });

  it("lists only the company's own Walmart channels, apart from its other platforms", async () => {
    await scoped((tx) => addWalmartChannel(tx, { orgId, marketplace: ca, fulfilment: "seller" }));
    await scoped(
      (tx) => addWalmartChannel(tx, { orgId: otherOrgId, marketplace: us, fulfilment: "seller" }),
      otherOrgId,
    );
    expect((await scoped((tx) => listWalmartChannels(tx))).map((c) => c.name)).toEqual([
      "Walmart Canada",
      "Walmart US",
    ]);
    expect((await scoped((tx) => listWalmartChannels(tx), otherOrgId)).map((c) => c.name)).toEqual([
      "Walmart US",
    ]);
    expect(await scoped((tx) => listEbayChannels(tx))).toEqual([]);
  });

  it("connects one country's seller account to that country's channel only", async () => {
    const connection = await scoped(async (tx) => {
      const c = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "walmart",
        name: "Walmart Canada",
        settings: { marketplace: "walmart-ca", market: "ca" },
      });
      await setConnectionSecret(tx, c.id, "sealed-walmart-key");
      await attachWalmartChannel(tx, c.id, "walmart-ca");
      return c;
    });
    const channels = await scoped((tx) => listWalmartChannels(tx));
    expect(channels.find((c) => c.marketplaceId === "walmart-ca")?.connectionId).toBe(
      connection.id,
    );
    expect(channels.find((c) => c.marketplaceId === "walmart-us")?.connectionId).toBeNull();
    expect((await scoped((tx) => getWalmartConnection(tx, "walmart-ca")))?.hasSecret).toBe(true);
    expect(await scoped((tx) => getWalmartConnection(tx, "walmart-us"))).toBeNull();
    // Another company sees none of it.
    expect(await scoped((tx) => getWalmartConnection(tx, "walmart-ca"), otherOrgId)).toBeNull();
    // Marketplace connections stay out of Banking.
    expect((await scoped((tx) => listConnections(tx))).map((c) => c.provider)).not.toContain(
      "walmart",
    );
  });

  it("puts a country added later on its live connection, and takes it off on disconnect", async () => {
    const connection = await scoped(async (tx) => {
      const c = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "walmart",
        name: "Walmart Mexico",
        settings: { marketplace: "walmart-mx", market: "mx" },
      });
      await setConnectionSecret(tx, c.id, "sealed-walmart-mx-key");
      return c;
    });
    const added = await scoped((tx) =>
      addWalmartChannel(tx, { orgId, marketplace: mx, fulfilment: "marketplace" }),
    );
    expect(added.channel.connectionId).toBe(connection.id);

    await scoped((tx) => disconnectWalmart(tx, connection.id));
    const after = await scoped((tx) => getConnection(tx, connection.id));
    expect(after).toMatchObject({ status: "disconnected", secret: null });
    const mexico = (await scoped((tx) => listWalmartChannels(tx))).find(
      (c) => c.marketplaceId === "walmart-mx",
    );
    expect(mexico).toMatchObject({ connectionId: null, isActive: true });
    // Disconnected, it's still found (to show "Connect again"), but its status says so.
    expect((await scoped((tx) => getWalmartConnection(tx, "walmart-mx")))?.status).toBe(
      "disconnected",
    );
  });
});

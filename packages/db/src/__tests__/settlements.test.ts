import type { Settlement } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { saveAmazonChannels } from "../commerce";
import * as schema from "../schema";
import {
  getSettlement,
  knownSettlementReports,
  listSettlements,
  saveSettlement,
  settlementChannel,
} from "../settlements";

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
let connectionId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

const settlement = (over: Partial<Settlement> = {}): Settlement => ({
  settlementId: "11223344556",
  startAt: "2026-09-01T07:00:00.000Z",
  endAt: "2026-09-15T07:00:00.000Z",
  depositDate: "2026-09-17",
  total: "47.0500",
  currency: "CAD",
  marketplace: "Amazon.ca",
  orderCount: 2,
  balanced: true,
  lines: [
    {
      transactionType: "Order",
      amountType: "ItemPrice",
      amountDescription: "Principal",
      amount: "64.7500",
      count: 2,
    },
    {
      transactionType: "Order",
      amountType: "ItemFees",
      amountDescription: "Commission",
      amount: "-17.7000",
      count: 2,
    },
  ],
  ...over,
});

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Settlements Org", slug: "settlements-org", createdAt: new Date() },
      { name: "Other Settlements Org", slug: "other-settlements-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  connectionId = await scoped(async (tx) => {
    const connection = await createConnection(tx, {
      orgId,
      userId: null,
      provider: "amazon_sp",
      name: "Amazon Seller Central · North America",
      settings: { region: "na" },
    });
    await saveAmazonChannels(tx, {
      orgId,
      connectionId: connection.id,
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
        {
          marketplaceId: "ATVPDKIKX0DER",
          name: "Amazon.com",
          country: "US",
          currency: "USD",
          participating: true,
          hasSuspendedListings: false,
          storeName: null,
        },
      ],
    });
    return connection.id;
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("settlements", () => {
  it("finds the channel by marketplace name, else by its only channel in the currency", async () => {
    const channels = await scoped((tx) => tx.select().from(schema.salesChannels));
    const ca = channels.find((c) => c.name === "Amazon.ca")?.id;
    const com = channels.find((c) => c.name === "Amazon.com")?.id;
    expect(
      await scoped((tx) =>
        settlementChannel(tx, { connectionId, marketplace: "Amazon.ca", currency: "CAD" }),
      ),
    ).toBe(ca);
    expect(
      await scoped((tx) =>
        settlementChannel(tx, { connectionId, marketplace: null, currency: "USD" }),
      ),
    ).toBe(com);
    expect(
      await scoped((tx) =>
        settlementChannel(tx, { connectionId, marketplace: null, currency: "AED" }),
      ),
    ).toBeNull();
  });

  it("saves a settlement once, and the same settlement again replaces its amounts", async () => {
    const channelId = await scoped((tx) =>
      settlementChannel(tx, { connectionId, marketplace: "Amazon.ca", currency: "CAD" }),
    );
    const first = await scoped((tx) =>
      saveSettlement(tx, {
        orgId,
        connectionId,
        channelId,
        reportId: "r-1",
        source: "amazon",
        settlement: settlement(),
      }),
    );
    expect(first.created).toBe(true);
    const again = await scoped((tx) =>
      saveSettlement(tx, {
        orgId,
        connectionId,
        channelId,
        reportId: "r-1",
        source: "amazon",
        settlement: settlement({
          lines: [
            {
              transactionType: "Order",
              amountType: "ItemPrice",
              amountDescription: "Principal",
              amount: "47.0500",
              count: 2,
            },
          ],
        }),
      }),
    );
    expect(again).toEqual({ id: first.id, created: false });
    const detail = await scoped((tx) => getSettlement(tx, first.id));
    expect(detail).toMatchObject({
      externalId: "11223344556",
      total: "47.0500",
      depositDate: "2026-09-17",
      channelName: "Amazon.ca",
    });
    expect(detail?.lines.map((l) => l.amount)).toEqual(["47.0500"]);
    expect(await scoped((tx) => knownSettlementReports(tx))).toEqual(new Set(["r-1"]));

    await scoped((tx) =>
      saveSettlement(tx, {
        orgId,
        connectionId: null,
        channelId: null,
        reportId: null,
        source: "upload",
        settlement: settlement({
          settlementId: "99887766554",
          startAt: "2026-09-15T07:00:00.000Z",
          endAt: "2026-09-29T07:00:00.000Z",
          total: "-3.5000",
          balanced: false,
        }),
      }),
    );
    const list = await scoped((tx) => listSettlements(tx, { limit: 10, offset: 0 }));
    expect(list.count).toBe(2);
    expect(list.rows.map((r) => [r.externalId, r.total, r.source])).toEqual([
      ["99887766554", "-3.5000", "upload"],
      ["11223344556", "47.0500", "amazon"],
    ]);
  });

  it("keeps each company's settlements to itself", async () => {
    const theirs = await scoped((tx) => listSettlements(tx, { limit: 10, offset: 0 }), otherOrgId);
    expect(theirs.count).toBe(0);
    const rows = await app.db.execute<{ connection_id: string }>(
      sql`select connection_id from syncable_amazon_connections()`,
    );
    // The connection has no credentials in this test, so it isn't synced.
    expect(rows.rows.map((r) => r.connection_id)).not.toContain(connectionId);
  });
});

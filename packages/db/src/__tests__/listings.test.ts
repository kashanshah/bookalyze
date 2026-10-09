import { EMPTY_OBSERVATION, type ListingCheck } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { saveAmazonChannels } from "../commerce";
import {
  createListingWatch,
  deleteListingWatch,
  dueListingWatchIds,
  getListingWatch,
  ListingWatchError,
  listListingChanges,
  listListingWatches,
  markListingChangesNotified,
  saveListingCheck,
  setListingWatchPaused,
  unnotifiedListingChanges,
} from "../listings";
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
let channelId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Watch Org", slug: "watch-org", createdAt: new Date() },
      { name: "Other Watch Org", slug: "other-watch-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  channelId = await scoped(async (tx) => {
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
    const [channel] = await tx.select().from(schema.salesChannels);
    return channel?.id ?? "";
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

const input = {
  channelId: "",
  asin: "B0WATCH01X",
  checks: ["price", "content"] as ListingCheck[],
  cadence: "daily" as const,
  notify: true,
  notifyEmails: [] as string[],
};

describe("listing watches", () => {
  it("saves a product, reports a later price change, and hides it from other companies", async () => {
    const id = await scoped((tx) =>
      createListingWatch(tx, { ...input, channelId, orgId, userId: null }),
    );
    const created = await scoped((tx) => getListingWatch(tx, id));
    expect(created?.asin).toBe("B0WATCH01X");
    expect(created?.observed).toBeNull();

    await expect(
      scoped((tx) => createListingWatch(tx, { ...input, channelId, orgId, userId: null })),
    ).rejects.toBeInstanceOf(ListingWatchError);

    const checkedAt = new Date("2026-10-07T15:00:00Z");
    await scoped((tx) =>
      saveListingCheck(tx, {
        id,
        observed: { ...EMPTY_OBSERVATION, title: "Travel mug", price: "19.99", currency: "USD" },
        changes: [],
        title: "Travel mug",
        checkedAt,
        nextCheckAt: new Date("2026-10-08T15:00:00Z"),
        error: null,
      }),
    );
    const later = new Date("2026-10-08T15:00:00Z");
    await scoped((tx) =>
      saveListingCheck(tx, {
        id,
        observed: { ...EMPTY_OBSERVATION, title: "Travel mug", price: "17.49", currency: "USD" },
        changes: [
          {
            field: "price",
            summary: "Price went from US$19.99 to US$17.49.",
            before: "19.99",
            after: "17.49",
          },
        ],
        title: "Travel mug",
        checkedAt: later,
        nextCheckAt: new Date("2026-10-09T15:00:00Z"),
        error: null,
      }),
    );

    const watch = await scoped((tx) => getListingWatch(tx, id));
    expect(watch?.title).toBe("Travel mug");
    expect(watch?.lastChangeSummary).toBe("Price went from US$19.99 to US$17.49.");
    const changes = await scoped((tx) => listListingChanges(tx, id));
    expect(changes).toHaveLength(1);
    expect(changes[0]?.before).toBe("19.99");

    const mail = await scoped((tx) => unnotifiedListingChanges(tx));
    expect(mail.map((item) => item.asin)).toEqual(["B0WATCH01X"]);
    await scoped((tx) => markListingChangesNotified(tx, mail[0]?.changeIds ?? []));
    expect(await scoped((tx) => unnotifiedListingChanges(tx))).toEqual([]);

    expect(await scoped((tx) => listListingWatches(tx, "mug"))).toHaveLength(1);
    expect(await scoped((tx) => listListingWatches(tx, "nope"))).toHaveLength(0);
    expect(await scoped((tx) => getListingWatch(tx, id), otherOrgId)).toBeNull();
    expect(await scoped((tx) => listListingChanges(tx, id), otherOrgId)).toEqual([]);

    await scoped((tx) => setListingWatchPaused(tx, id, true));
    expect(await scoped((tx) => dueListingWatchIds(tx, 10))).not.toContain(id);
    await scoped((tx) => deleteListingWatch(tx, id));
    expect(await scoped((tx) => getListingWatch(tx, id))).toBeNull();
    expect(await scoped((tx) => listListingChanges(tx, id))).toEqual([]);
  });

  it("emails a product's own recipients even when owners and admins aren't", async () => {
    const id = await scoped((tx) =>
      createListingWatch(tx, {
        ...input,
        asin: "B0EXTRA001",
        notify: false,
        notifyEmails: ["buyer@example.com", "ops@example.com"],
        channelId,
        orgId,
        userId: null,
      }),
    );
    expect((await scoped((tx) => getListingWatch(tx, id)))?.notifyEmails).toEqual([
      "buyer@example.com",
      "ops@example.com",
    ]);
    await scoped((tx) =>
      saveListingCheck(tx, {
        id,
        observed: { ...EMPTY_OBSERVATION, title: "Kettle", price: "30.00", currency: "USD" },
        changes: [{ field: "price", summary: "Price changed.", before: "31.00", after: "30.00" }],
        title: "Kettle",
        checkedAt: new Date("2026-10-08T15:00:00Z"),
        nextCheckAt: new Date("2026-10-09T15:00:00Z"),
        error: null,
      }),
    );
    const mail = await scoped((tx) => unnotifiedListingChanges(tx));
    expect(mail.map((m) => [m.asin, m.notify, m.notifyEmails])).toEqual([
      ["B0EXTRA001", false, ["buyer@example.com", "ops@example.com"]],
    ]);
    // A third address is refused by the database.
    await expect(
      scoped((tx) =>
        tx
          .update(schema.listingWatches)
          .set({ notifyEmails: ["a@example.com", "b@example.com", "c@example.com"] }),
      ),
    ).rejects.toThrow();
    await scoped((tx) => markListingChangesNotified(tx, mail[0]?.changeIds ?? []));
    await scoped((tx) => deleteListingWatch(tx, id));
  });

  it("refuses hourly checks that include photos or review topics", async () => {
    await expect(
      scoped((tx) =>
        createListingWatch(tx, {
          channelId,
          asin: "B0HOURLY01",
          checks: ["price", "reviews"],
          cadence: "hourly",
          notify: false,
          notifyEmails: [],
          orgId,
          userId: null,
        }),
      ),
    ).rejects.toThrow();
    expect(await scoped((tx) => listListingWatches(tx, "B0HOURLY01"))).toHaveLength(0);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  channelCostCategories,
  channelCostsForProfit,
  cogsForProfit,
  saveChannelCostAccounts,
} from "../channel-costs";
import { createDb, type Transaction, withOrg } from "../client";
import { addEbayChannel } from "../commerce";
import {
  createDefaultChart,
  ensureSystemAccount,
  postJournalEntry,
  reverseJournalEntry,
} from "../index";
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
const ids = { bank: "", subscription: "", software: "", travel: "", cogs: "" };
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

/** Money out of the bank into `account` (an expense), as a person would record it. */
const spend = (date: string, account: string, amount: string, source?: "manual" | "ebay") =>
  scoped((tx) =>
    postJournalEntry(tx, {
      orgId,
      date,
      source,
      entry: {
        currency: "CAD",
        fxRate: "1",
        total: amount,
        lines: [
          {
            index: 0,
            accountId: account,
            description: null,
            currency: "CAD",
            amount,
            baseAmount: amount,
          },
          {
            index: 1,
            accountId: ids.bank,
            description: null,
            currency: "CAD",
            amount: `-${amount}`,
            baseAmount: `-${amount}`,
          },
        ],
      },
    }),
  );

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([{ code: "CAD", name: "Canadian Dollar", minorUnits: 2 }])
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Channel Costs Org", slug: "channel-costs-org", createdAt: new Date() },
      { name: "Other Channel Costs Org", slug: "other-channel-costs-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped((tx) => createDefaultChart(tx, { orgId, baseCurrency: "CAD" }));
  const made = await scoped((tx) =>
    tx
      .insert(schema.accounts)
      .values([
        {
          organizationId: orgId,
          code: "1012",
          name: "Chequing",
          type: "asset",
          subtype: "cash_bank",
        },
        {
          organizationId: orgId,
          code: "6810",
          name: "eBay store subscription",
          type: "expense",
          subtype: "operating_expense",
        },
        {
          organizationId: orgId,
          code: "6820",
          name: "Selling software",
          type: "expense",
          subtype: "operating_expense",
        },
        {
          organizationId: orgId,
          code: "6830",
          name: "Travel",
          type: "expense",
          subtype: "operating_expense",
        },
      ])
      .returning(),
  );
  ids.bank = made[0]?.id ?? "";
  ids.subscription = made[1]?.id ?? "";
  ids.software = made[2]?.id ?? "";
  ids.travel = made[3]?.id ?? "";
  ids.cogs = await scoped((tx) => ensureSystemAccount(tx, orgId, "cost_of_goods_sold"));
  channelId = (
    await scoped((tx) =>
      addEbayChannel(tx, {
        orgId,
        marketplace: { id: "EBAY_CA", name: "eBay Canada", country: "CA", currency: "CAD" },
      }),
    )
  ).channel.id;
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("channel costs", () => {
  it("lists expense categories, leaving out cost of goods sold, with their channel", async () => {
    await scoped((tx) =>
      saveChannelCostAccounts(tx, {
        orgId,
        userId: null,
        choices: [
          { accountId: ids.subscription, channelId },
          { accountId: ids.software, channelId: null },
        ],
      }),
    );
    const categories = await scoped((tx) => channelCostCategories(tx));
    const by = new Map(categories.map((c) => [c.accountId, c.channelId]));
    expect(by.get(ids.subscription)).toBe(channelId);
    expect(by.get(ids.software)).toBeNull();
    expect(by.has(ids.travel)).toBe(true);
    expect(by.get(ids.travel)).toBeUndefined();
    expect(by.has(ids.cogs)).toBe(false);
  });

  it("sums each counted category in the period, leaving out the marketplaces' own entries", async () => {
    await spend("2026-09-05", ids.subscription, "39.9900");
    await spend("2026-09-10", ids.software, "20.0000");
    await spend("2026-09-12", ids.travel, "50.0000"); // not counted
    await spend("2026-10-02", ids.subscription, "39.9900"); // after the period
    await spend("2026-09-30", ids.subscription, "7.0000", "ebay"); // in eBay's month already
    // An eBay month posted, then undone: neither it nor its reversal counts.
    const undone = await spend("2026-09-15", ids.subscription, "12.0000", "ebay");
    await scoped((tx) =>
      reverseJournalEntry(tx, { orgId, userId: null, entryId: undone.id, date: "2026-09-16" }),
    );
    const costs = await scoped((tx) =>
      channelCostsForProfit(tx, { from: "2026-09-01", to: "2026-09-30" }),
    );
    expect(costs.map((c) => [c.channelId, c.label, c.base])).toEqual([
      [channelId, "6810 · eBay store subscription", "39.9900"],
      [null, "6820 · Selling software", "20.0000"],
    ]);
  });

  it("gives cost of goods sold by marketplace for months ending in the period", async () => {
    await scoped((tx) =>
      tx.insert(schema.cogsPeriods).values([
        {
          organizationId: orgId,
          channelId,
          month: "2026-08",
          units: 3,
          cost: "30.0000",
          currency: "CAD",
        },
        {
          organizationId: orgId,
          channelId,
          month: "2026-09",
          units: 10,
          cost: "100.0000",
          returnedUnits: 1,
          returnedCost: "10.0000",
          lostUnits: 1,
          lostCost: "5.0000",
          foundUnits: 0,
          foundCost: "1.0000",
          currency: "CAD",
        },
      ]),
    );
    const cogs = await scoped((tx) => cogsForProfit(tx, { from: "2026-09-01", to: "2026-09-30" }));
    expect(cogs).toEqual([{ channelId, month: "2026-09", cogs: "90.0000", writeOffs: "4.0000" }]);
    // A period that ends mid-month leaves that month out.
    expect(
      await scoped((tx) => cogsForProfit(tx, { from: "2026-09-01", to: "2026-09-29" })),
    ).toEqual([]);
  });

  it("keeps each company's costs to itself", async () => {
    expect(await scoped((tx) => channelCostCategories(tx), otherOrgId)).toEqual([]);
    expect(
      await scoped(
        (tx) => channelCostsForProfit(tx, { from: "2026-01-01", to: "2026-12-31" }),
        otherOrgId,
      ),
    ).toEqual([]);
    expect(
      await scoped((tx) => cogsForProfit(tx, { from: "2026-01-01", to: "2026-12-31" }), otherOrgId),
    ).toEqual([]);
  });
});

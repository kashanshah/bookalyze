import type { Settlement } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { saveAmazonChannels } from "../commerce";
import { createDefaultChart, postJournalEntry } from "../ledger";
import * as schema from "../schema";
import {
  dismissSettlementDeposit,
  getSettlement,
  getSettlementAccounts,
  knownSettlementReports,
  listSettlements,
  matchSettlementDeposit,
  postSettlement,
  saveSettlement,
  saveSettlementSetup,
  settlementChannel,
  settlementDepositCandidates,
  settlementsToPost,
  settlementsWithOneDeposit,
  unmatchSettlementDeposit,
  unpostSettlement,
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

  it("hides settlements of a switched-off marketplace, unless they're in the books", async () => {
    const ca = (await scoped((tx) => tx.select().from(schema.salesChannels))).find(
      (c) => c.name === "Amazon.ca",
    );
    if (!ca) throw new Error("channel missing");
    const active = (isActive: boolean) =>
      scoped((tx) =>
        tx
          .update(schema.salesChannels)
          .set({ isActive })
          .where(sql`${schema.salesChannels.id} = ${ca.id}`),
      );
    await active(false);
    const list = await scoped((tx) => listSettlements(tx, { limit: 10, offset: 0 }));
    expect(list.rows.map((r) => r.externalId)).toEqual(["99887766554"]);
    expect(list.hidden).toBe(1);
    await active(true);
    expect((await scoped((tx) => listSettlements(tx, { limit: 10, offset: 0 }))).hidden).toBe(0);
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

  it("posts a settlement as one balanced entry, once, and takes it back out", async () => {
    await scoped((tx) => createDefaultChart(tx, { orgId, baseCurrency: "CAD" }));
    const accounts = await scoped((tx) => tx.select().from(schema.accounts));
    const sales = accounts.find((a) => a.code === "4000")?.id ?? "";
    const fees = accounts.find((a) => a.type === "expense" && a.systemKey === null)?.id ?? "";
    const clearing = accounts.find((a) => a.code === "1000")?.id ?? "";
    const [first] = (
      await scoped((tx) => listSettlements(tx, { limit: 10, offset: 0 }))
    ).rows.filter((r) => r.externalId === "11223344556");
    const id = first?.id ?? "";
    const post = () =>
      scoped((tx) =>
        postSettlement(tx, {
          orgId,
          userId: null,
          settlementId: id,
          baseCurrency: "CAD",
          date: "2026-09-15",
          memo: "Amazon.ca settlement 11223344556",
        }),
      );
    // Accounts not chosen yet.
    await expect(post()).rejects.toThrow(/clearing account/);
    await scoped((tx) =>
      saveSettlementSetup(tx, {
        orgId,
        userId: null,
        accounts: { sales, fees, clearing },
        postFrom: "2026-09-01",
      }),
    );
    expect(await scoped((tx) => getSettlementAccounts(tx))).toEqual({ sales, fees, clearing });
    // The unbalanced, uploaded one isn't offered.
    expect(
      (
        await scoped((tx) =>
          settlementsToPost(tx, { from: "2026-09-01", limit: 10, currency: "CAD" }),
        )
      ).map((r) => r.id),
    ).toEqual([id]);
    // Nor in another currency than the main one.
    expect(
      await scoped((tx) =>
        settlementsToPost(tx, { from: "2026-09-01", limit: 10, currency: "USD" }),
      ),
    ).toEqual([]);

    const entry = await post();
    expect(entry.label).toMatch(/^JE-/);
    const lines = await scoped((tx) =>
      tx
        .select()
        .from(schema.journalLines)
        .where(sql`${schema.journalLines.journalEntryId} = ${entry.id}`),
    );
    const by = Object.fromEntries(lines.map((l) => [l.accountId, String(l.amount)]));
    expect(by[sales]).toBe("-47.0500");
    expect(by[clearing]).toBe("47.0500");
    expect((await scoped((tx) => getSettlement(tx, id)))?.entryNumber).toBe(entry.entryNumber);
    await expect(post()).rejects.toThrow(/in the books already/);
    expect(
      await scoped((tx) =>
        settlementsToPost(tx, { from: "2026-09-01", limit: 10, currency: "CAD" }),
      ),
    ).toEqual([]);

    await scoped((tx) => unpostSettlement(tx, { orgId, userId: null, settlementId: id }));
    expect((await scoped((tx) => getSettlement(tx, id)))?.entryId).toBeNull();
    // Posts again after being taken out.
    expect((await post()).entryNumber).toBeGreaterThan(entry.entryNumber);
  });

  it("matches the payout to its bank deposit, moving the deposit to clearing, and back", async () => {
    const accounts = await scoped((tx) => tx.select().from(schema.accounts));
    const sales = accounts.find((a) => a.code === "4000")?.id ?? "";
    const fees = accounts.find((a) => a.type === "expense" && a.systemKey === null)?.id ?? "";
    const [bank, clearing] = await scoped((tx) =>
      tx
        .insert(schema.accounts)
        .values([
          {
            organizationId: orgId,
            code: "1010",
            name: "Chequing",
            type: "asset",
            subtype: "cash_bank",
            currency: "CAD",
          },
          {
            organizationId: orgId,
            code: "1150",
            name: "Amazon Clearing",
            type: "asset",
            subtype: "money_in_transit",
            currency: "CAD",
          },
        ])
        .returning(),
    );
    if (!bank || !clearing) throw new Error("accounts not created");
    await scoped((tx) =>
      saveSettlementSetup(tx, {
        orgId,
        userId: null,
        accounts: { sales, fees, clearing: clearing.id },
        postFrom: "2026-09-01",
      }),
    );
    const id =
      (await scoped((tx) => listSettlements(tx, { limit: 10, offset: 0 }))).rows.find(
        (r) => r.externalId === "11223344556",
      )?.id ?? "";
    const deposit = (date: string, amount: string) =>
      scoped((tx) =>
        postJournalEntry(tx, {
          orgId,
          date,
          memo: "AMAZON.CA DEPOSIT",
          entry: {
            currency: "CAD",
            fxRate: "1",
            total: amount,
            lines: [
              {
                index: 0,
                accountId: bank.id,
                description: null,
                currency: "CAD",
                amount,
                baseAmount: amount,
              },
              {
                index: 1,
                accountId: sales,
                description: null,
                currency: "CAD",
                amount: `-${amount}`,
                baseAmount: `-${amount}`,
              },
            ],
          },
        }),
      );
    const right = await deposit("2026-09-18", "47.0500");
    await deposit("2026-09-18", "47.0600"); // another amount
    await deposit("2026-10-15", "47.0500"); // too late
    const candidates = await scoped((tx) => settlementDepositCandidates(tx, id));
    expect(
      candidates.map((c) => [c.entryId, c.accountName, c.categories, c.uncategorized]),
    ).toEqual([[right.id, "Chequing", ["Sales"], false]]);
    expect(
      (await scoped((tx) => settlementsWithOneDeposit(tx))).map((f) => f.settlementId),
    ).toEqual([id]);

    const matched = await scoped((tx) =>
      matchSettlementDeposit(tx, { orgId, userId: null, settlementId: id, entryId: right.id }),
    );
    const lines = await scoped((tx) =>
      tx
        .select()
        .from(schema.journalLines)
        .where(sql`${schema.journalLines.journalEntryId} = ${matched.id}`),
    );
    const by = Object.fromEntries(lines.map((l) => [l.accountId, String(l.amount)]));
    expect(by).toEqual({ [bank.id]: "47.0500", [clearing.id]: "-47.0500" });
    expect((await scoped((tx) => getSettlement(tx, id)))?.deposit).toMatchObject({
      entryId: matched.id,
      date: "2026-09-18",
      accountName: "Chequing",
    });
    expect(await scoped((tx) => settlementDepositCandidates(tx, id))).toEqual([]);
    await expect(
      scoped((tx) => unpostSettlement(tx, { orgId, userId: null, settlementId: id })),
    ).rejects.toThrow(/Unmatch its bank deposit first/);

    const back = await scoped((tx) =>
      unmatchSettlementDeposit(tx, { orgId, userId: null, settlementId: id }),
    );
    const restored = await scoped((tx) =>
      tx
        .select()
        .from(schema.journalLines)
        .where(sql`${schema.journalLines.journalEntryId} = ${back.id}`),
    );
    expect(Object.fromEntries(restored.map((l) => [l.accountId, String(l.amount)]))).toEqual({
      [bank.id]: "47.0500",
      [sales]: "-47.0500",
    });
    expect((await scoped((tx) => getSettlement(tx, id)))?.deposit).toBeNull();
    // Taken back out: not suggested for this settlement again.
    expect(await scoped((tx) => settlementDepositCandidates(tx, id))).toEqual([]);

    const another = await deposit("2026-09-19", "47.0500");
    await scoped((tx) =>
      dismissSettlementDeposit(tx, { orgId, userId: null, settlementId: id, entryId: another.id }),
    );
    expect(await scoped((tx) => settlementDepositCandidates(tx, id))).toEqual([]);
  });
});

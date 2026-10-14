import type { EbayTransaction } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { addEbayChannel } from "../commerce";
import {
  ebayMonthsToPost,
  ebayPayoutCandidates,
  ebayPayoutList,
  ebayPayoutsWithOneDeposit,
  ebayPostingMonths,
  getEbaySettings,
  importEbayPayouts,
  matchEbayPayout,
  postEbayMonth,
  saveEbaySetup,
  unmatchEbayPayout,
  unpostEbayMonth,
} from "../ebay-posting";
import { importEbayTransactions } from "../ebay-transactions";
import { createDefaultChart, postJournalEntry } from "../ledger";
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
const TODAY = "2026-10-09";

// Synthetic eBay rows in CAD.
const row = (over: Partial<EbayTransaction>): EbayTransaction => ({
  transactionId: "T",
  transactionType: "SALE",
  status: "PAYOUT",
  transactionDate: "2026-09-02T14:05:00.000Z",
  orderId: null,
  payoutId: null,
  feeType: null,
  currency: "CAD",
  amount: "0",
  fees: "0",
  ebayTax: "0",
  ...over,
});
const SEPTEMBER = [
  row({ transactionId: "S1", amount: "87.0000", fees: "13.0000" }),
  row({
    transactionId: "A1",
    transactionType: "NON_SALE_CHARGE",
    feeType: "AD_FEE",
    amount: "-5.0000",
  }),
  row({ transactionId: "L1", transactionType: "SHIPPING_LABEL", amount: "-12.0000" }),
];
const OCTOBER = [
  row({
    transactionId: "S2",
    amount: "40.0000",
    fees: "6.0000",
    transactionDate: "2026-10-02T10:00:00Z",
  }),
];

let ids: { sales: string; fees: string; balance: string; bank: string };

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([{ code: "CAD", name: "Canadian Dollar", minorUnits: 2 }])
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "eBay Posting Org", slug: "ebay-posting-org", createdAt: new Date() },
      { name: "Other eBay Posting Org", slug: "other-ebay-posting-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped((tx) => createDefaultChart(tx, { orgId, baseCurrency: "CAD" }));
  const accounts = await scoped((tx) => tx.select().from(schema.accounts));
  const [bank, balance] = await scoped((tx) =>
    tx
      .insert(schema.accounts)
      .values([
        {
          organizationId: orgId,
          code: "1012",
          name: "Chequing",
          type: "asset",
          subtype: "cash_bank",
          currency: "CAD",
        },
        {
          organizationId: orgId,
          code: "1170",
          name: "eBay balance",
          type: "asset",
          subtype: "money_in_transit",
        },
      ])
      .returning(),
  );
  ids = {
    sales: accounts.find((a) => a.code === "4000")?.id ?? "",
    fees: accounts.find((a) => a.type === "expense" && a.systemKey === null)?.id ?? "",
    balance: balance?.id ?? "",
    bank: bank?.id ?? "",
  };
  channelId = (
    await scoped((tx) =>
      addEbayChannel(tx, {
        orgId,
        marketplace: { id: "EBAY_CA", name: "eBay Canada", country: "CA", currency: "CAD" },
      }),
    )
  ).channel.id;
  await scoped((tx) => importEbayTransactions(tx, { orgId, rows: [...SEPTEMBER, ...OCTOBER] }));
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

const linesOf = (entryId: string) =>
  scoped(async (tx) => {
    const lines = await tx
      .select()
      .from(schema.journalLines)
      .where(sql`${schema.journalLines.journalEntryId} = ${entryId}`);
    return Object.fromEntries(lines.map((l) => [l.accountId, String(l.amount)]));
  });
const post = (month: string) =>
  scoped((tx) =>
    postEbayMonth(tx, { orgId, userId: null, channelId, month, baseCurrency: "CAD", today: TODAY }),
  );

describe("eBay in the books", () => {
  it("shows each month's net, waiting for the setup", async () => {
    const months = await scoped((tx) => ebayPostingMonths(tx, TODAY));
    expect(months.map((m) => [m.month, m.state, m.net, m.rows])).toEqual([
      ["2026-10", "notSetUp", "40.0000", 1],
      ["2026-09", "notSetUp", "70.0000", 3],
    ]);
  });

  it("posts a finished month as one entry, the net to the eBay balance, and again when it changes", async () => {
    await scoped((tx) =>
      saveEbaySetup(tx, {
        orgId,
        userId: null,
        accounts: { sales: ids.sales, fees: ids.fees, balance: ids.balance },
        postFrom: "2026-09-01",
        autoPost: true,
      }),
    );
    expect(await scoped((tx) => getEbaySettings(tx))).toEqual({
      postFrom: "2026-09-01",
      autoPost: true,
    });
    expect(
      (await scoped((tx) => ebayMonthsToPost(tx, TODAY))).map((m) => [m.month, m.state]),
    ).toEqual([["2026-09", "ready"]]);
    await expect(post("2026-10")).rejects.toThrow(/isn't over yet/);
    const entry = await post("2026-09");
    expect(await linesOf(entry.id)).toEqual({
      [ids.sales]: "-100.0000",
      [ids.fees]: "30.0000", // fees 13 + advertising 5 + labels 12
      [ids.balance]: "70.0000",
    });
    await expect(post("2026-09")).rejects.toThrow(/in the books already/);

    // A late label on September: the month shows as changed, and posts again as it is now.
    await scoped((tx) =>
      importEbayTransactions(tx, {
        orgId,
        rows: [
          row({
            transactionId: "L2",
            transactionType: "SHIPPING_LABEL",
            amount: "-4.0000",
            transactionDate: "2026-09-29T10:00:00Z",
          }),
        ],
      }),
    );
    const changed = (await scoped((tx) => ebayPostingMonths(tx, TODAY))).find(
      (m) => m.month === "2026-09",
    );
    expect(changed).toMatchObject({ state: "changed", net: "66.0000" });
    const again = await post("2026-09");
    expect(again.again).toBe(true);
    expect((await linesOf(again.id))[ids.balance]).toBe("66.0000");
    const [old] = await scoped((tx) =>
      tx.select().from(schema.journalEntries).where(sql`${schema.journalEntries.id} = ${entry.id}`),
    );
    expect(old?.reversedByEntryId).not.toBeNull();
  });

  it("matches a payout to its bank deposit, out of the eBay balance, and back", async () => {
    await scoped((tx) =>
      importEbayPayouts(tx, {
        orgId,
        payouts: [
          {
            payoutId: "P-1",
            status: "SUCCEEDED",
            payoutDate: "2026-09-24T08:00:00Z",
            currency: "CAD",
            amount: "60.0000",
            accountLast4: "1234",
          },
          {
            payoutId: "P-FAILED",
            status: "TERMINAL_FAILED",
            payoutDate: "2026-09-20T08:00:00Z",
            currency: "CAD",
            amount: "60.0000",
            accountLast4: null,
          },
        ],
      }),
    );
    const deposit = (date: string, amount: string) =>
      scoped((tx) =>
        postJournalEntry(tx, {
          orgId,
          date,
          memo: "EBAY COMMERCE CA",
          entry: {
            currency: "CAD",
            fxRate: "1",
            total: amount,
            lines: [
              {
                index: 0,
                accountId: ids.bank,
                description: null,
                currency: "CAD",
                amount,
                baseAmount: amount,
              },
              {
                index: 1,
                accountId: ids.sales,
                description: null,
                currency: "CAD",
                amount: `-${amount}`,
                baseAmount: `-${amount}`,
              },
            ],
          },
        }),
      );
    const right = await deposit("2026-09-25", "60.00");
    await deposit("2026-09-25", "60.01"); // another amount
    await deposit("2026-10-20", "60.00"); // too late
    const payouts = await scoped((tx) => ebayPayoutList(tx));
    const p = payouts.find((x) => x.payoutId === "P-1");
    const failed = payouts.find((x) => x.payoutId === "P-FAILED");
    expect(failed?.sent).toBe(false);
    expect(await scoped((tx) => ebayPayoutCandidates(tx, failed?.id ?? ""))).toEqual([]);
    const candidates = await scoped((tx) => ebayPayoutCandidates(tx, p?.id ?? ""));
    expect(candidates.map((c) => c.entryId)).toEqual([right.id]);
    expect((await scoped((tx) => ebayPayoutsWithOneDeposit(tx))).map((x) => x.payoutId)).toEqual([
      p?.id,
    ]);

    const matched = await scoped((tx) =>
      matchEbayPayout(tx, {
        orgId,
        userId: null,
        payoutId: p?.id ?? "",
        entryId: right.id,
        baseCurrency: "CAD",
      }),
    );
    expect(await linesOf(matched.id)).toEqual({
      [ids.bank]: "60.0000",
      [ids.balance]: "-60.0000",
    });
    expect(
      (await scoped((tx) => ebayPayoutList(tx))).find((x) => x.id === p?.id)?.matched,
    ).toMatchObject({
      entryId: matched.id,
    });

    await scoped((tx) => unmatchEbayPayout(tx, { orgId, userId: null, payoutId: p?.id ?? "" }));
    expect(
      (await scoped((tx) => ebayPayoutList(tx))).find((x) => x.id === p?.id)?.matched,
    ).toBeNull();
    // The restored deposit isn't suggested for it again.
    expect(await scoped((tx) => ebayPayoutCandidates(tx, p?.id ?? ""))).toEqual([]);
  });

  it("takes a month back out of the books", async () => {
    await scoped((tx) => unpostEbayMonth(tx, { orgId, userId: null, channelId, month: "2026-09" }));
    const september = (await scoped((tx) => ebayPostingMonths(tx, TODAY))).find(
      (m) => m.month === "2026-09",
    );
    expect(september).toMatchObject({ state: "ready", posted: null });
  });

  it("keeps each company's eBay books to itself", async () => {
    expect(await scoped((tx) => ebayPostingMonths(tx, TODAY), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => ebayPayoutList(tx), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => tx.select().from(schema.ebayPeriods), otherOrgId)).toEqual([]);
  });
});

import { type WalmartSettlementFile, walmartMarketplace } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { addWalmartChannel } from "../commerce";
import { createDefaultChart, postJournalEntry } from "../ledger";
import * as schema from "../schema";
import {
  getWalmartSettings,
  matchWalmartPayout,
  postWalmartSettlement,
  saveWalmartSetup,
  unmatchWalmartPayout,
  unpostWalmartSettlement,
  walmartPayoutCandidates,
  walmartPayoutsWithOneDeposit,
  walmartPostingList,
  walmartSettlementsToPost,
} from "../walmart-posting";
import { saveWalmartSettlement } from "../walmart-settlements";

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

const ca = walmartMarketplace("walmart-ca");
if (!ca) throw new Error("Walmart Canada is missing.");

// Synthetic settlement rows in CAD, in Walmart's layout.
const COLUMNS = [
  "Period Start Date",
  "Period End Date",
  "Total Payout",
  "Transaction Type",
  "Amount",
  "Amount Type",
];
const r = (transactionType: string, amount: string, amountType: string) => ({
  "Transaction Type": transactionType,
  Amount: amount,
  "Amount Type": amountType,
});
const file = (
  payout: string,
  rows: Record<string, string>[],
  to = "2026-09-14",
): WalmartSettlementFile => ({
  columns: COLUMNS,
  dropped: [],
  rows,
  periodFrom: "2026-09-01",
  periodTo: to,
  payout,
  currency: "CAD",
});
const SEPTEMBER = [
  r("Sale", "100.00", "Product Price"),
  r("Sale", "-15.00", "Commission on Product"),
  r("Sale", "-4.00", "Walmart Fulfillment Services Fee"),
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
      { name: "Walmart Posting Org", slug: "walmart-posting-org", createdAt: new Date() },
      {
        name: "Other Walmart Posting Org",
        slug: "other-walmart-posting-org",
        createdAt: new Date(),
      },
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
          code: "1175",
          name: "Walmart balance",
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
    await scoped((tx) => addWalmartChannel(tx, { orgId, marketplace: ca, fulfilment: "both" }))
  ).channel.id;
  await scoped((tx) =>
    saveWalmartSettlement(tx, {
      orgId,
      channelId,
      reportDate: "2026-09-16",
      file: file("81.00", SEPTEMBER),
    }),
  );
  // Rows that don't add up to the payout: never posts.
  await scoped((tx) =>
    saveWalmartSettlement(tx, {
      orgId,
      channelId,
      reportDate: "2026-09-30",
      file: file("50.00", [r("Sale", "40.00", "Product Price")], "2026-09-28"),
    }),
  );
  // Before posting starts.
  await scoped((tx) =>
    saveWalmartSettlement(tx, {
      orgId,
      channelId,
      reportDate: "2026-08-18",
      file: {
        ...file("10.00", [r("Sale", "10.00", "Product Price")], "2026-08-14"),
        periodFrom: "2026-08-01",
      },
    }),
  );
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
const settlementOn = async (reportDate: string) => {
  const s = (await scoped((tx) => walmartPostingList(tx))).find((x) => x.reportDate === reportDate);
  if (!s) throw new Error(`No settlement on ${reportDate}`);
  return s;
};
const post = async (reportDate: string) => {
  const s = await settlementOn(reportDate);
  return scoped((tx) =>
    postWalmartSettlement(tx, { orgId, userId: null, settlementId: s.id, baseCurrency: "CAD" }),
  );
};

describe("Walmart in the books", () => {
  it("shows each settlement, waiting for the setup", async () => {
    const list = await scoped((tx) => walmartPostingList(tx));
    expect(list.map((s) => [s.reportDate, s.state, s.payout])).toEqual([
      ["2026-09-30", "notSetUp", "50.0000"],
      ["2026-09-16", "notSetUp", "81.0000"],
      ["2026-08-18", "notSetUp", "10.0000"],
    ]);
    expect((await settlementOn("2026-09-30")).problem).toBe(
      "The rows add up to 40.0000, not Walmart's payout of 50.0000.",
    );
  });

  it("posts a settlement as one entry, the net to the Walmart balance, and again when it changes", async () => {
    await scoped((tx) =>
      saveWalmartSetup(tx, {
        orgId,
        userId: null,
        accounts: { sales: ids.sales, fees: ids.fees, balance: ids.balance },
        postFrom: "2026-09-01",
        autoPost: true,
      }),
    );
    expect(await scoped((tx) => getWalmartSettings(tx))).toEqual({
      postFrom: "2026-09-01",
      autoPost: true,
    });
    const list = await scoped((tx) => walmartPostingList(tx));
    expect(list.map((s) => [s.reportDate, s.state])).toEqual([
      ["2026-09-30", "problem"],
      ["2026-09-16", "ready"],
      ["2026-08-18", "before"],
    ]);
    expect((await scoped((tx) => walmartSettlementsToPost(tx))).map((s) => s.reportDate)).toEqual([
      "2026-09-16",
    ]);
    await expect(post("2026-09-30")).rejects.toThrow(/not Walmart's payout/);
    await expect(post("2026-08-18")).rejects.toThrow(/before Walmart posting starts/);

    const entry = await post("2026-09-16");
    expect(await linesOf(entry.id)).toEqual({
      [ids.sales]: "-100.0000",
      [ids.fees]: "19.0000", // commission 15 + WFS 4
      [ids.balance]: "81.0000",
    });
    const [je] = await scoped((tx) =>
      tx.select().from(schema.journalEntries).where(sql`${schema.journalEntries.id} = ${entry.id}`),
    );
    expect(je).toMatchObject({
      source: "walmart",
      date: "2026-09-14",
      reference: "WMT-2026-09-16",
    });
    await expect(post("2026-09-16")).rejects.toThrow(/in the books already/);

    // Walmart corrects the report: it shows as changed, and posts again as it is now.
    await scoped((tx) =>
      saveWalmartSettlement(tx, {
        orgId,
        channelId,
        reportDate: "2026-09-16",
        file: file("80.00", [...SEPTEMBER, r("Adjustment", "-1.00", "Item Fees")]),
      }),
    );
    expect(await settlementOn("2026-09-16")).toMatchObject({ state: "changed" });
    const again = await post("2026-09-16");
    expect(again.again).toBe(true);
    expect((await linesOf(again.id))[ids.balance]).toBe("80.0000");
    const [old] = await scoped((tx) =>
      tx.select().from(schema.journalEntries).where(sql`${schema.journalEntries.id} = ${entry.id}`),
    );
    expect(old?.reversedByEntryId).not.toBeNull();
  });

  it("matches the payout to its bank deposit, out of the Walmart balance, and back", async () => {
    const deposit = (date: string, amount: string) =>
      scoped((tx) =>
        postJournalEntry(tx, {
          orgId,
          date,
          memo: "WALMART CANADA",
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
    const right = await deposit("2026-09-17", "80.00");
    await deposit("2026-09-17", "80.01"); // another amount
    await deposit("2026-11-20", "80.00"); // too late
    const s = await settlementOn("2026-09-16");
    expect((await scoped((tx) => walmartPayoutCandidates(tx, s.id))).map((c) => c.entryId)).toEqual(
      [right.id],
    );
    expect(
      (await scoped((tx) => walmartPayoutsWithOneDeposit(tx))).map((x) => x.settlementId),
    ).toEqual([s.id]);
    // Not posted: no payout to match.
    const problem = await settlementOn("2026-09-30");
    expect(await scoped((tx) => walmartPayoutCandidates(tx, problem.id))).toEqual([]);

    const matched = await scoped((tx) =>
      matchWalmartPayout(tx, {
        orgId,
        userId: null,
        settlementId: s.id,
        entryId: right.id,
        baseCurrency: "CAD",
      }),
    );
    expect(await linesOf(matched.id)).toEqual({ [ids.bank]: "80.0000", [ids.balance]: "-80.0000" });
    expect((await settlementOn("2026-09-16")).deposit).toMatchObject({ entryId: matched.id });

    await scoped((tx) => unmatchWalmartPayout(tx, { orgId, userId: null, settlementId: s.id }));
    expect((await settlementOn("2026-09-16")).deposit).toBeNull();
    // The restored deposit isn't suggested for it again.
    expect(await scoped((tx) => walmartPayoutCandidates(tx, s.id))).toEqual([]);
  });

  it("takes a settlement back out of the books", async () => {
    const s = await settlementOn("2026-09-16");
    await scoped((tx) => unpostWalmartSettlement(tx, { orgId, userId: null, settlementId: s.id }));
    expect(await settlementOn("2026-09-16")).toMatchObject({ state: "ready", posted: null });
  });

  it("reads the totals again for settlements kept before they were added up", async () => {
    const s = await settlementOn("2026-09-16");
    await owner.db
      .update(schema.walmartSettlements)
      .set({ totals: null, totalsVersion: null })
      .where(sql`${schema.walmartSettlements.id} = ${s.id}`);
    expect(await settlementOn("2026-09-16")).toMatchObject({ state: "ready", problem: null });
  });

  it("keeps each company's Walmart books to itself", async () => {
    expect(await scoped((tx) => walmartPostingList(tx), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => tx.select().from(schema.walmartAccounts), otherOrgId)).toEqual([]);
  });
});

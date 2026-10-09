import { parseNoonTransactions } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry } from "../ledger";
import {
  matchNoonPayout,
  noonBalanceCheck,
  noonMonths,
  noonMonthsToPost,
  noonPayoutCandidates,
  noonPayouts,
  noonPayoutsWithOneDeposit,
  postNoonMonth,
  saveNoonSetup,
  unmatchNoonPayout,
  unpostNoonMonth,
} from "../noon-posting";
import { importNoonTransactions } from "../noon-transactions";
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
const TODAY = "2026-10-09";

// Noon's header; synthetic rows.
const HEADER =
  "Contract,Contract Title,Reference Nr,Order Nr,Item Nr,Order Date,Transaction Date,Title,SKUs,Partner SKUs,Transaction Type,Currency,Net Proceeds,Referral Fee including VAT,Fullfilment & Logistics Fees including VAT,Shipping Credits including VAT,Other Order Fees including VAT,Order Subsidies including VAT,Non-Order Fees including VAT,Non-Order Subsidies including VAT,Others including VAT,Total";
const SEPTEMBER = [
  "C1,Noon AE,REF-1,NAE001,ITEM-1,2026-09-01,2026-09-02,Maple mug,Z1,MUG-1,order,AED,100.00,-8.40,-6.30,0,0,2.00,0,0,0,87.30",
  "C1,Noon AE,PS-1,,,,2026-09-09,Advertising Fee,,,statement_fee,AED,0,0,0,0,0,0,-30.00,0,0,-30.00",
  "C1,Noon AE,CTH-1,,,,2026-09-24,C1-C2-2026-09-24,,,balance_transfer,AED,0,0,0,0,0,0,0,0,-12.00,-12.00",
  "C1,Noon AE,PAY-1,,,,2026-09-24,Payment,,,payment,AED,0,0,0,0,0,0,0,0,-50.00,-50.00",
];
const OCTOBER = [
  "C1,Noon AE,REF-2,NAE002,ITEM-1,2026-10-01,2026-10-02,Maple mug,Z1,MUG-1,order,AED,100.00,-8.40,-6.30,0,0,2.00,0,0,0,87.30",
];

const bring = (lines: string[]) => {
  const parsed = parseNoonTransactions([HEADER, ...lines].join("\n"));
  if (!parsed.ok) throw new Error(parsed.error);
  return scoped((tx) =>
    importNoonTransactions(tx, { orgId, rows: parsed.rows, source: "upload", connectionId: null }),
  );
};

let ids: { sales: string; fees: string; other: string; balance: string; bank: string };

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([{ code: "AED", name: "UAE Dirham", minorUnits: 2 }])
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Noon Posting Org", slug: "noon-posting-org", createdAt: new Date() },
      { name: "Other Noon Posting Org", slug: "other-noon-posting-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped((tx) => createDefaultChart(tx, { orgId, baseCurrency: "AED" }));
  const accounts = await scoped((tx) => tx.select().from(schema.accounts));
  const [bank, balance] = await scoped((tx) =>
    tx
      .insert(schema.accounts)
      .values([
        {
          organizationId: orgId,
          code: "1011",
          name: "Wio Bank",
          type: "asset",
          subtype: "cash_bank",
          currency: "AED",
        },
        {
          organizationId: orgId,
          code: "1160",
          name: "Noon balance",
          type: "asset",
          subtype: "money_in_transit",
        },
      ])
      .returning(),
  );
  ids = {
    sales: accounts.find((a) => a.code === "4000")?.id ?? "",
    fees: accounts.find((a) => a.type === "expense" && a.systemKey === null)?.id ?? "",
    other: accounts.find((a) => a.code === "4500")?.id ?? "",
    balance: balance?.id ?? "",
    bank: bank?.id ?? "",
  };
  await bring([...SEPTEMBER, ...OCTOBER]);
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

describe("Noon in the books", () => {
  it("groups each month, and waits for the setup", async () => {
    const months = await scoped((tx) => noonMonths(tx, TODAY));
    expect(months.map((m) => [m.month, m.state, m.earned, m.paidOut, m.rows])).toEqual([
      ["2026-10", "notSetUp", "87.3000", "0.0000", 1],
      ["2026-09", "notSetUp", "45.3000", "50.0000", 4],
    ]);
    expect(months[1]?.groups).toMatchObject({
      sales: "100.0000",
      fees: "-14.7000",
      advertising: "-30.0000",
      subsidies: "2.0000",
      transfers: "-12.0000",
    });
  });

  it("posts a finished month as one entry, the net to the Noon balance", async () => {
    await scoped((tx) =>
      saveNoonSetup(tx, {
        orgId,
        userId: null,
        accounts: {
          sales: ids.sales,
          fees: ids.fees,
          subsidies: ids.other,
          transfers: ids.fees,
          balance: ids.balance,
        },
        postFrom: "2026-09-01",
      }),
    );
    expect(
      (await scoped((tx) => noonMonthsToPost(tx, TODAY))).map((m) => [m.month, m.state]),
    ).toEqual([["2026-09", "ready"]]);
    const post = (month: string) =>
      scoped(async (tx) => {
        const [channel] = await tx.select().from(schema.salesChannels);
        return postNoonMonth(tx, {
          orgId,
          userId: null,
          channelId: channel?.id ?? "",
          month,
          baseCurrency: "AED",
          today: TODAY,
        });
      });
    await expect(post("2026-10")).rejects.toThrow(/isn't over yet/);
    const entry = await post("2026-09");
    expect(await linesOf(entry.id)).toEqual({
      [ids.sales]: "-100.0000",
      [ids.fees]: "56.7000", // fees 14.70 + advertising 30 + transfer 12
      [ids.other]: "-2.0000",
      [ids.balance]: "45.3000",
    });
    await expect(post("2026-09")).rejects.toThrow(/in the books already/);

    // A late fee on September: the month shows as changed, and posts again as it is now.
    await bring([
      "C1,Noon AE,REF-1,NAE001,ITEM-1,2026-09-01,2026-09-30,,Z1,MUG-1,order_update,AED,0,-0.50,0,0,0,0,0,0,0,-0.50",
    ]);
    const changed = (await scoped((tx) => noonMonths(tx, TODAY))).find(
      (m) => m.month === "2026-09",
    );
    expect(changed).toMatchObject({ state: "changed", earned: "44.8000" });
    const again = await post("2026-09");
    expect(again.again).toBe(true);
    expect((await linesOf(again.id))[ids.balance]).toBe("44.8000");
    const [old] = await scoped((tx) =>
      tx.select().from(schema.journalEntries).where(sql`${schema.journalEntries.id} = ${entry.id}`),
    );
    expect(old?.reversedByEntryId).not.toBeNull();
  });

  it("matches a payout to its bank deposit, out of the Noon balance, and back", async () => {
    const deposit = (date: string, amount: string) =>
      scoped((tx) =>
        postJournalEntry(tx, {
          orgId,
          date,
          memo: "From NOON E COMMERCE",
          entry: {
            currency: "AED",
            fxRate: "1",
            total: amount,
            lines: [
              {
                index: 0,
                accountId: ids.bank,
                description: null,
                currency: "AED",
                amount,
                baseAmount: amount,
              },
              {
                index: 1,
                accountId: ids.sales,
                description: null,
                currency: "AED",
                amount: `-${amount}`,
                baseAmount: `-${amount}`,
              },
            ],
          },
        }),
      );
    const right = await deposit("2026-09-25", "50.00");
    await deposit("2026-09-25", "50.01"); // another amount
    await deposit("2026-10-20", "50.00"); // too late
    const [payout] = await scoped((tx) => noonPayouts(tx));
    expect(payout).toMatchObject({ amount: "50.0000", before: false, matched: null });
    const candidates = await scoped((tx) => noonPayoutCandidates(tx, payout?.id ?? ""));
    expect(candidates.map((c) => [c.entryId, c.accountName, c.categories])).toEqual([
      [right.id, "Wio Bank", ["Sales"]],
    ]);
    expect(
      (await scoped((tx) => noonPayoutsWithOneDeposit(tx))).map((f) => f.transactionId),
    ).toEqual([payout?.id]);

    const matched = await scoped((tx) =>
      matchNoonPayout(tx, {
        orgId,
        userId: null,
        transactionId: payout?.id ?? "",
        entryId: right.id,
        baseCurrency: "AED",
      }),
    );
    expect(await linesOf(matched.id)).toEqual({
      [ids.bank]: "50.0000",
      [ids.balance]: "-50.0000",
    });
    expect((await scoped((tx) => noonPayouts(tx)))[0]?.matched?.entryId).toBe(matched.id);

    // The books agree with Noon: September in, its payout out, October not over yet.
    expect(await scoped((tx) => noonBalanceCheck(tx, TODAY))).toEqual([
      {
        currency: "AED",
        books: "-5.2000",
        noon: "82.1000",
        notPosted: "87.3000",
        monthsNotPosted: 1,
        notMatched: "0.0000",
        payoutsNotMatched: 0,
        unexplained: "0.0000",
      },
    ]);

    await scoped((tx) =>
      unmatchNoonPayout(tx, { orgId, userId: null, transactionId: payout?.id ?? "" }),
    );
    expect((await scoped((tx) => noonPayouts(tx)))[0]?.matched).toBeNull();
    // Back in Sales, and not suggested again.
    expect(await scoped((tx) => noonPayoutCandidates(tx, payout?.id ?? ""))).toEqual([]);
  });

  it("takes a month back out of the books", async () => {
    const [channel] = await scoped((tx) => tx.select().from(schema.salesChannels));
    await scoped((tx) =>
      unpostNoonMonth(tx, { orgId, userId: null, channelId: channel?.id ?? "", month: "2026-09" }),
    );
    const months = await scoped((tx) => noonMonths(tx, TODAY));
    expect(months.find((m) => m.month === "2026-09")).toMatchObject({
      state: "ready",
      posted: null,
    });
  });

  it("keeps each company's Noon books to itself", async () => {
    expect(await scoped((tx) => noonMonths(tx, TODAY), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => noonPayouts(tx), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => tx.select().from(schema.noonPeriods), otherOrgId)).toEqual([]);
  });
});

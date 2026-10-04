import { prepareTransfer } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { fxRateOn, missingCadRates, upsertFxRates } from "../fx";
import {
  accountBalances,
  createDefaultChart,
  postJournalEntry,
  reverseJournalEntry,
} from "../ledger";
import * as schema from "../schema";
import { listTransactions } from "../transactions";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let orgId: string;
const ids: Record<string, string> = {};
const scoped = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId }, fn);

async function pgErrorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(error);
  }
  throw new Error("Expected the query to fail");
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([
      { code: "CAD", name: "Canadian Dollar", minorUnits: 2 },
      { code: "USD", name: "US Dollar", minorUnits: 2 },
    ])
    .onConflictDoNothing();
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: "FX Org", slug: "fx-org", createdAt: new Date() })
    .returning({ id: schema.organization.id });
  if (!org) throw new Error("no org");
  orgId = org.id;
  await scoped((tx) => createDefaultChart(tx, { orgId, baseCurrency: "CAD" }));
  const [wise] = await scoped((tx) =>
    tx
      .insert(schema.accounts)
      .values({
        organizationId: orgId,
        code: "1020",
        name: "Wise USD",
        type: "asset",
        subtype: "cash_bank",
        currency: "USD",
      })
      .returning(),
  );
  for (const a of await scoped((tx) => tx.select().from(schema.accounts)))
    if (a.code) ids[a.code] = a.id;
  if (wise) ids.wise = wise.id;
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("exchange rates", () => {
  it("stores Bank of Canada rates and derives pairs for a date, looking back over weekends", async () => {
    await upsertFxRates(
      app.db,
      [
        { date: "2026-10-01", base: "CAD", quote: "USD", rate: "1.3650" },
        { date: "2026-10-02", base: "CAD", quote: "USD", rate: "1.3600" },
      ],
      "Bank of Canada",
    );
    // Saturday uses Friday's rate; refreshing a day replaces it.
    expect(await fxRateOn(app.db, { base: "CAD", quote: "USD", date: "2026-10-03" })).toEqual({
      rate: "1.3600000000",
      asOf: "2026-10-02",
      source: "Bank of Canada",
    });
    await upsertFxRates(
      app.db,
      [{ date: "2026-10-02", base: "CAD", quote: "USD", rate: "1.3610" }],
      "Bank of Canada",
    );
    expect((await fxRateOn(app.db, { base: "CAD", quote: "USD", date: "2026-10-02" }))?.rate).toBe(
      "1.3610000000",
    );
    // AED needs no stored rate for USD; CAD → AED goes through USD.
    expect(await fxRateOn(app.db, { base: "AED", quote: "USD", date: "2026-10-02" })).toMatchObject(
      { rate: "3.6725", source: "Fixed rate" },
    );
    expect(
      (await fxRateOn(app.db, { base: "AED", quote: "CAD", date: "2026-10-02" }))?.source,
    ).toBe("Bank of Canada");
    expect(await fxRateOn(app.db, { base: "CAD", quote: "USD", date: "2026-08-01" })).toBeNull();
    expect(await missingCadRates(app.db, "CAD", "EUR", "2026-10-02")).toEqual(["EUR"]);
  });

  it("can't be deleted by the app", async () => {
    expect(await pgErrorOf(app.db.delete(schema.fxRates))).toMatch(/permission denied/);
  });
});

describe("entries in more than one currency", () => {
  it("posts and reverses a USD → CAD transfer that balances in CAD", async () => {
    const accounts = new Map(
      (await scoped((tx) => tx.select().from(schema.accounts))).map((a) => [a.id, a]),
    );
    const prepared = prepareTransfer(
      {
        fromAccountId: ids.wise as string,
        toAccountId: ids["1000"] as string,
        sent: "1000",
        received: "1362.40",
        baseCurrency: "CAD",
      },
      accounts,
    );
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.errors));
    const posted = await scoped((tx) =>
      postJournalEntry(tx, { orgId, date: "2026-10-02", entry: prepared.entry }),
    );
    const { rows } = await scoped((tx) => listTransactions(tx, { limit: 10, offset: 0 }));
    expect(rows[0]?.view).toMatchObject({
      kind: "transfer",
      amount: "1000.0000",
      receivedAmount: "1362.4000",
      receivedCurrency: "CAD",
    });
    const balances = await scoped((tx) => accountBalances(tx));
    expect(balances.find((b) => b.accountId === ids.wise)?.balance).toBe("-1362.4000");

    await scoped((tx) =>
      reverseJournalEntry(tx, { orgId, entryId: posted.id, date: "2026-10-03" }),
    );
    const after = await scoped((tx) => accountBalances(tx));
    expect(after.find((b) => b.accountId === ids.wise)?.balance).toBe("0.0000");
  });

  it("still refuses entries that don't balance in the base currency", async () => {
    const message = await pgErrorOf(
      scoped(async (tx) => {
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({ organizationId: orgId, entryNumber: 900, date: "2026-10-05", currency: "USD" })
          .returning();
        await tx.insert(schema.journalLines).values([
          {
            organizationId: orgId,
            journalEntryId: entry?.id as string,
            lineNo: 1,
            accountId: ids["1000"] as string,
            currency: "CAD",
            amount: "100",
            baseAmount: "100",
          },
          {
            organizationId: orgId,
            journalEntryId: entry?.id as string,
            lineNo: 2,
            accountId: ids.wise as string,
            currency: "USD",
            amount: "-73",
            baseAmount: "-99.99",
          },
        ]);
      }),
    );
    expect(message).toMatch(/does not balance/);
  });

  it("refuses a line whose currency doesn't match its account", async () => {
    const message = await pgErrorOf(
      scoped(async (tx) => {
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({ organizationId: orgId, entryNumber: 901, date: "2026-10-05", currency: "CAD" })
          .returning();
        await tx.insert(schema.journalLines).values([
          {
            organizationId: orgId,
            journalEntryId: entry?.id as string,
            lineNo: 1,
            accountId: ids.wise as string,
            currency: "CAD",
            amount: "10",
            baseAmount: "10",
          },
          {
            organizationId: orgId,
            journalEntryId: entry?.id as string,
            lineNo: 2,
            accountId: ids["4000"] as string,
            currency: "CAD",
            amount: "-10",
            baseAmount: "-10",
          },
        ]);
      }),
    );
    expect(message).toMatch(/only holds USD/);
  });
});

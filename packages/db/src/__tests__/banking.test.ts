import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addBankFeed,
  createConnection,
  disconnectConnection,
  type FeedLine,
  importBankLines,
  listConnections,
  setConnectionSecret,
} from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { upsertFxRates } from "../fx";
import { createDefaultChart } from "../ledger";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let orgA: string;
let orgB: string;
let cadBank: string;
let usdBank: string;
let fees: string;
let connectionId: string;
let cadFeed: string;
let usdFeed: string;
const inOrg = <T>(orgId: string, fn: (tx: Transaction) => Promise<T>) =>
  withOrg(app.db, { orgId }, fn);

const line = (over: Partial<FeedLine>): FeedLine => ({
  feedId: "",
  externalId: "",
  date: "2027-01-05",
  currency: "CAD",
  amount: "0",
  fee: "0.0000",
  description: "Synthetic bank line",
  counterparty: null,
  reference: null,
  kind: "other",
  ...over,
});

async function sync(lines: FeedLine[]) {
  return inOrg(orgA, (tx) =>
    importBankLines(tx, {
      orgId: orgA,
      baseCurrency: "CAD",
      feeAccountId: fees,
      feeds: new Map([
        [cadFeed, { accountId: cadBank }],
        [usdFeed, { accountId: usdBank }],
      ]),
      lines,
    }),
  );
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([
      { code: "CAD", name: "Canadian Dollar", minorUnits: 2 },
      { code: "USD", name: "US Dollar", minorUnits: 2 },
    ])
    .onConflictDoNothing();
  const [a, b] = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Bank A", slug: "bank-a", createdAt: new Date() },
      { name: "Bank B", slug: "bank-b", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  if (!a || !b) throw new Error("Failed to create organizations");
  orgA = a.id;
  orgB = b.id;
  await inOrg(orgA, (tx) => createDefaultChart(tx, { orgId: orgA, baseCurrency: "CAD" }));
  const [cad, usd, fee] = await inOrg(orgA, (tx) =>
    tx
      .insert(schema.accounts)
      .values([
        {
          organizationId: orgA,
          name: "Wise CAD",
          type: "asset",
          subtype: "cash_bank",
          currency: "CAD",
        },
        {
          organizationId: orgA,
          name: "Wise USD",
          type: "asset",
          subtype: "cash_bank",
          currency: "USD",
        },
        { organizationId: orgA, name: "Bank fees", type: "expense", subtype: "operating_expense" },
      ])
      .returning({ id: schema.accounts.id }),
  );
  cadBank = cad?.id as string;
  usdBank = usd?.id as string;
  fees = fee?.id as string;
  await inOrg(orgA, async (tx) => {
    connectionId = (
      await createConnection(tx, {
        orgId: orgA,
        provider: "wise",
        name: "Wise",
        settings: { profileId: 1 },
      })
    ).id;
    await setConnectionSecret(tx, connectionId, "v1.sealed.value.only");
    cadFeed = (
      await addBankFeed(tx, {
        orgId: orgA,
        connectionId,
        externalId: "10",
        currency: "CAD",
        name: "CAD",
        accountId: cadBank,
        syncFrom: "2027-01-01",
      })
    ).id;
    usdFeed = (
      await addBankFeed(tx, {
        orgId: orgA,
        connectionId,
        externalId: "20",
        currency: "USD",
        name: "USD",
        accountId: usdBank,
        syncFrom: "2027-01-01",
      })
    ).id;
  });
  await upsertFxRates(
    app.db,
    [{ date: "2027-01-04", base: "CAD", quote: "USD", rate: "1.4000" }],
    "Bank of Canada",
  );
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

const entriesOf = (orgId: string) =>
  inOrg(orgId, (tx) =>
    tx
      .select({
        id: schema.journalEntries.id,
        sourceId: schema.journalEntries.sourceId,
        memo: schema.journalEntries.memo,
      })
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.source, "bank_import")),
  );
const linesOf = (entryId: string) =>
  inOrg(orgA, (tx) =>
    tx
      .select({
        accountId: schema.journalLines.accountId,
        amount: schema.journalLines.amount,
        base: schema.journalLines.baseAmount,
      })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.journalEntryId, entryId)),
  );

describe("bank connections", () => {
  it("posts a card payment with its fee split out, and never twice", async () => {
    const card = line({
      feedId: cadFeed,
      externalId: "wise:10:CARD-1",
      amount: "-7.7600",
      fee: "0.0400",
      kind: "card",
      description: "Card at Example Cafe",
    });
    expect(await sync([card])).toEqual({ posted: 1, duplicates: 0, skipped: [] });
    expect(await sync([card])).toEqual({ posted: 0, duplicates: 1, skipped: [] });
    const [entry] = (await entriesOf(orgA)).filter((e) => e.sourceId === "wise:10:CARD-1");
    expect(entry?.memo).toBe("Card at Example Cafe");
    const lines = await linesOf(entry?.id as string);
    expect(lines.find((l) => l.accountId === cadBank)?.amount).toBe("-7.7600");
    expect(lines.find((l) => l.accountId === fees)?.amount).toBe("0.0400");
  });

  it("converts a foreign-currency line at the day's rate", async () => {
    const usdIn = line({
      feedId: usdFeed,
      externalId: "wise:20:TRANSFER-2",
      currency: "USD",
      amount: "100.0000",
      kind: "deposit",
    });
    expect((await sync([usdIn])).posted).toBe(1);
    const [entry] = (await entriesOf(orgA)).filter((e) => e.sourceId === "wise:20:TRANSFER-2");
    const bank = (await linesOf(entry?.id as string)).find((l) => l.accountId === usdBank);
    expect(bank).toMatchObject({ amount: "100.0000", base: "140.0000" });
  });

  it("records a conversion between two connected balances as one transfer", async () => {
    const out = line({
      feedId: cadFeed,
      externalId: "wise:10:CONVERSION-3",
      pairKey: "CONVERSION-3",
      amount: "-13.5000",
      kind: "conversion",
    });
    const into = line({
      feedId: usdFeed,
      externalId: "wise:20:CONVERSION-3",
      pairKey: "CONVERSION-3",
      currency: "USD",
      amount: "9.9400",
      kind: "conversion",
    });
    expect(await sync([out, into])).toEqual({ posted: 1, duplicates: 0, skipped: [] });
    const [entry] = (await entriesOf(orgA)).filter((e) => e.sourceId === "conversion:CONVERSION-3");
    const lines = await linesOf(entry?.id as string);
    expect(lines.find((l) => l.accountId === cadBank)).toMatchObject({
      amount: "-13.5000",
      base: "-13.5000",
    });
    // The base amount comes from the CAD side: the rate Wise actually gave.
    expect(lines.find((l) => l.accountId === usdBank)).toMatchObject({
      amount: "9.9400",
      base: "13.5000",
    });
    // Seen again (from either balance), it's a duplicate.
    expect(await sync([into])).toEqual({ posted: 0, duplicates: 1, skipped: [] });
  });

  it("leaves a line for later when there's no exchange rate yet", async () => {
    const late = line({
      feedId: usdFeed,
      externalId: "wise:20:CARD-9",
      currency: "USD",
      date: "2027-03-01",
      amount: "-5.0000",
      kind: "card",
    });
    const result = await sync([late]);
    expect(result.posted).toBe(0);
    expect(result.skipped).toEqual([
      {
        externalId: "wise:20:CARD-9",
        date: "2027-03-01",
        reason: "No USD exchange rate for 2027-03-01 yet.",
      },
    ]);
  });

  it("keeps connections to their company and lists syncable ones for the daily job", async () => {
    expect((await inOrg(orgA, (tx) => listConnections(tx))).map((c) => c.feeds.length)).toEqual([
      2,
    ]);
    expect(await inOrg(orgB, (tx) => listConnections(tx))).toEqual([]);
    expect(await entriesOf(orgB)).toEqual([]);
    const listed = await app.db.execute<{ organization_id: string; connection_id: string }>(
      sql`select * from syncable_connections()`,
    );
    expect(listed.rows).toContainEqual({ organization_id: orgA, connection_id: connectionId });
    await inOrg(orgA, (tx) => disconnectConnection(tx, connectionId));
    const after = await app.db.execute<{ connection_id: string }>(
      sql`select connection_id from syncable_connections()`,
    );
    expect(after.rows.map((r) => r.connection_id)).not.toContain(connectionId);
    // Imported transactions stay.
    expect((await entriesOf(orgA)).length).toBeGreaterThan(0);
  });
});

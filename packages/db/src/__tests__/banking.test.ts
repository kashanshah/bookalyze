import { prepareJournalEntry, transactionLines } from "@bookalyze/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addBankFeed,
  createConnection,
  disconnectConnection,
  type FeedLine,
  importBankLines,
  listConnections,
  recordStatementUpload,
  setConnectionSecret,
  statementFeedFor,
} from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import {
  acceptDuplicate,
  dismissDuplicate,
  listDuplicateSuggestions,
  mergeSelected,
} from "../duplicates";
import { upsertFxRates } from "../fx";
import { createDefaultChart, postJournalEntry } from "../ledger";
import { applyRuleToExisting, countRuleMatches, createRule, deleteRule, listRules } from "../rules";
import * as schema from "../schema";
import { replaceJournalEntry, voidJournalEntry } from "../transactions";

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
        settings: { profileId: 1, feeAccountId: fees },
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
        source: schema.journalEntries.source,
        reversedByEntryId: schema.journalEntries.reversedByEntryId,
      })
      .from(schema.journalEntries),
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
    expect(await sync([card])).toEqual({
      posted: 1,
      duplicates: 0,
      flagged: 0,
      categorized: 0,
      skipped: [],
    });
    expect(await sync([card])).toEqual({
      posted: 0,
      duplicates: 1,
      flagged: 0,
      categorized: 0,
      skipped: [],
    });
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
    expect(await sync([out, into])).toEqual({
      posted: 1,
      duplicates: 0,
      flagged: 0,
      categorized: 0,
      skipped: [],
    });
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
    expect(await sync([into])).toEqual({
      posted: 0,
      duplicates: 1,
      flagged: 0,
      categorized: 0,
      skipped: [],
    });
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

  it("tries a line that had no rate again on the next sync, and posts it once the rate exists", async () => {
    const late = line({
      feedId: usdFeed,
      externalId: "wise:20:CARD-9",
      currency: "USD",
      date: "2027-03-01",
      amount: "-5.0000",
      kind: "card",
    });
    await upsertFxRates(
      app.db,
      [{ date: "2027-02-27", base: "CAD", quote: "USD", rate: "1.4100" }],
      "Bank of Canada",
    );
    expect(await sync([late])).toMatchObject({ posted: 1, duplicates: 0, skipped: [] });
    expect(await sync([late])).toMatchObject({ posted: 0, duplicates: 1 });
  });

  async function existingExpense(date: string, amount: string, memo: string) {
    const all = await inOrg(orgA, (tx) => tx.select().from(schema.accounts));
    const rent = all.find((a) => a.code === "6350")?.id as string;
    const prepared = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: transactionLines({
          kind: "withdrawal",
          moneyAccountId: cadBank,
          splits: [{ accountId: rent, amount }],
        }),
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!prepared.ok) throw new Error("bad entry");
    const entry = prepared.entry;
    return inOrg(orgA, (tx) => postJournalEntry(tx, { orgId: orgA, date, memo, entry }));
  }

  const suggestions = () => inOrg(orgA, (tx) => listDuplicateSuggestions(tx));
  const bankLineOf = async (externalId: string) =>
    (
      await inOrg(orgA, (tx) =>
        tx.select().from(schema.bankLines).where(eq(schema.bankLines.externalId, externalId)),
      )
    )[0];
  const current = async (id: string) =>
    (await entriesOf(orgA)).some((e) => e.id === id && !e.reversedByEntryId);

  it("brings in a possible duplicate and flags it; merging keeps the one already in the books", async () => {
    const rent = await existingExpense("2027-01-30", "1200", "Rent entered by hand");
    const fromBank = line({
      feedId: cadFeed,
      externalId: "wise:10:TRANSFER-RENT",
      date: "2027-02-01",
      amount: "-1200.0000",
      kind: "transfer",
      description: "Sent to Example Landlord",
    });
    expect(await sync([fromBank])).toEqual({
      posted: 1,
      duplicates: 0,
      flagged: 1,
      categorized: 0,
      skipped: [],
    });
    const imported = (await bankLineOf("wise:10:TRANSFER-RENT"))?.journalEntryId as string;
    const [flag] = await suggestions();
    expect(flag).toMatchObject({
      entryId: imported,
      duplicateOf: { id: rent.id, memo: "Rent entered by hand", source: "manual" },
    });
    // Syncing again doesn't bring it in or flag it twice.
    expect(await sync([fromBank])).toMatchObject({ posted: 0, duplicates: 1, flagged: 0 });

    await inOrg(orgA, (tx) =>
      acceptDuplicate(tx, { orgId: orgA, suggestionId: flag?.id as string }),
    );
    expect(await suggestions()).toEqual([]);
    expect(await current(imported)).toBe(false);
    expect(await current(rent.id)).toBe(true);
    // The bank's transaction is now the one entered by hand.
    expect((await bankLineOf("wise:10:TRANSFER-RENT"))?.journalEntryId).toBe(rent.id);
    // Another payment of the same amount from the same bank is a different one: not flagged.
    const again = line({
      feedId: cadFeed,
      externalId: "wise:10:TRANSFER-RENT-2",
      date: "2027-02-01",
      amount: "-1200.0000",
      kind: "transfer",
    });
    expect(await sync([again])).toMatchObject({ posted: 1, flagged: 0 });
  });

  it("keeps both when they're different, and doesn't ask again", async () => {
    const lunch = await existingExpense("2027-04-10", "42", "Office lunch");
    const fromBank = line({
      feedId: cadFeed,
      externalId: "wise:10:CARD-LUNCH",
      date: "2027-04-11",
      amount: "-42.0000",
      kind: "card",
      description: "Card at Example Bistro",
    });
    expect(await sync([fromBank])).toMatchObject({ posted: 1, flagged: 1 });
    const [flag] = await suggestions();
    await inOrg(orgA, (tx) => dismissDuplicate(tx, { suggestionId: flag?.id as string }));
    expect(await suggestions()).toEqual([]);
    expect(await current(lunch.id)).toBe(true);
    expect(await current((await bankLineOf("wise:10:CARD-LUNCH"))?.journalEntryId as string)).toBe(
      true,
    );
    await expect(
      inOrg(orgA, (tx) => acceptDuplicate(tx, { orgId: orgA, suggestionId: flag?.id as string })),
    ).rejects.toThrow(/already been dealt with/);
  });

  it("flags a conversion that matches a transfer already in the books", async () => {
    const all = await inOrg(orgA, (tx) => tx.select().from(schema.accounts));
    const { prepareTransfer } = await import("@bookalyze/core");
    const prepared = prepareTransfer(
      {
        fromAccountId: cadBank,
        toAccountId: usdBank,
        sent: "140",
        received: "100",
        baseCurrency: "CAD",
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!prepared.ok) throw new Error("bad transfer");
    const entry = prepared.entry;
    const transfer = await inOrg(orgA, (tx) =>
      postJournalEntry(tx, { orgId: orgA, date: "2027-05-02", memo: "Moved to USD", entry }),
    );
    const out = line({
      feedId: cadFeed,
      externalId: "wise:10:CONVERSION-9",
      pairKey: "CONVERSION-9",
      date: "2027-05-02",
      amount: "-140.0000",
      kind: "conversion",
    });
    const into = line({
      feedId: usdFeed,
      externalId: "wise:20:CONVERSION-9",
      pairKey: "CONVERSION-9",
      date: "2027-05-02",
      currency: "USD",
      amount: "100.0000",
      kind: "conversion",
    });
    expect(await sync([out, into])).toMatchObject({ posted: 1, flagged: 1 });
    const [flag] = await suggestions();
    expect(flag?.duplicateOf.id).toBe(transfer.id);
    await inOrg(orgA, (tx) =>
      acceptDuplicate(tx, { orgId: orgA, suggestionId: flag?.id as string }),
    );
    expect((await bankLineOf("wise:20:CONVERSION-9"))?.journalEntryId).toBe(transfer.id);
  });

  it("keeps the bank link and the flag when a flagged transaction is categorized", async () => {
    await existingExpense("2027-06-01", "18", "Parking");
    const fromBank = line({
      feedId: cadFeed,
      externalId: "wise:10:CARD-PARK",
      date: "2027-06-01",
      amount: "-18.0000",
      kind: "card",
    });
    expect(await sync([fromBank])).toMatchObject({ flagged: 1 });
    const imported = (await bankLineOf("wise:10:CARD-PARK"))?.journalEntryId as string;
    const all = await inOrg(orgA, (tx) => tx.select().from(schema.accounts));
    const prepared = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: transactionLines({
          kind: "withdrawal",
          moneyAccountId: cadBank,
          splits: [{ accountId: all.find((a) => a.code === "6350")?.id as string, amount: "18" }],
        }),
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!prepared.ok) throw new Error("bad entry");
    const entry = prepared.entry;
    const edited = await inOrg(orgA, (tx) =>
      replaceJournalEntry(tx, { orgId: orgA, entryId: imported, date: "2027-06-01", entry }),
    );
    expect((await bankLineOf("wise:10:CARD-PARK"))?.journalEntryId).toBe(edited.id);
    const [flag] = await suggestions();
    expect(flag?.entryId).toBe(edited.id);
    expect((await entriesOf(orgA)).find((e) => e.id === edited.id)?.source).toBe("bank_import");
    await inOrg(orgA, (tx) => dismissDuplicate(tx, { suggestionId: flag?.id as string }));
  });

  it("merges two transactions picked by hand only when amount, account and category match", async () => {
    const first = await existingExpense("2027-07-01", "55", "Courier");
    const second = await existingExpense("2027-07-02", "55", "Courier again");
    const all = await inOrg(orgA, (tx) => tx.select().from(schema.accounts));
    const other = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: transactionLines({
          kind: "withdrawal",
          moneyAccountId: cadBank,
          splits: [{ accountId: fees, amount: "55" }],
        }),
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!other.ok) throw new Error("bad entry");
    const entry = other.entry;
    const third = await inOrg(orgA, (tx) =>
      postJournalEntry(tx, { orgId: orgA, date: "2027-07-02", memo: "Bank fee", entry }),
    );
    await expect(
      inOrg(orgA, (tx) => mergeSelected(tx, { orgId: orgA, entryIds: [first.id, third.id] })),
    ).rejects.toThrow(/same category/);
    const merged = await inOrg(orgA, (tx) =>
      mergeSelected(tx, { orgId: orgA, entryIds: [second.id, first.id] }),
    );
    expect(merged).toEqual({ keptId: first.id, removedId: second.id });
    expect(await current(second.id)).toBe(false);
  });

  it("brings in a statement file once, however often it's uploaded", async () => {
    const upload = (lines: FeedLine[]) => sync(lines);
    const feed = await inOrg(orgA, (tx) =>
      statementFeedFor(tx, {
        orgId: orgA,
        accountId: cadBank,
        accountName: "Bank statements",
        currency: "CAD",
        firstDate: "2027-08-01",
      }),
    );
    const rows = [
      line({
        feedId: feed.feedId,
        externalId: `csv:${cadBank}:2027-08-01:-3.5000:aa:0`,
        date: "2027-08-01",
        amount: "-3.5000",
      }),
      line({
        feedId: feed.feedId,
        externalId: `csv:${cadBank}:2027-08-01:-3.5000:aa:1`,
        date: "2027-08-01",
        amount: "-3.5000",
      }),
    ];
    expect(await upload(rows)).toMatchObject({ posted: 2, duplicates: 0 });
    expect(await upload(rows)).toMatchObject({ posted: 0, duplicates: 2 });
    await inOrg(orgA, (tx) =>
      recordStatementUpload(tx, feed.connectionId, { statement: { columns: { date: "Date" } } }),
    );
    // The same account gets the same feed (and its remembered columns) next time.
    const again = await inOrg(orgA, (tx) =>
      statementFeedFor(tx, {
        orgId: orgA,
        accountId: cadBank,
        accountName: "Bank statements",
        currency: "CAD",
        firstDate: "2027-09-01",
      }),
    );
    expect(again.feedId).toBe(feed.feedId);
    expect(again.settings).toEqual({ statement: { columns: { date: "Date" } } });
    // Uploads have no credentials, so the daily sync leaves them alone.
    const listed = await app.db.execute<{ connection_id: string }>(
      sql`select connection_id from syncable_connections()`,
    );
    expect(listed.rows.map((r) => r.connection_id)).not.toContain(feed.connectionId);
  });

  it("brings a removed statement transaction back when the file is uploaded again", async () => {
    const feed = await inOrg(orgA, (tx) =>
      statementFeedFor(tx, {
        orgId: orgA,
        accountId: cadBank,
        accountName: "Bank statements",
        currency: "CAD",
        firstDate: "2027-08-15",
      }),
    );
    const row = line({
      feedId: feed.feedId,
      externalId: `csv:${cadBank}:2027-08-15:-12.0000:bb:0`,
      date: "2027-08-15",
      amount: "-12.0000",
    });
    const rows = [row];
    expect(await sync(rows)).toMatchObject({ posted: 1, duplicates: 0 });
    const [posted] = await inOrg(orgA, (tx) =>
      tx.select().from(schema.bankLines).where(eq(schema.bankLines.externalId, row.externalId)),
    );
    await inOrg(orgA, (tx) =>
      voidJournalEntry(tx, { orgId: orgA, entryId: posted?.journalEntryId ?? "" }),
    );
    expect(await sync(rows)).toMatchObject({ posted: 1, duplicates: 0 });
    const [restored] = await inOrg(orgA, (tx) =>
      tx.select().from(schema.bankLines).where(eq(schema.bankLines.externalId, row.externalId)),
    );
    expect(restored?.journalEntryId).toBeTruthy();
    expect(restored?.journalEntryId).not.toBe(posted?.journalEntryId);
    const [entry] = await inOrg(orgA, (tx) =>
      tx
        .select({ reversedByEntryId: schema.journalEntries.reversedByEntryId })
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.id, restored?.journalEntryId ?? "")),
    );
    expect(entry?.reversedByEntryId).toBeNull();
    expect(await sync(rows)).toMatchObject({ posted: 0, duplicates: 1 });
  });

  it("leaves a removed transaction pending when it can't be posted again", async () => {
    const feed = await inOrg(orgA, (tx) =>
      statementFeedFor(tx, {
        orgId: orgA,
        accountId: cadBank,
        accountName: "Bank statements",
        currency: "CAD",
        firstDate: "2027-08-20",
      }),
    );
    const row = line({
      feedId: feed.feedId,
      externalId: `csv:${cadBank}:2027-08-20:-8.0000:cc:0`,
      date: "2027-08-20",
      amount: "-8.0000",
    });
    expect(await sync([row])).toMatchObject({ posted: 1, duplicates: 0 });
    const [posted] = await inOrg(orgA, (tx) =>
      tx.select().from(schema.bankLines).where(eq(schema.bankLines.externalId, row.externalId)),
    );
    const [expense] = await inOrg(orgA, (tx) =>
      tx
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.systemKey, "uncategorized_expense")),
    );
    await inOrg(orgA, async (tx) => {
      await voidJournalEntry(tx, { orgId: orgA, entryId: posted?.journalEntryId ?? "" });
      await tx
        .update(schema.accounts)
        .set({ isArchived: true })
        .where(eq(schema.accounts.id, expense?.id ?? ""));
    });
    try {
      const again = await sync([row]);
      expect(again.posted).toBe(0);
      expect(again.skipped[0]?.reason).toMatch(/archived/);
      const [held] = await inOrg(orgA, (tx) =>
        tx.select().from(schema.bankLines).where(eq(schema.bankLines.externalId, row.externalId)),
      );
      expect(held?.status).toBe("pending");
      expect(held?.journalEntryId).toBeNull();
    } finally {
      await inOrg(orgA, (tx) =>
        tx
          .update(schema.accounts)
          .set({ isArchived: false })
          .where(eq(schema.accounts.id, expense?.id ?? "")),
      );
    }
  });

  it("categorizes bank lines with rules as they arrive, and uncategorized ones on request", async () => {
    const all = await inOrg(orgA, (tx) => tx.select().from(schema.accounts));
    const phone = all.find((a) => a.code === "6350")?.id as string;
    const bell = (n: number, date: string) =>
      line({
        feedId: cadFeed,
        externalId: `wise:10:BELL-${n}`,
        date,
        amount: "-85.0000",
        kind: "card",
        description: "PAD Bell Canada",
      });
    expect(await sync([bell(1, "2027-09-01")])).toMatchObject({ posted: 1, categorized: 0 });
    const rule = await inOrg(orgA, (tx) =>
      createRule(tx, {
        orgId: orgA,
        matchText: "bell canada",
        direction: "out",
        amountMin: null,
        amountMax: null,
        accountId: null,
        categoryAccountId: phone,
        contactId: null,
        isActive: true,
      }),
    );
    expect(await inOrg(orgA, (tx) => countRuleMatches(tx, rule))).toBe(1);

    // A new one arrives already in the rule's category.
    expect(await sync([bell(2, "2027-10-01")])).toMatchObject({ posted: 1, categorized: 1 });
    const second = (await bankLineOf("wise:10:BELL-2"))?.journalEntryId as string;
    expect(await linesOf(second)).toContainEqual({
      accountId: phone,
      amount: "85.0000",
      base: "85.0000",
    });

    // The one already in the books is categorized on request, keeping its bank link.
    expect(
      await inOrg(orgA, (tx) => applyRuleToExisting(tx, { orgId: orgA, ruleId: rule.id })),
    ).toEqual({ categorized: 1, skipped: 0 });
    const first = (await bankLineOf("wise:10:BELL-1"))?.journalEntryId as string;
    expect((await linesOf(first)).map((l) => l.accountId)).toContain(phone);
    expect(await inOrg(orgA, (tx) => countRuleMatches(tx, rule))).toBe(0);
    expect((await inOrg(orgA, (tx) => listRules(tx)))[0]?.applied).toBe(2);
    // Rules belong to their company.
    expect(await inOrg(orgB, (tx) => listRules(tx))).toEqual([]);
    await inOrg(orgA, (tx) => deleteRule(tx, rule.id));
    expect(await inOrg(orgA, (tx) => listRules(tx))).toEqual([]);
  });

  it("keeps connections to their company and lists syncable ones for the daily job", async () => {
    expect(
      (await inOrg(orgA, (tx) => listConnections(tx)))
        .filter((c) => c.provider === "wise")
        .map((c) => c.feeds.length),
    ).toEqual([2]);
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

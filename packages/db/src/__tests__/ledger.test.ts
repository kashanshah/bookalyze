import { prepareJournalEntry } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import {
  accountBalances,
  createDefaultChart,
  formatEntryNumber,
  postJournalEntry,
  reverseJournalEntry,
} from "../ledger";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";

const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

async function pgErrorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message ?? String(error);
  }
  throw new Error("Expected the query to fail");
}

let orgA: string;
let orgB: string;
const acct: Record<string, string> = {};
let nextNumber = 1;

async function addAccount(orgId: string, key: string, type: "asset" | "income", subtype: string) {
  const [row] = await withOrg(app.db, { orgId }, (tx) =>
    tx
      .insert(schema.accounts)
      .values({ organizationId: orgId, name: key, type, subtype })
      .returning({ id: schema.accounts.id }),
  );
  if (!row) throw new Error("Failed to create account");
  acct[key] = row.id;
}

/** Inserts an entry and its lines in one transaction, as the server does. */
function post(
  orgId: string,
  lines: { accountId: string; amount: string; baseAmount?: string; currency?: string }[],
  extra: (tx: Transaction, entryId: string) => Promise<unknown> = async () => {},
) {
  return withOrg(app.db, { orgId }, async (tx) => {
    const [entry] = await tx
      .insert(schema.journalEntries)
      .values({
        organizationId: orgId,
        entryNumber: nextNumber++,
        date: "2026-07-01",
        currency: "CAD",
      })
      .returning({ id: schema.journalEntries.id });
    if (!entry) throw new Error("Failed to create entry");
    if (lines.length) {
      await tx.insert(schema.journalLines).values(
        lines.map((l, i) => ({
          organizationId: orgId,
          journalEntryId: entry.id,
          lineNo: i + 1,
          accountId: l.accountId,
          currency: l.currency ?? "CAD",
          amount: l.amount,
          baseAmount: l.baseAmount ?? l.amount,
        })),
      );
    }
    await extra(tx, entry.id);
    return entry.id;
  });
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  await owner.db
    .insert(schema.countries)
    .values({ code: "CA", name: "Canada", currencyCode: "CAD" })
    .onConflictDoNothing();
  const [a, b] = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Ledger A", slug: "ledger-a", createdAt: new Date() },
      { name: "Ledger B", slug: "ledger-b", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  if (!a || !b) throw new Error("Failed to create test organizations");
  orgA = a.id;
  orgB = b.id;
  await addAccount(orgA, "bank", "asset", "cash_bank");
  await addAccount(orgA, "sales", "income", "income");
  await addAccount(orgB, "otherBank", "asset", "cash_bank");
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("ledger invariants", () => {
  it("accepts a balanced entry", async () => {
    const id = await post(orgA, [
      { accountId: acct.bank as string, amount: "100.0000" },
      { accountId: acct.sales as string, amount: "-100.0000" },
    ]);
    const lines = await withOrg(app.db, { orgId: orgA }, (tx) =>
      tx.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, id)),
    );
    expect(lines.map((l) => l.amount).sort()).toEqual(["-100.0000", "100.0000"]);
  });

  it("rejects entries that don't balance, in either currency", async () => {
    expect(
      await pgErrorOf(
        post(orgA, [
          { accountId: acct.bank as string, amount: "100" },
          { accountId: acct.sales as string, amount: "-99.99" },
        ]),
      ),
    ).toMatch(/does not balance/);
    expect(
      await pgErrorOf(
        post(orgA, [
          { accountId: acct.bank as string, amount: "100", baseAmount: "136.50" },
          { accountId: acct.sales as string, amount: "-100", baseAmount: "-136.49" },
        ]),
      ),
    ).toMatch(/does not balance/);
  });

  it("rejects entries with fewer than two lines", async () => {
    expect(await pgErrorOf(post(orgA, []))).toMatch(/at least two lines/);
  });

  it("keeps posted entries and lines immutable", async () => {
    const id = await post(orgA, [
      { accountId: acct.bank as string, amount: "5" },
      { accountId: acct.sales as string, amount: "-5" },
    ]);
    const scoped = (fn: (tx: Transaction) => Promise<unknown>) =>
      withOrg(app.db, { orgId: orgA }, fn);
    expect(
      await pgErrorOf(
        scoped((tx) =>
          tx
            .update(schema.journalLines)
            .set({ amount: "6" })
            .where(eq(schema.journalLines.journalEntryId, id)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgErrorOf(
        scoped((tx) =>
          tx.delete(schema.journalLines).where(eq(schema.journalLines.journalEntryId, id)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgErrorOf(
        scoped((tx) =>
          tx
            .update(schema.journalEntries)
            .set({ memo: "edited" })
            .where(eq(schema.journalEntries.id, id)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgErrorOf(
        scoped((tx) => tx.delete(schema.journalEntries).where(eq(schema.journalEntries.id, id))),
      ),
    ).toMatch(/permission denied/);
  });

  it("links a reversal once and never again", async () => {
    const original = await post(orgA, [
      { accountId: acct.bank as string, amount: "7" },
      { accountId: acct.sales as string, amount: "-7" },
    ]);
    const reversal = await post(
      orgA,
      [
        { accountId: acct.bank as string, amount: "-7" },
        { accountId: acct.sales as string, amount: "7" },
      ],
      (tx, id) =>
        tx
          .update(schema.journalEntries)
          .set({ reversedByEntryId: id })
          .where(eq(schema.journalEntries.id, original)),
    );
    expect(reversal).toBeTruthy();
    expect(
      await pgErrorOf(
        withOrg(app.db, { orgId: orgA }, (tx) =>
          tx
            .update(schema.journalEntries)
            .set({ reversedByEntryId: null })
            .where(eq(schema.journalEntries.id, original)),
        ),
      ),
    ).toMatch(/already been reversed/);
  });

  it("cannot post to another organization's account", async () => {
    const message = await pgErrorOf(
      post(orgA, [
        { accountId: acct.otherBank as string, amount: "1" },
        { accountId: acct.sales as string, amount: "-1" },
      ]),
    );
    expect(message).toMatch(/foreign key/);
  });

  it("isolates accounts and entries per organization", async () => {
    const accountsB = await withOrg(app.db, { orgId: orgB }, (tx) =>
      tx.select().from(schema.accounts),
    );
    expect(accountsB.map((a) => a.name)).toEqual(["otherBank"]);
    const entriesB = await withOrg(app.db, { orgId: orgB }, (tx) =>
      tx.select().from(schema.journalEntries),
    );
    expect(entriesB).toEqual([]);
  });

  it("rejects unknown account types and subtypes", async () => {
    const message = await pgErrorOf(
      withOrg(app.db, { orgId: orgA }, (tx) =>
        tx
          .insert(schema.accounts)
          .values({ organizationId: orgA, name: "Bad", type: "asset", subtype: "not_a_subtype" }),
      ),
    );
    expect(message).toMatch(/accounts_subtype_valid/);
  });

  it("still lets an organization be deleted with its books", async () => {
    await owner.db.delete(schema.organization).where(eq(schema.organization.id, orgA));
    const left = await owner.db
      .select()
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.organizationId, orgA));
    expect(left).toEqual([]);
  });
});

describe("ledger helpers", () => {
  let orgC: string;
  const scoped = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId: orgC }, fn);

  beforeAll(async () => {
    const [c] = await owner.db
      .insert(schema.organization)
      .values({ name: "Ledger C", slug: "ledger-c", createdAt: new Date() })
      .returning({ id: schema.organization.id });
    if (!c) throw new Error("Failed to create test organization");
    orgC = c.id;
  });

  it("creates the default chart once, with bank accounts in the base currency", async () => {
    expect(await scoped((tx) => createDefaultChart(tx, { orgId: orgC, baseCurrency: "CAD" }))).toBe(
      33,
    );
    expect(await scoped((tx) => createDefaultChart(tx, { orgId: orgC, baseCurrency: "CAD" }))).toBe(
      0,
    );
    const cash = await scoped((tx) =>
      tx.select().from(schema.accounts).where(eq(schema.accounts.code, "1000")),
    );
    expect(cash[0]?.currency).toBe("CAD");
  });

  it("posts, numbers, reverses and totals entries", async () => {
    const all = await scoped((tx) => tx.select().from(schema.accounts));
    const byCode = new Map(all.map((a) => [a.code, a]));
    const map = new Map(all.map((a) => [a.id, { ...a }]));
    const cash = byCode.get("1000")?.id as string;
    const rent = byCode.get("6350")?.id as string;
    const prepared = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: [
          { accountId: rent, debit: "1500" },
          { accountId: cash, credit: "1500" },
        ],
      },
      map,
    );
    if (!prepared.ok) throw new Error("expected a valid entry");

    const first = await scoped((tx) =>
      postJournalEntry(tx, { orgId: orgC, date: "2026-07-01", entry: prepared.entry }),
    );
    const second = await scoped((tx) =>
      postJournalEntry(tx, { orgId: orgC, date: "2026-08-01", entry: prepared.entry }),
    );
    expect([first.entryNumber, second.entryNumber]).toEqual([1, 2]);
    expect(formatEntryNumber(second.entryNumber)).toBe("JE-0002");

    const reversal = await scoped((tx) =>
      reverseJournalEntry(tx, { orgId: orgC, entryId: second.id, date: "2026-08-02" }),
    );
    expect(reversal.entryNumber).toBe(3);
    await expect(
      scoped((tx) =>
        reverseJournalEntry(tx, { orgId: orgC, entryId: second.id, date: "2026-08-03" }),
      ),
    ).rejects.toThrow(/already been reversed/);

    const balances = await scoped((tx) => accountBalances(tx));
    const rentBalance = balances.find((b) => b.accountId === rent)?.balance;
    expect(rentBalance).toBe("1500.0000");
    const july = await scoped((tx) =>
      accountBalances(tx, { from: "2026-07-01", to: "2026-07-31" }),
    );
    expect(july.find((b) => b.accountId === cash)?.balance).toBe("-1500.0000");
    const august = await scoped((tx) => accountBalances(tx, { from: "2026-08-01" }));
    expect(august.find((b) => b.accountId === rent)?.balance).toBe("0.0000");
  });
});

describe("closed periods and the main currency", () => {
  let orgD: string;
  let entry: Awaited<ReturnType<typeof postJournalEntry>>;
  const scoped = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId: orgD }, fn);

  beforeAll(async () => {
    const [d] = await owner.db
      .insert(schema.organization)
      .values({ name: "Ledger D", slug: "ledger-d", createdAt: new Date() })
      .returning({ id: schema.organization.id });
    if (!d) throw new Error("Failed to create test organization");
    orgD = d.id;
    await owner.db.insert(schema.organizationProfiles).values({
      organizationId: orgD,
      legalName: "Ledger D Inc.",
      countryCode: "CA",
      baseCurrency: "CAD",
      timezone: "America/Toronto",
      locale: "en-CA",
    });
    await scoped((tx) => createDefaultChart(tx, { orgId: orgD, baseCurrency: "CAD" }));
  });

  const prepared = async () => {
    const all = await scoped((tx) => tx.select().from(schema.accounts));
    const byCode = new Map(all.map((a) => [a.code, a.id]));
    const result = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: [
          { accountId: byCode.get("6350") as string, debit: "10" },
          { accountId: byCode.get("1000") as string, credit: "10" },
        ],
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!result.ok) throw new Error("expected a valid entry");
    return result.entry;
  };

  it("refuses entries dated in a closed period, in code and in the database", async () => {
    const e = await prepared();
    entry = await scoped((tx) =>
      postJournalEntry(tx, { orgId: orgD, date: "2026-06-30", entry: e }),
    );
    await scoped((tx) =>
      tx.update(schema.organizationProfiles).set({ booksLockedThrough: "2026-06-30" }),
    );

    await expect(
      scoped((tx) => postJournalEntry(tx, { orgId: orgD, date: "2026-06-30", entry: e })),
    ).rejects.toMatchObject({ code: "period_locked", lockedThrough: "2026-06-30" });

    // Bypassing the helper still hits the trigger.
    const message = await pgErrorOf(
      scoped((tx) =>
        tx.insert(schema.journalEntries).values({
          organizationId: orgD,
          entryNumber: 99,
          date: "2026-01-15",
          currency: "CAD",
        }),
      ),
    );
    expect(message).toMatch(/closed through 2026-06-30/);

    const next = await scoped((tx) =>
      postJournalEntry(tx, { orgId: orgD, date: "2026-07-01", entry: e }),
    );
    expect(next.entryNumber).toBe(2);
  });

  it("dates reversals in the open period only", async () => {
    await expect(
      scoped((tx) =>
        reverseJournalEntry(tx, { orgId: orgD, entryId: entry.id, date: "2026-06-30" }),
      ),
    ).rejects.toMatchObject({ code: "period_locked" });
    const reversal = await scoped((tx) =>
      reverseJournalEntry(tx, { orgId: orgD, entryId: entry.id, date: "2026-07-02" }),
    );
    expect(reversal.entryNumber).toBe(3);
  });

  it("locks the main currency once there are entries", async () => {
    const message = await pgErrorOf(
      scoped((tx) => tx.update(schema.organizationProfiles).set({ baseCurrency: "USD" })),
    );
    expect(message).toMatch(/main currency can't change/);
  });
});

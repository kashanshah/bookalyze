import { prepareJournalEntry } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import {
  completeImportBatch,
  createImportAccounts,
  createImportBatch,
  createImportContacts,
  listImportBatches,
  postImportedEntries,
  receiptCandidates,
  undoImportBatch,
} from "../imports";
import { createDefaultChart, postJournalEntry, reverseJournalEntry } from "../ledger";
import * as schema from "../schema";
import { replaceJournalEntry } from "../transactions";

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
const code: Record<string, string> = {};
const inA = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId: orgA }, fn);

async function pgErrorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(error);
  }
  throw new Error("Expected the query to fail");
}

async function entry(lines: [string, string][]) {
  const all = await inA((tx) => tx.select().from(schema.accounts));
  const result = prepareJournalEntry(
    {
      currency: "CAD",
      baseCurrency: "CAD",
      lines: lines.map(([accountId, amount]) =>
        amount.startsWith("-")
          ? { accountId, credit: amount.slice(1) }
          : { accountId, debit: amount },
      ),
    },
    new Map(all.map((a) => [a.id, a])),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.entry;
}

/** A small import: a new bank account, a customer, and two sales. */
async function runImport(fileName: string) {
  const batch = await inA((tx) => createImportBatch(tx, { orgId: orgA, source: "wave", fileName }));
  const accountIds = await inA((tx) =>
    createImportAccounts(tx, {
      orgId: orgA,
      batchId: batch.id,
      baseCurrency: "CAD",
      accounts: [{ key: "|old bank", name: "Old Bank", code: "1000", subtype: "cash_bank" }],
    }),
  );
  const { ids: contactIds } = await inA((tx) =>
    createImportContacts(tx, {
      orgId: orgA,
      batchId: batch.id,
      contacts: [{ key: "acme", name: "Acme Imports", role: "customer" }],
    }),
  );
  const bank = accountIds["|old bank"] as string;
  const entries = [
    {
      externalId: "wave:1",
      date: "2023-03-01",
      memo: "Sale 1",
      contactId: contactIds.acme ?? null,
      entry: await entry([
        [bank, "100"],
        [code["4000"] as string, "-100"],
      ]),
    },
    {
      externalId: "wave:2",
      date: "2023-02-01",
      memo: "Sale 2",
      entry: await entry([
        [bank, "50"],
        [code["4000"] as string, "-50"],
      ]),
    },
  ];
  const result = await inA((tx) =>
    postImportedEntries(tx, { orgId: orgA, batchId: batch.id, entries }),
  );
  const done = await inA((tx) => completeImportBatch(tx, batch.id));
  return { batch: done, result, bank, contactId: contactIds.acme as string };
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
      { name: "Import A", slug: "import-a", createdAt: new Date() },
      { name: "Import B", slug: "import-b", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  if (!a || !b) throw new Error("Failed to create organizations");
  orgA = a.id;
  orgB = b.id;
  await owner.db.insert(schema.organizationProfiles).values({
    organizationId: orgA,
    legalName: "Import A Inc.",
    countryCode: "CA",
    baseCurrency: "CAD",
    timezone: "America/Toronto",
    locale: "en-CA",
  });
  await inA((tx) => createDefaultChart(tx, { orgId: orgA, baseCurrency: "CAD" }));
  for (const acct of await inA((tx) => tx.select().from(schema.accounts))) {
    if (acct.code) code[acct.code] = acct.id;
  }
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("imports", () => {
  it("imports entries in date order, records the batch, and skips them on a second run", async () => {
    const first = await runImport("wave-2023.csv");
    expect(first.result).toEqual({ posted: 2, skipped: 0 });
    expect(first.batch).toMatchObject({
      status: "completed",
      entryCount: 2,
      accountCount: 1,
      contactCount: 1,
      firstDate: "2023-02-01",
      lastDate: "2023-03-01",
    });
    const posted = await inA((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.importBatchId, first.batch?.id as string))
        .orderBy(schema.journalEntries.entryNumber),
    );
    expect(posted.map((e) => [e.date, e.source, e.sourceId])).toEqual([
      ["2023-02-01", "import", "wave:2"],
      ["2023-03-01", "import", "wave:1"],
    ]);
    // A clashing code was dropped: the default chart already has 1000.
    const [bank] = await inA((tx) =>
      tx.select().from(schema.accounts).where(eq(schema.accounts.id, first.bank)),
    );
    expect(bank).toMatchObject({ code: null, currency: "CAD", subtype: "cash_bank" });

    const second = await runImport("wave-2023.csv");
    expect(second.result).toEqual({ posted: 0, skipped: 2 });
    // The second run reused the customer instead of creating a duplicate.
    expect(second.contactId).toBe(first.contactId);
    expect(second.batch).toMatchObject({ entryCount: 0, skippedCount: 2, contactCount: 0 });

    // Other organizations see none of it.
    const other = await withOrg(app.db, { orgId: orgB }, (tx) => listImportBatches(tx));
    expect(other).toEqual([]);
  });

  it("undoes an import completely, keeping what's used elsewhere", async () => {
    const batches = await inA((tx) => listImportBatches(tx));
    const target = batches.find((b) => b.entryCount === 2);
    if (!target) throw new Error("no batch");
    const removed = await inA((tx) => undoImportBatch(tx, target.id));
    expect(removed).toBe(2);
    const left = await inA((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.importBatchId, target.id)),
    );
    expect(left).toEqual([]);
    const [batch] = await inA((tx) =>
      tx.select().from(schema.importBatches).where(eq(schema.importBatches.id, target.id)),
    );
    expect(batch?.status).toBe("undone");
    // The imported bank account and customer are gone (nothing else used them).
    const banks = await inA((tx) =>
      tx.select().from(schema.accounts).where(eq(schema.accounts.importBatchId, target.id)),
    );
    expect(banks).toEqual([]);
    // Undoing twice is refused.
    expect(await pgErrorOf(inA((tx) => undoImportBatch(tx, target.id)))).toMatch(/not found/);
  });

  it("refuses to undo once an imported entry has been changed, or from another organization", async () => {
    const { batch } = await runImport("again.csv");
    const [imported] = await inA((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.importBatchId, batch?.id as string)),
    );
    expect(
      await pgErrorOf(
        withOrg(app.db, { orgId: orgB }, (tx) => undoImportBatch(tx, batch?.id as string)),
      ),
    ).toMatch(/not found/);
    await inA((tx) =>
      reverseJournalEntry(tx, { orgId: orgA, entryId: imported?.id as string, date: "2023-04-01" }),
    );
    expect(await pgErrorOf(inA((tx) => undoImportBatch(tx, batch?.id as string)))).toMatch(
      /changed since/,
    );
  });

  it("brings back a removed entry when the file is imported again, but never an edited one", async () => {
    // The test above removed one of the two entries: importing again brings just that one back.
    const again = await runImport("third.csv");
    expect(again.result).toEqual({ posted: 1, skipped: 1 });
    const current = async () =>
      (
        await inA((tx) =>
          tx.select().from(schema.journalEntries).where(eq(schema.journalEntries.source, "import")),
        )
      ).filter((e) => !e.reversedByEntryId);
    const [first, second] = await current();
    expect((await current()).map((e) => e.sourceId).sort()).toEqual(["wave:1", "wave:2"]);

    // Edited now: the replacement keeps the ID.
    await inA((tx) =>
      replaceJournalEntry(tx, {
        orgId: orgA,
        entryId: first?.id as string,
        date: first?.date as string,
        memo: first?.memo,
        entry: {
          currency: "CAD",
          fxRate: "1",
          total: "100.0000",
          lines: [
            {
              index: 0,
              accountId: code["1000"] ?? (code["4000"] as string),
              description: null,
              currency: "CAD",
              amount: "100.0000",
              baseAmount: "100.0000",
            },
            {
              index: 1,
              accountId: code["4000"] as string,
              description: null,
              currency: "CAD",
              amount: "-100.0000",
              baseAmount: "-100.0000",
            },
          ],
        },
      }),
    );
    // Edited before edits kept the ID: reversal and replacement posted together.
    await inA(async (tx) => {
      await reverseJournalEntry(tx, {
        orgId: orgA,
        entryId: second?.id as string,
        date: second?.date as string,
      });
      await postJournalEntry(tx, {
        orgId: orgA,
        date: second?.date as string,
        memo: second?.memo,
        entry: await entry([
          [code["4000"] as string, "-50"],
          [code["1000"] ?? (code["4000"] as string), "50"],
        ]),
      });
    });
    const last = await runImport("fourth.csv");
    expect(last.result).toEqual({ posted: 0, skipped: 2 });
  });

  it("refuses entries dated in a closed period", async () => {
    await owner.db
      .update(schema.organizationProfiles)
      .set({ booksLockedThrough: "2023-12-31" })
      .where(eq(schema.organizationProfiles.organizationId, orgA));
    const batch = await inA((tx) =>
      createImportBatch(tx, { orgId: orgA, source: "wave", fileName: "x.csv" }),
    );
    const error = await inA((tx) =>
      entry([
        [code["1000"] as string, "1"],
        [code["4000"] as string, "-1"],
      ]).then((e) =>
        postImportedEntries(tx, {
          orgId: orgA,
          batchId: batch.id,
          entries: [{ externalId: "wave:old", date: "2023-06-01", entry: e }],
        }),
      ),
    ).catch((e: Error) => e.message);
    expect(error).toMatch(/closed through 2023-12-31/);
    await owner.db
      .update(schema.organizationProfiles)
      .set({ booksLockedThrough: null })
      .where(eq(schema.organizationProfiles.organizationId, orgA));
  });

  it("fills in contact details from lists without overwriting what's there", async () => {
    const batch = await inA((tx) =>
      createImportBatch(tx, { orgId: orgA, source: "wave", fileName: "customers.csv" }),
    );
    const [existing] = await inA((tx) =>
      tx
        .insert(schema.contacts)
        .values({ organizationId: orgA, type: "vendor", name: "Detail Test Co", phone: "111" })
        .returning(),
    );
    const result = await inA((tx) =>
      createImportContacts(tx, {
        orgId: orgA,
        batchId: batch.id,
        contacts: [
          {
            key: "detail test co",
            name: "Detail Test Co",
            role: "vendor",
            phone: "222",
            email: "a@b.example",
          },
          { key: "listed only", name: "Listed Only", role: "customer", address: "1 Example St." },
        ],
      }),
    );
    expect(result).toMatchObject({ created: 1, updated: 1 });
    const [after] = await inA((tx) =>
      tx
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.id, existing?.id as string)),
    );
    expect(after).toMatchObject({ phone: "111", email: "a@b.example" });
  });

  it("lists current transactions near a date for matching receipts", async () => {
    const found = await inA((tx) =>
      receiptCandidates(tx, { from: "2023-02-28", to: "2023-03-02" }),
    );
    expect(found.some((c) => c.date === "2023-03-01" && c.text.includes("Sale 1"))).toBe(true);
  });
});

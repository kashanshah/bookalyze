import { prepareJournalEntry, type TransactionInput, transactionLines } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { contactOptions, contactTotals, listContacts } from "../contacts";
import { createDefaultChart, postJournalEntry } from "../ledger";
import * as schema from "../schema";
import { listTransactions, replaceJournalEntry, voidJournalEntry } from "../transactions";

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

async function prepared(input: TransactionInput) {
  const all = await inA((tx) => tx.select().from(schema.accounts));
  const result = prepareJournalEntry(
    { currency: "CAD", baseCurrency: "CAD", lines: transactionLines(input) },
    new Map(all.map((a) => [a.id, a])),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.entry;
}

async function addContact(orgId: string, type: "customer" | "vendor" | "both", name: string) {
  const [row] = await withOrg(app.db, { orgId }, (tx) =>
    tx.insert(schema.contacts).values({ organizationId: orgId, type, name }).returning(),
  );
  if (!row) throw new Error("no contact");
  return row.id;
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [a, b] = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Contacts A", slug: "contacts-a", createdAt: new Date() },
      { name: "Contacts B", slug: "contacts-b", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  if (!a || !b) throw new Error("Failed to create organizations");
  orgA = a.id;
  orgB = b.id;
  await inA((tx) => createDefaultChart(tx, { orgId: orgA, baseCurrency: "CAD" }));
  for (const acct of await inA((tx) => tx.select().from(schema.accounts))) {
    if (acct.code) code[acct.code] = acct.id;
  }
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("contacts", () => {
  it("keeps names unique per type, case-insensitively, and per organization", async () => {
    await addContact(orgA, "customer", "Acme Corp");
    expect(await pgErrorOf(addContact(orgA, "customer", "ACME corp"))).toMatch(
      /contacts_org_type_name_key/,
    );
    await addContact(orgA, "vendor", "Acme Corp"); // same name as a vendor is fine
    await addContact(orgB, "customer", "Acme Corp"); // another organization is fine
    expect(
      (await withOrg(app.db, { orgId: orgB }, (tx) => listContacts(tx))).map((c) => c.name),
    ).toEqual(["Acme Corp"]);
  });

  it("totals money received and paid per contact, ignoring reversed entries", async () => {
    const client = await addContact(orgA, "customer", "Northwind");
    const supplier = await addContact(orgA, "vendor", "Staples");
    const sale = await prepared({
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "500" }],
    });
    const first = await inA((tx) =>
      postJournalEntry(tx, { orgId: orgA, date: "2026-07-01", contactId: client, entry: sale }),
    );
    await inA((tx) =>
      postJournalEntry(tx, { orgId: orgA, date: "2026-08-01", contactId: client, entry: sale }),
    );
    const purchase = await prepared({
      kind: "withdrawal",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["6250"] as string, amount: "42.10" }],
    });
    await inA((tx) =>
      postJournalEntry(tx, {
        orgId: orgA,
        date: "2026-07-05",
        contactId: supplier,
        entry: purchase,
      }),
    );

    expect(await inA((tx) => contactTotals(tx, client))).toEqual({
      received: "1000.0000",
      paid: "0.0000",
      transactions: 2,
    });
    expect(await inA((tx) => contactTotals(tx, client, { from: "2026-08-01" }))).toMatchObject({
      received: "500.0000",
    });
    expect(await inA((tx) => contactTotals(tx, supplier))).toEqual({
      received: "0.0000",
      paid: "42.1000",
      transactions: 1,
    });

    // Edit one sale (keeps the customer), then remove the other: only the edit counts.
    const bigger = await prepared({
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "650" }],
    });
    await inA((tx) =>
      replaceJournalEntry(tx, {
        orgId: orgA,
        entryId: first.id,
        date: "2026-07-01",
        contactId: client,
        entry: bigger,
      }),
    );
    const { rows } = await inA((tx) =>
      listTransactions(tx, { contactId: client, limit: 10, offset: 0 }),
    );
    expect(rows.map((r) => r.view.amount)).toEqual(["500.0000", "650.0000"]);
    const second = rows[0];
    if (!second) throw new Error("missing");
    await inA((tx) => voidJournalEntry(tx, { orgId: orgA, entryId: second.id }));
    expect(await inA((tx) => contactTotals(tx, client))).toMatchObject({
      received: "650.0000",
      transactions: 1,
    });

    const customers = await inA((tx) => listContacts(tx, { type: "customer" }));
    expect(customers.map((c) => [c.name, c.received])).toEqual([
      ["Acme Corp", "0.0000"],
      ["Northwind", "650.0000"],
    ]);
    expect((await inA((tx) => listContacts(tx, { search: "stap" }))).map((c) => c.name)).toEqual([
      "Staples",
    ]);
  });

  it("can't link an entry to another organization's contact", async () => {
    const [foreign] = await withOrg(app.db, { orgId: orgB }, (tx) =>
      tx.select().from(schema.contacts),
    );
    const sale = await prepared({
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "1" }],
    });
    const message = await pgErrorOf(
      inA((tx) =>
        postJournalEntry(tx, {
          orgId: orgA,
          date: "2026-07-03",
          contactId: foreign?.id,
          entry: sale,
        }),
      ),
    );
    expect(message).toMatch(/journal_entries_contact_fk/);
  });

  it("offers active contacts in pickers", async () => {
    await inA((tx) =>
      tx
        .update(schema.contacts)
        .set({ isArchived: true })
        .where(eq(schema.contacts.name, "Staples")),
    );
    expect((await inA((tx) => contactOptions(tx))).map((c) => c.name)).not.toContain("Staples");
  });
});

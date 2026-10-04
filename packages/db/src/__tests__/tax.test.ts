import {
  defaultPackRates,
  prepareJournalEntry,
  type TaxRateInfo,
  type TransactionInput,
  taxPackFor,
  transactionLines,
} from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry } from "../ledger";
import * as schema from "../schema";
import { applyTaxPack, listTaxRates, salesTaxRows } from "../tax";
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

async function rateMap(): Promise<Map<string, TaxRateInfo>> {
  const rates = await inA((tx) => listTaxRates(tx));
  return new Map(
    rates.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        rate: r.rate,
        accountId: r.accountId,
        isRecoverable: r.isRecoverable,
      },
    ]),
  );
}

async function rateId(name: string) {
  const rates = await inA((tx) => listTaxRates(tx));
  const found = rates.find((r) => r.name === name);
  if (!found) throw new Error(`no rate ${name}`);
  return found.id;
}

async function prepared(input: TransactionInput) {
  const all = await inA((tx) => tx.select().from(schema.accounts));
  const result = prepareJournalEntry(
    {
      currency: "CAD",
      baseCurrency: "CAD",
      lines: transactionLines(input, undefined, { rates: await rateMap(), decimals: 2 }),
    },
    new Map(all.map((a) => [a.id, a])),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.entry;
}

async function post(date: string, input: TransactionInput) {
  const entry = await prepared(input);
  return inA((tx) => postJournalEntry(tx, { orgId: orgA, date, entry }));
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [a, b] = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Tax A", slug: "tax-a", createdAt: new Date() },
      { name: "Tax B", slug: "tax-b", createdAt: new Date() },
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

describe("sales tax", () => {
  it("sets up a country pack once, creating its tax account", async () => {
    const pack = taxPackFor("CA");
    if (!pack) throw new Error("no pack");
    const rates = defaultPackRates(pack, "CA-ON");
    const first = await inA((tx) => applyTaxPack(tx, { orgId: orgA, pack, rates }));
    expect(first.added).toBe(3);
    const again = await inA((tx) => applyTaxPack(tx, { orgId: orgA, pack, rates }));
    expect(again.added).toBe(0);
    expect(again.accountIds.gst_hst).toBe(first.accountIds.gst_hst);

    const listed = await inA((tx) => listTaxRates(tx));
    expect(listed.map((r) => r.name).sort()).toEqual([
      "GST 5%",
      "HST 13% (Ontario)",
      "Zero-rated 0%",
    ]);
    const [account] = await inA((tx) =>
      tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, first.accountIds.gst_hst as string)),
    );
    expect(account).toMatchObject({ code: "2200", subtype: "sales_tax", type: "liability" });
    // Other organizations don't see them.
    const other = await withOrg(app.db, { orgId: orgB }, (tx) => listTaxRates(tx));
    expect(other).toEqual([]);
  });

  it("stores tax on lines, reads transactions back tax-included and totals the report", async () => {
    const hst = await rateId("HST 13% (Ontario)");
    const zero = await rateId("Zero-rated 0%");
    // A $113 sale (HST included), a $50 zero-rated export and a $226 purchase with HST.
    const sale = await post("2026-01-10", {
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "113", taxRateId: hst }],
    });
    await post("2026-01-12", {
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "50", taxRateId: zero }],
    });
    await post("2026-02-03", {
      kind: "withdrawal",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["6250"] as string, amount: "226", taxRateId: hst }],
    });
    // Outside the period.
    await post("2026-04-01", {
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "1130", taxRateId: hst }],
    });

    const { rows } = await inA((tx) => listTransactions(tx, { limit: 50, offset: 0 }));
    const saleRow = rows.find((r) => r.id === sale.id);
    expect(saleRow?.view.splits).toEqual([
      { accountId: code["4000"], amount: "113.0000", taxRateId: hst },
    ]);

    const report = await inA((tx) => salesTaxRows(tx, { from: "2026-01-01", to: "2026-03-31" }));
    const byName = Object.fromEntries(report.map((r) => [r.name, r]));
    expect(byName["HST 13% (Ontario)"]).toMatchObject({
      sales: "100.0000",
      taxCollected: "13.0000",
      purchases: "200.0000",
      taxPaid: "26.0000",
    });
    expect(byName["Zero-rated 0%"]).toMatchObject({
      sales: "50.0000",
      taxCollected: "0.0000",
      purchases: "0.0000",
      taxPaid: "0.0000",
    });
  });

  it("nets edited and deleted transactions out of the report", async () => {
    const hst = await rateId("HST 13% (Ontario)");
    const before = await inA((tx) => salesTaxRows(tx, { from: "2026-05-01", to: "2026-05-31" }));
    expect(before).toEqual([]);
    const posted = await post("2026-05-05", {
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "113", taxRateId: hst }],
    });
    // Edit to $226, then delete a second one.
    const entry = await prepared({
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "226", taxRateId: hst }],
    });
    await inA((tx) =>
      replaceJournalEntry(tx, { orgId: orgA, entryId: posted.id, date: "2026-05-05", entry }),
    );
    const removed = await post("2026-05-06", {
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "565", taxRateId: hst }],
    });
    await inA((tx) => voidJournalEntry(tx, { orgId: orgA, entryId: removed.id }));

    const [row] = await inA((tx) => salesTaxRows(tx, { from: "2026-05-01", to: "2026-05-31" }));
    expect(row).toMatchObject({
      sales: "200.0000",
      taxCollected: "26.0000",
      purchases: "0.0000",
      taxPaid: "0.0000",
    });
  });

  it("keeps a rate's terms once transactions use it, but allows renaming", async () => {
    const hst = await rateId("HST 13% (Ontario)");
    const error = await pgErrorOf(
      inA((tx) =>
        tx.update(schema.taxRates).set({ rate: "15" }).where(eq(schema.taxRates.id, hst)),
      ),
    );
    expect(error).toMatch(/terms can't change/);
    await inA((tx) =>
      tx.update(schema.taxRates).set({ name: "HST 13%" }).where(eq(schema.taxRates.id, hst)),
    );
    // An unused rate can still be corrected.
    const gst = await rateId("GST 5%");
    await inA((tx) =>
      tx.update(schema.taxRates).set({ rate: "5.5" }).where(eq(schema.taxRates.id, gst)),
    );
  });

  it("rejects a tax rate from another organization on a line", async () => {
    const pack = taxPackFor("CA");
    if (!pack) throw new Error("no pack");
    await withOrg(app.db, { orgId: orgB }, (tx) =>
      createDefaultChart(tx, { orgId: orgB, baseCurrency: "CAD" }),
    );
    const { accountIds } = await withOrg(app.db, { orgId: orgB }, (tx) =>
      applyTaxPack(tx, { orgId: orgB, pack, rates: defaultPackRates(pack, "CA-ON") }),
    );
    const [foreign] = await withOrg(app.db, { orgId: orgB }, (tx) =>
      tx
        .select()
        .from(schema.taxRates)
        .where(eq(schema.taxRates.accountId, accountIds.gst_hst as string)),
    );
    const entry = await prepared({
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "10" }],
    });
    const error = await pgErrorOf(
      inA((tx) =>
        postJournalEntry(tx, {
          orgId: orgA,
          date: "2026-06-01",
          entry: {
            ...entry,
            lines: entry.lines.map((l) => ({ ...l, taxRateId: foreign?.id ?? null })),
          },
        }),
      ),
    );
    expect(error).toMatch(/journal_lines_tax_rate_fk|violates foreign key/);
  });
});

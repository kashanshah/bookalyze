import { prepareJournalEntry, type TransactionInput, transactionLines } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry, reverseJournalEntry } from "../ledger";
import { accountLedgerLines, ledgerActivity, transactionExportLines } from "../reports";
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
const code: Record<string, string> = {};
const inOrg = <T>(orgId: string, fn: (tx: Transaction) => Promise<T>) =>
  withOrg(app.db, { orgId }, fn);

async function post(orgId: string, date: string, input: TransactionInput) {
  const all = await inOrg(orgId, (tx) => tx.select().from(schema.accounts));
  const result = prepareJournalEntry(
    { currency: "CAD", baseCurrency: "CAD", lines: transactionLines(input) },
    new Map(all.map((a) => [a.id, a])),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const entry = result.entry;
  return inOrg(orgId, (tx) => postJournalEntry(tx, { orgId, date, entry }));
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [a, b] = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Report A", slug: "report-a", createdAt: new Date() },
      { name: "Report B", slug: "report-b", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  if (!a || !b) throw new Error("Failed to create organizations");
  orgA = a.id;
  orgB = b.id;
  for (const orgId of [orgA, orgB]) {
    await inOrg(orgId, (tx) => createDefaultChart(tx, { orgId, baseCurrency: "CAD" }));
  }
  for (const acct of await inOrg(orgA, (tx) => tx.select().from(schema.accounts))) {
    if (acct.code) code[acct.code] = acct.id;
  }
  const bank = code["1000"] as string;
  const sales = code["4000"] as string;
  const rent = code["6350"] as string;
  await post(orgA, "2024-12-15", {
    kind: "deposit",
    moneyAccountId: bank,
    splits: [{ accountId: sales, amount: "1000" }],
  });
  await post(orgA, "2025-01-10", {
    kind: "deposit",
    moneyAccountId: bank,
    splits: [{ accountId: sales, amount: "300" }],
  });
  await post(orgA, "2025-01-20", {
    kind: "withdrawal",
    moneyAccountId: bank,
    splits: [{ accountId: rent, amount: "120" }],
  });
  await post(orgA, "2025-03-01", {
    kind: "deposit",
    moneyAccountId: bank,
    splits: [{ accountId: sales, amount: "70" }],
  });
  // Another company's activity never shows up.
  const bOwn = await inOrg(orgB, (tx) => tx.select().from(schema.accounts));
  const bBank = bOwn.find((x) => x.code === "1000")?.id as string;
  const bSales = bOwn.find((x) => x.code === "4000")?.id as string;
  await post(orgB, "2025-01-15", {
    kind: "deposit",
    moneyAccountId: bBank,
    splits: [{ accountId: bSales, amount: "999" }],
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

const range = { from: "2025-01-01", to: "2025-01-31" };

describe("general ledger queries", () => {
  it("sums each account's opening balance and the period's debits and credits", async () => {
    const activity = await inOrg(orgA, (tx) => ledgerActivity(tx, range));
    const bank = activity.find((x) => x.accountId === code["1000"]);
    expect(bank).toMatchObject({ opening: "1000.0000", debits: "300.0000", credits: "120.0000" });
    const sales = activity.find((x) => x.accountId === code["4000"]);
    expect(sales).toMatchObject({ opening: "-1000.0000", debits: "0.0000", credits: "300.0000" });
  });

  it("lists one account's lines in the period, oldest first, with its opening balance", async () => {
    const ledger = await inOrg(orgA, (tx) => accountLedgerLines(tx, code["1000"] as string, range));
    expect(ledger?.opening).toBe("1000.0000");
    expect(ledger?.lineCount).toBe(2);
    expect(ledger?.lines.map((l) => [l.date, l.amount])).toEqual([
      ["2025-01-10", "300.0000"],
      ["2025-01-20", "-120.0000"],
    ]);
  });

  it("cuts long lists at the limit but still counts every line", async () => {
    const ledger = await inOrg(orgA, (tx) =>
      accountLedgerLines(tx, code["1000"] as string, { from: "2024-01-01", to: "2025-12-31" }, 2),
    );
    expect(ledger?.lines).toHaveLength(2);
    expect(ledger).toMatchObject({ lineCount: 4, debits: "1370.0000", credits: "120.0000" });
  });

  it("doesn't find another company's account", async () => {
    expect(
      await inOrg(orgB, (tx) => accountLedgerLines(tx, code["1000"] as string, range)),
    ).toBeNull();
  });

  it("exports every line for the accountant, leaving out entries reversed within the period", async () => {
    const bank = code["1000"] as string;
    const sales = code["4000"] as string;
    const deposit = {
      kind: "deposit" as const,
      moneyAccountId: bank,
      splits: [{ accountId: sales, amount: "55" }],
    };
    const undone = await post(orgA, "2026-02-01", deposit);
    await inOrg(orgA, (tx) =>
      reverseJournalEntry(tx, { orgId: orgA, entryId: undone.id, date: "2026-02-10" }),
    );
    const kept = await post(orgA, "2026-02-20", deposit);
    const late = await post(orgA, "2026-02-27", deposit);
    await inOrg(orgA, (tx) =>
      reverseJournalEntry(tx, { orgId: orgA, entryId: late.id, date: "2026-03-02" }),
    );

    const feb = await inOrg(orgA, (tx) =>
      transactionExportLines(tx, { from: "2026-02-01", to: "2026-02-28" }),
    );
    expect(feb.truncated).toBe(false);
    expect([...new Set(feb.lines.map((l) => l.entryNumber))]).toEqual([
      kept.entryNumber,
      late.entryNumber,
    ]);
    expect(feb.lines.find((l) => l.accountName === "Sales")).toMatchObject({
      amount: "-55.0000",
      accountType: "income",
    });
    // The reversal in March stays in March's file, so each month adds up to the books.
    const mar = await inOrg(orgA, (tx) =>
      transactionExportLines(tx, { from: "2026-03-01", to: "2026-03-31" }),
    );
    expect(mar.lines).toHaveLength(2);
    // Another company's lines never appear.
    const other = await inOrg(orgB, (tx) =>
      transactionExportLines(tx, { from: "2026-02-01", to: "2026-02-28" }),
    );
    expect(other.lines).toEqual([]);
  });

  it("says when the list was cut", async () => {
    const cut = await inOrg(orgA, (tx) =>
      transactionExportLines(tx, { from: "2024-01-01", to: "2026-12-31" }, 3),
    );
    expect(cut).toMatchObject({ truncated: true });
    expect(cut.lines).toHaveLength(3);
  });
});

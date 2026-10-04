import { prepareJournalEntry, type TransactionInput, transactionLines } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry } from "../ledger";
import * as schema from "../schema";
import {
  listTransactions,
  replaceJournalEntry,
  setTransactionReviewed,
  voidJournalEntry,
} from "../transactions";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let orgId: string;
const code: Record<string, string> = {};
const scoped = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId }, fn);

async function post(input: TransactionInput, date: string, memo: string) {
  const all = await scoped((tx) => tx.select().from(schema.accounts));
  const prepared = prepareJournalEntry(
    { currency: "CAD", baseCurrency: "CAD", lines: transactionLines(input, memo) },
    new Map(all.map((a) => [a.id, a])),
  );
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.errors));
  return {
    prepared: prepared.entry,
    posted: await scoped((tx) =>
      postJournalEntry(tx, { orgId, date, memo, entry: prepared.entry }),
    ),
  };
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: "Tx Org", slug: "tx-org", createdAt: new Date() })
    .returning({ id: schema.organization.id });
  if (!org) throw new Error("Failed to create organization");
  orgId = org.id;
  await scoped((tx) => createDefaultChart(tx, { orgId, baseCurrency: "CAD" }));
  const [card] = await scoped((tx) =>
    tx
      .insert(schema.accounts)
      .values({
        organizationId: orgId,
        code: "2100",
        name: "Visa",
        type: "liability",
        subtype: "credit_card",
        currency: "CAD",
      })
      .returning(),
  );
  const all = await scoped((tx) => tx.select().from(schema.accounts));
  for (const a of all) if (a.code) code[a.code] = a.id;
  if (card) code["2100"] = card.id;
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("transactions", () => {
  it("lists money movements with filters, and skips entries without money", async () => {
    await post(
      {
        kind: "deposit",
        moneyAccountId: code["1000"] as string,
        splits: [{ accountId: code["4000"] as string, amount: "250" }],
      },
      "2026-07-01",
      "Sale to customer",
    );
    await post(
      {
        kind: "withdrawal",
        moneyAccountId: code["2100"] as string,
        splits: [{ accountId: code["6100"] as string, amount: "49.99" }],
      },
      "2026-07-02",
      "Software",
    );
    await post(
      {
        kind: "transfer",
        fromAccountId: code["1000"] as string,
        toAccountId: code["2100"] as string,
        amount: "100",
      },
      "2026-07-03",
      "Card payment",
    );
    // A non-money adjustment doesn't appear.
    const all = await scoped((tx) => tx.select().from(schema.accounts));
    const adj = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: [
          { accountId: code["6350"] as string, debit: "5" },
          { accountId: code["2000"] as string, credit: "5" },
        ],
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!adj.ok) throw new Error("bad adjustment");
    await scoped((tx) =>
      postJournalEntry(tx, { orgId, date: "2026-07-04", memo: "Accrual", entry: adj.entry }),
    );

    const list = (f: Partial<Parameters<typeof listTransactions>[1]> = {}) =>
      scoped((tx) => listTransactions(tx, { limit: 50, offset: 0, ...f }));

    const everything = await list();
    expect(everything.total).toBe(3);
    expect(everything.rows.map((r) => [r.memo, r.view.kind, r.view.amount])).toEqual([
      ["Card payment", "transfer", "100.0000"],
      ["Software", "withdrawal", "49.9900"],
      ["Sale to customer", "deposit", "250.0000"],
    ]);
    expect((await list({ kind: "deposit" })).rows.map((r) => r.memo)).toEqual(["Sale to customer"]);
    expect((await list({ kind: "withdrawal" })).rows.map((r) => r.memo)).toEqual(["Software"]);
    expect((await list({ kind: "transfer" })).rows.map((r) => r.memo)).toEqual(["Card payment"]);
    expect((await list({ accountId: code["2100"] })).total).toBe(2);
    expect((await list({ search: "soft" })).rows.map((r) => r.memo)).toEqual(["Software"]);
    expect((await list({ search: "100%" })).total).toBe(0);
  });

  it("tracks review status and keeps it through an edit", async () => {
    const { rows } = await scoped((tx) =>
      listTransactions(tx, { limit: 50, offset: 0, search: "Software" }),
    );
    const software = rows[0];
    if (!software) throw new Error("missing");
    await scoped((tx) =>
      setTransactionReviewed(tx, { orgId, entryId: software.id, reviewed: true }),
    );
    expect(
      (
        await scoped((tx) => listTransactions(tx, { limit: 50, offset: 0, reviewed: true }))
      ).rows.map((r) => r.memo),
    ).toEqual(["Software"]);

    const all = await scoped((tx) => tx.select().from(schema.accounts));
    const corrected = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: transactionLines({
          kind: "withdrawal",
          moneyAccountId: code["2100"] as string,
          splits: [{ accountId: code["6000"] as string, amount: "59.99" }],
        }),
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!corrected.ok) throw new Error("bad");
    const replaced = await scoped((tx) =>
      replaceJournalEntry(tx, {
        orgId,
        entryId: software.id,
        date: "2026-07-02",
        memo: "Software (advertising)",
        entry: corrected.entry,
      }),
    );
    const reviewed = await scoped((tx) =>
      listTransactions(tx, { limit: 50, offset: 0, reviewed: true }),
    );
    expect(reviewed.rows.map((r) => [r.id, r.memo, r.view.amount])).toEqual([
      [replaced.id, "Software (advertising)", "59.9900"],
    ]);
    // The original and its reversal are hidden; the journal keeps both.
    const entries = await scoped((tx) => tx.select().from(schema.journalEntries));
    expect(entries.some((e) => e.reversesEntryId === software.id && e.date === "2026-07-02")).toBe(
      true,
    );
  });

  it("voids a transaction by reversing it on its own date", async () => {
    const { rows } = await scoped((tx) =>
      listTransactions(tx, { limit: 50, offset: 0, search: "Card payment" }),
    );
    const payment = rows[0];
    if (!payment) throw new Error("missing");
    const reversal = await scoped((tx) => voidJournalEntry(tx, { orgId, entryId: payment.id }));
    expect(reversal.original.date).toBe("2026-07-03");
    expect(
      (await scoped((tx) => listTransactions(tx, { limit: 50, offset: 0, search: "Card payment" })))
        .total,
    ).toBe(0);
  });
});

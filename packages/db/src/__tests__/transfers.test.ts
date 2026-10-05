import { prepareJournalEntry, type TransactionInput, transactionLines } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry } from "../ledger";
import * as schema from "../schema";
import { listTransactions, replaceJournalEntry } from "../transactions";
import {
  dismissTransfer,
  matchedTransferIds,
  matchSelected,
  matchTransfer,
  suggestTransfers,
  TransferError,
  unmatchTransfer,
} from "../transfers";

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

async function post(input: TransactionInput, date: string, memo: string, bankId?: string) {
  const all = await scoped((tx) => tx.select().from(schema.accounts));
  const prepared = prepareJournalEntry(
    { currency: "CAD", baseCurrency: "CAD", lines: transactionLines(input, memo) },
    new Map(all.map((a) => [a.id, a])),
  );
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.errors));
  return {
    prepared: prepared.entry,
    posted: await scoped((tx) =>
      postJournalEntry(tx, {
        orgId,
        date,
        memo,
        entry: prepared.entry,
        ...(bankId ? { source: "bank_import" as const, sourceId: bankId } : {}),
      }),
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
    .values({ name: "Transfer Org", slug: "transfer-org", createdAt: new Date() })
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

const id = (c: string) => code[c] as string;
let uncIncome: string;
let uncExpense: string;

/** A bank transaction still uncategorized, the way bank imports post them. */
async function bank(
  kind: "deposit" | "withdrawal",
  account: string,
  amount: string,
  date: string,
  memo: string,
  bankId?: string,
) {
  if (!uncIncome) {
    const all = await scoped((tx) => tx.select().from(schema.accounts));
    uncIncome = all.find((a) => a.systemKey === "uncategorized_income")?.id as string;
    uncExpense = all.find((a) => a.systemKey === "uncategorized_expense")?.id as string;
  }
  const { posted } = await post(
    {
      kind,
      moneyAccountId: account,
      splits: [{ accountId: kind === "deposit" ? uncIncome : uncExpense, amount }],
    },
    date,
    memo,
    bankId,
  );
  return posted.id;
}

const current = async (memo: string) =>
  (await scoped((tx) => listTransactions(tx, { search: memo, limit: 10, offset: 0 }))).rows;

describe("transfer matching", () => {
  it("suggests, matches and unmatches money moved between two accounts", async () => {
    const out = await bank("withdrawal", id("1000"), "500", "2026-03-02", "Visa payment");
    const into = await bank("deposit", id("2100"), "500", "2026-03-04", "Payment thank you");
    await bank("withdrawal", id("1000"), "4.50", "2026-03-02", "Coffee");

    expect(await scoped((tx) => suggestTransfers(tx))).toEqual([{ outId: out, inId: into }]);

    const { transferId } = await scoped((tx) =>
      matchTransfer(tx, { orgId, baseCurrency: "CAD", outId: out, inId: into }),
    );
    const [transfer] = await current("Visa payment");
    expect(transfer?.id).toBe(transferId);
    expect(transfer?.date).toBe("2026-03-02");
    expect(transfer?.view).toMatchObject({
      kind: "transfer",
      amount: "500.0000",
      fromAccountId: id("1000"),
      toAccountId: id("2100"),
    });
    expect(await current("Payment thank you")).toEqual([]);
    expect(await scoped((tx) => suggestTransfers(tx))).toEqual([]);
    expect(await scoped((tx) => matchedTransferIds(tx, [transferId]))).toEqual(
      new Set([transferId]),
    );

    // Unmatching brings both back as they were, and they aren't suggested again.
    const back = await scoped((tx) => unmatchTransfer(tx, { orgId, transferEntryId: transferId }));
    expect((await current("Visa payment")).map((r) => [r.id, r.view.kind])).toEqual([
      [back.outId, "withdrawal"],
    ]);
    expect((await current("Payment thank you")).map((r) => [r.id, r.view.kind])).toEqual([
      [back.inId, "deposit"],
    ]);
    expect(await scoped((tx) => suggestTransfers(tx))).toEqual([]);
  });

  it("forgets turned-down pairs, and refuses pairs that can't be a transfer", async () => {
    const out = await bank("withdrawal", id("1000"), "75", "2026-04-02", "To savings");
    const into = await bank("deposit", id("2100"), "75", "2026-04-02", "From chequing");
    expect(await scoped((tx) => suggestTransfers(tx))).toEqual([{ outId: out, inId: into }]);
    await scoped((tx) => dismissTransfer(tx, { orgId, outId: out, inId: into }));
    expect(await scoped((tx) => suggestTransfers(tx))).toEqual([]);

    const other = await bank("withdrawal", id("1000"), "80", "2026-04-03", "Something else");
    await expect(
      scoped((tx) => matchSelected(tx, { orgId, baseCurrency: "CAD", entryIds: [out, other] })),
    ).rejects.toThrow(/went out/);
    await expect(
      scoped((tx) => matchSelected(tx, { orgId, baseCurrency: "CAD", entryIds: [other, into] })),
    ).rejects.toBeInstanceOf(TransferError);
    // Picked by hand, a turned-down pair can still be matched.
    const { transferId } = await scoped((tx) =>
      matchSelected(tx, { orgId, baseCurrency: "CAD", entryIds: [into, out] }),
    );
    expect((await current("To savings"))[0]?.id).toBe(transferId);
  });

  it("gives back the other side when a matched transfer becomes an expense", async () => {
    const out = await bank("withdrawal", id("1000"), "120", "2026-05-02", "Card payoff");
    const into = await bank("deposit", id("2100"), "120", "2026-05-03", "Card credit");
    const { transferId } = await scoped((tx) =>
      matchTransfer(tx, { orgId, baseCurrency: "CAD", outId: out, inId: into }),
    );
    const all = await scoped((tx) => tx.select().from(schema.accounts));
    const rent = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: transactionLines(
          {
            kind: "withdrawal",
            moneyAccountId: id("1000"),
            splits: [{ accountId: id("6350"), amount: "120" }],
          },
          "Card payoff",
        ),
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!rent.ok) throw new Error("bad entry");
    await scoped((tx) =>
      replaceJournalEntry(tx, {
        orgId,
        entryId: transferId,
        date: "2026-05-02",
        memo: "Card payoff",
        entry: rent.entry,
      }),
    );
    expect((await current("Card payoff")).map((r) => r.view.kind)).toEqual(["withdrawal"]);
    const restored = await current("Card credit");
    expect(restored.map((r) => [r.view.kind, r.view.moneyAccountIds])).toEqual([
      ["deposit", [id("2100")]],
    ]);
    expect(restored[0]?.view.splits.map((s) => s.accountId)).toEqual([uncIncome]);
    expect(await scoped((tx) => matchedTransferIds(tx, [transferId]))).toEqual(new Set());
  });

  it("gives back bank transactions too (their bank IDs stay on the reversed originals)", async () => {
    const all = await scoped((tx) => tx.select().from(schema.accounts));
    const expense = (memo: string) => {
      const prepared = prepareJournalEntry(
        {
          currency: "CAD",
          baseCurrency: "CAD",
          lines: transactionLines(
            {
              kind: "withdrawal",
              moneyAccountId: id("1000"),
              splits: [{ accountId: id("6350"), amount: "60" }],
            },
            memo,
          ),
        },
        new Map(all.map((a) => [a.id, a])),
      );
      if (!prepared.ok) throw new Error("bad entry");
      return prepared.entry;
    };

    // Edited into an expense: the deposit side comes back.
    const out = await bank("withdrawal", id("1000"), "60", "2026-06-02", "Sent money A", "w:1");
    const into = await bank("deposit", id("2100"), "60", "2026-06-02", "Received A", "w:2");
    const { transferId } = await scoped((tx) =>
      matchTransfer(tx, { orgId, baseCurrency: "CAD", outId: out, inId: into }),
    );
    await scoped((tx) =>
      replaceJournalEntry(tx, {
        orgId,
        entryId: transferId,
        date: "2026-06-02",
        memo: "Sent money A",
        entry: expense("Sent money A"),
      }),
    );
    expect((await current("Received A")).map((r) => r.view.kind)).toEqual(["deposit"]);

    // Unmatched: both sides come back.
    const out2 = await bank("withdrawal", id("1000"), "61", "2026-06-05", "Sent money B", "w:3");
    const into2 = await bank("deposit", id("2100"), "61", "2026-06-05", "Received B", "w:4");
    const match = await scoped((tx) =>
      matchTransfer(tx, { orgId, baseCurrency: "CAD", outId: out2, inId: into2 }),
    );
    await scoped((tx) => unmatchTransfer(tx, { orgId, transferEntryId: match.transferId }));
    expect((await current("Sent money B")).map((r) => r.view.kind)).toEqual(["withdrawal"]);
    expect((await current("Received B")).map((r) => r.view.kind)).toEqual(["deposit"]);
  });
});

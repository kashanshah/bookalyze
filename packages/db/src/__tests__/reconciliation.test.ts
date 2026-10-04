import { prepareJournalEntry, type TransactionInput, transactionLines } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry } from "../ledger";
import {
  cancelReconciliation,
  completeReconciliation,
  entryReconciledThrough,
  listReconcilableAccounts,
  reconciliationState,
  setLinesCleared,
  startReconciliation,
  undoReconciliation,
  updateReconciliationStatement,
} from "../reconciliation";
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
const code: Record<string, string> = {};
const inA = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId: orgA }, fn);

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error("Expected a failure");
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

async function deposit(date: string, amount: string) {
  const entry = await prepared({
    kind: "deposit",
    moneyAccountId: code["1000"] as string,
    splits: [{ accountId: code["4000"] as string, amount }],
  });
  return inA((tx) => postJournalEntry(tx, { orgId: orgA, date, entry }));
}

async function linesOf(recId: string) {
  const state = await inA((tx) => reconciliationState(tx, recId));
  if (!state) throw new Error("no state");
  return state;
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [a, b] = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Recon A", slug: "recon-a", createdAt: new Date() },
      { name: "Recon B", slug: "recon-b", createdAt: new Date() },
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

describe("reconciliation", () => {
  it("ticks lines until the cleared balance matches the statement, then locks them", async () => {
    const first = await deposit("2025-01-05", "100");
    await deposit("2025-01-20", "50");
    await deposit("2025-02-03", "30"); // after the statement
    const accounts = await inA((tx) => listReconcilableAccounts(tx));
    expect(accounts.map((a) => a.code)).toContain("1000");

    const rec = await inA((tx) =>
      startReconciliation(tx, {
        orgId: orgA,
        accountId: code["1000"] as string,
        statementDate: "2025-01-31",
        statementBalance: "100",
      }),
    );
    let state = await linesOf(rec.id);
    expect(state.lines.map((l) => [l.date, l.amount, l.cleared])).toEqual([
      ["2025-01-05", "100.0000", false],
      ["2025-01-20", "50.0000", false],
    ]);
    expect(state.totals).toMatchObject({ opening: "0.0000", difference: "100.0000" });

    const firstLine = state.lines[0]?.lineId as string;
    await inA((tx) =>
      setLinesCleared(tx, {
        orgId: orgA,
        reconciliationId: rec.id,
        lineIds: [firstLine],
        cleared: true,
      }),
    );
    state = await linesOf(rec.id);
    expect(state.totals).toMatchObject({ clearedBalance: "100.0000", balanced: true });
    await inA((tx) => completeReconciliation(tx, { id: rec.id }));
    expect(await inA((tx) => entryReconciledThrough(tx, first.id))).toBe("2025-01-31");

    // A reconciled transaction can't be edited or removed, and its tick can't change.
    expect(
      await errorOf(inA((tx) => voidJournalEntry(tx, { orgId: orgA, entryId: first.id }))),
    ).toMatch(/reconciled/);
    const entry = await prepared({
      kind: "deposit",
      moneyAccountId: code["1000"] as string,
      splits: [{ accountId: code["4000"] as string, amount: "101" }],
    });
    expect(
      await errorOf(
        inA((tx) =>
          replaceJournalEntry(tx, { orgId: orgA, entryId: first.id, date: "2025-01-05", entry }),
        ),
      ),
    ).toMatch(/reconciled/);
    expect(
      await errorOf(
        inA((tx) =>
          tx
            .delete(schema.reconciliationLines)
            .where(eq(schema.reconciliationLines.journalLineId, firstLine)),
        ),
      ),
    ).toMatch(/completed/);
  });

  it("carries the cleared balance into the next statement", async () => {
    const early = await errorOf(
      inA((tx) =>
        startReconciliation(tx, {
          orgId: orgA,
          accountId: code["1000"] as string,
          statementDate: "2025-01-15",
          statementBalance: "0",
        }),
      ),
    );
    expect(early).toMatch(/reconciled through 2025-01-31/);
    const rec = await inA((tx) =>
      startReconciliation(tx, {
        orgId: orgA,
        accountId: code["1000"] as string,
        statementDate: "2025-02-28",
        statementBalance: "180",
      }),
    );
    // Only one in progress per account.
    expect(
      await errorOf(
        inA((tx) =>
          startReconciliation(tx, {
            orgId: orgA,
            accountId: code["1000"] as string,
            statementDate: "2025-03-31",
            statementBalance: "0",
          }),
        ),
      ),
    ).toMatch(/already has a reconciliation in progress/);
    let state = await linesOf(rec.id);
    expect(state.totals.opening).toBe("100.0000");
    expect(state.lines.map((l) => l.amount)).toEqual(["50.0000", "30.0000"]);
    await inA((tx) =>
      setLinesCleared(tx, {
        orgId: orgA,
        reconciliationId: rec.id,
        lineIds: state.lines.map((l) => l.lineId),
        cleared: true,
      }),
    );
    state = await linesOf(rec.id);
    expect(state.totals).toMatchObject({ clearedBalance: "180.0000", balanced: true });

    // Moving the statement date back unticks what falls after it.
    await inA((tx) =>
      updateReconciliationStatement(tx, {
        id: rec.id,
        statementDate: "2025-01-31",
        statementBalance: "150",
      }).catch((e: Error) => e),
    );
    await inA((tx) =>
      updateReconciliationStatement(tx, {
        id: rec.id,
        statementDate: "2025-02-01",
        statementBalance: "150",
      }),
    );
    state = await linesOf(rec.id);
    expect(state.lines.map((l) => [l.amount, l.cleared])).toEqual([["50.0000", true]]);
    expect(state.totals.balanced).toBe(true);
    await inA((tx) => completeReconciliation(tx, { id: rec.id }));
  });

  it("undoes only the latest reconciliation, and cancels one in progress", async () => {
    const history = await inA((tx) =>
      tx.select().from(schema.reconciliations).orderBy(schema.reconciliations.statementDate),
    );
    const [older, latest] = history;
    expect(await errorOf(inA((tx) => undoReconciliation(tx, older?.id as string)))).toMatch(
      /Only the latest/,
    );
    await inA((tx) => undoReconciliation(tx, latest?.id as string));
    await inA((tx) => cancelReconciliation(tx, latest?.id as string));
    const left = await inA((tx) => tx.select().from(schema.reconciliations));
    expect(left.map((r) => r.status)).toEqual(["completed"]);
    // Other organizations see none of it.
    const other = await withOrg(app.db, { orgId: orgB }, (tx) =>
      tx.select().from(schema.reconciliations),
    );
    expect(other).toEqual([]);
  });
});

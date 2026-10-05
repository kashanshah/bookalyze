import { prepareJournalEntry, type TransactionInput, transactionLines } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAmountCorrections, misrecordedAccounts, misrecordedLines } from "../amount-fix";
import { createConnection, moneyAccountBalances, recordFeedBalance } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry } from "../ledger";
import * as schema from "../schema";
import { listTransactions } from "../transactions";

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
    .values([
      { code: "CAD", name: "Canadian Dollar", minorUnits: 2 },
      { code: "USD", name: "US Dollar", minorUnits: 2 },
    ])
    .onConflictDoNothing();
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: "Amount Fix Org", slug: "amount-fix-org", createdAt: new Date() })
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

let uncIncome: string;
let uncExpense: string;

/** A bank transaction still uncategorized, the way bank imports post them. */
async function bank(
  kind: "deposit" | "withdrawal",
  account: string,
  amount: string,
  date: string,
  memo: string,
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
  );
  return posted.id;
}

describe("correcting foreign-currency amounts", () => {
  it("re-records a CAD amount on a USD account as the real USD, keeping the CAD value", async () => {
    // Imported from Wave while the account still held CAD: US$123 arrived as 173.62.
    const [usd] = await scoped((tx) =>
      tx
        .insert(schema.accounts)
        .values({
          organizationId: orgId,
          code: "1050",
          name: "Wise USD",
          type: "asset",
          subtype: "cash_bank",
        })
        .returning(),
    );
    if (!usd) throw new Error("no account");
    const sent = await bank("withdrawal", usd.id, "173.62", "2026-09-24", "Ahsan Ahmed (Sent)");
    await bank("deposit", usd.id, "50.00", "2026-09-25", "Refund");
    // Then the account was switched to USD; amounts were kept as they were.
    await owner.db
      .update(schema.accounts)
      .set({ currency: "USD" })
      .where(eq(schema.accounts.id, usd.id));

    expect(await scoped((tx) => misrecordedAccounts(tx))).toEqual([
      { accountId: usd.id, name: "Wise USD", currency: "USD", count: 2 },
    ]);
    const lines = await scoped((tx) => misrecordedLines(tx, usd.id));
    expect(lines.map((l) => [l.date, l.amount])).toEqual([
      ["2026-09-24", "-173.6200"],
      ["2026-09-25", "50.0000"],
    ]);
    const [first, second] = lines;
    if (!first || !second) throw new Error("no lines");

    const result = await scoped((tx) =>
      applyAmountCorrections(tx, {
        orgId,
        accountId: usd.id,
        corrections: [
          { lineId: first.lineId, amount: "-123.00" },
          // Going the wrong way: refused.
          { lineId: second.lineId, amount: "-35.00" },
        ],
      }),
    );
    expect(result.corrected).toBe(1);
    expect(result.skipped.map((s) => s.lineId)).toEqual([second.lineId]);

    const now = await scoped((tx) =>
      tx
        .select()
        .from(schema.journalLines)
        .innerJoin(
          schema.journalEntries,
          eq(schema.journalEntries.id, schema.journalLines.journalEntryId),
        )
        .where(eq(schema.journalLines.accountId, usd.id)),
    );
    const live = now.filter(
      (r) => !r.journal_entries.reversedByEntryId && !r.journal_entries.reversesEntryId,
    );
    expect(
      live
        .map((r) => [r.journal_lines.currency, r.journal_lines.amount, r.journal_lines.baseAmount])
        .sort(),
    ).toEqual([
      ["CAD", "50.0000", "50.0000"],
      ["USD", "-123.0000", "-173.6200"],
    ]);
    expect(
      now.find((r) => r.journal_entries.id === sent)?.journal_entries.reversedByEntryId,
    ).not.toBeNull();
    expect((await scoped((tx) => misrecordedAccounts(tx)))[0]?.count).toBe(1);

    // The whole transaction is now in USD: the category too, keeping its CAD value.
    const fixed = live.find((r) => r.journal_lines.currency === "USD");
    const entryLines = await scoped((tx) =>
      tx
        .select()
        .from(schema.journalLines)
        .where(eq(schema.journalLines.journalEntryId, fixed?.journal_entries.id ?? "")),
    );
    expect(entryLines.map((l) => [l.currency, l.amount, l.baseAmount]).sort()).toEqual([
      ["USD", "-123.0000", "-173.6200"],
      ["USD", "123.0000", "173.6200"],
    ]);
    expect(fixed?.journal_entries.currency).toBe("USD");

    // On Transactions it reads US$123 of expense, at the rate the two values imply.
    const { rows } = await scoped((tx) =>
      listTransactions(tx, { entryIds: [fixed?.journal_entries.id ?? ""], limit: 5, offset: 0 }),
    );
    expect(rows[0]).toMatchObject({ currency: "USD", fxRate: "1.4115447154" });
    expect(rows[0]?.view.amount).toBe("123.0000");
    expect(rows[0]?.view.splits.map((x) => x.amount)).toEqual(["123.0000"]);
  });
});

describe("bank balances beside the books", () => {
  it("compares the bank's figure with the account on that day, newest figure kept", async () => {
    const visa = code["2100"] as string;
    await bank("withdrawal", visa, "40.00", "2026-08-01", "Lunch");
    await bank("withdrawal", visa, "10.00", "2026-08-20", "Parking");
    const feedId = await scoped(async (tx) => {
      const connection = await createConnection(tx, {
        orgId,
        provider: "csv",
        name: "Visa statements",
        settings: {},
      });
      const [feed] = await tx
        .insert(schema.bankFeeds)
        .values({
          organizationId: orgId,
          connectionId: connection.id,
          externalId: "csv:visa",
          currency: "CAD",
          name: "Visa",
          accountId: visa,
          syncFrom: "2026-01-01",
        })
        .returning();
      return feed?.id as string;
    });
    await scoped((tx) => recordFeedBalance(tx, feedId, { amount: "-40.00", on: "2026-08-10" }));
    // An older statement uploaded afterwards doesn't replace it.
    await scoped((tx) => recordFeedBalance(tx, feedId, { amount: "-1.00", on: "2026-07-01" }));
    const { accounts: all, onBankDay } = await scoped((tx) => moneyAccountBalances(tx));
    expect(all.find((a) => a.accountId === visa)).toMatchObject({
      currency: "CAD",
      balance: "-50.0000",
      otherCurrency: 0,
    });
    // On Aug 10 the card held -40 in the books too: they agree.
    expect(onBankDay.get(feedId)).toBe("-40.0000");
    const [feed] = await scoped((tx) =>
      tx.select().from(schema.bankFeeds).where(eq(schema.bankFeeds.id, feedId)),
    );
    expect(feed).toMatchObject({ bankBalance: "-40.0000", bankBalanceOn: "2026-08-10" });
  });
});

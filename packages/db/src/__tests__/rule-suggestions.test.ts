import { prepareJournalEntry, type TransactionInput, transactionLines } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry } from "../ledger";
import { createRule, dismissRuleSuggestion, suggestedRules } from "../rules";
import * as schema from "../schema";

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
    .values({ name: "Suggest Org", slug: "suggest-org", createdAt: new Date() })
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

/** Suggestions learn from the last year, so the dates follow today. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe("rule suggestions", () => {
  it("suggests a payee categorized the same way by hand, until made or turned down", async () => {
    for (const [i, date] of [daysAgo(90), daysAgo(60), daysAgo(30)].entries()) {
      await post(
        {
          kind: "withdrawal",
          moneyAccountId: id("1000"),
          splits: [{ accountId: id("6100"), amount: "85.50" }],
        },
        date,
        `POS PURCHASE BELL CANADA 04${i}`,
      );
    }
    // One more arrives, still uncategorized.
    await bank("withdrawal", id("1000"), "85.50", daysAgo(2), "BELL CANADA 0599");

    const today = await scoped((tx) => suggestedRules(tx));
    expect(today).toEqual([
      {
        matchText: "bell canada",
        direction: "out",
        categoryAccountId: id("6100"),
        count: 3,
        waiting: 1,
      },
    ]);

    await scoped((tx) => dismissRuleSuggestion(tx, { orgId, matchText: "bell canada" }));
    expect(await scoped((tx) => suggestedRules(tx))).toEqual([]);
  });

  it("doesn't suggest what a rule already covers", async () => {
    for (const date of [daysAgo(80), daysAgo(50), daysAgo(20)]) {
      await post(
        {
          kind: "withdrawal",
          moneyAccountId: id("1000"),
          splits: [{ accountId: id("6100"), amount: "20" }],
        },
        date,
        "SPOTIFY P1234",
      );
    }
    expect((await scoped((tx) => suggestedRules(tx))).map((s) => s.matchText)).toEqual(["spotify"]);
    await scoped((tx) =>
      createRule(tx, {
        orgId,
        matchText: "Spotify",
        direction: "any",
        amountMin: null,
        amountMax: null,
        accountId: null,
        categoryAccountId: id("6100"),
        contactId: null,
        isActive: true,
      }),
    );
    expect(await scoped((tx) => suggestedRules(tx))).toEqual([]);
  });
});

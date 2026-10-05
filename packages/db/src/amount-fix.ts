import {
  divideDecimals,
  formatDecimal,
  type PreparedEntry,
  parseDecimal,
  restateAmounts,
} from "@bookalyze/core";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { LedgerError } from "./ledger";
import { accounts, journalEntries, journalLines } from "./schema/accounting";
import { bankLines } from "./schema/banking";
import { replaceJournalEntry } from "./transactions";

/**
 * Lines whose amount is in the wrong currency: on an account that holds a foreign currency, but
 * recorded in another (the main currency), e.g. imported from Wave's accounting export (which
 * only has main-currency values) before the account was switched to USD. See core
 * `matchStatementAmounts` for how the real amounts are found.
 */

export type MisrecordedRow = {
  lineId: string;
  entryId: string;
  entryNumber: number;
  date: string;
  /** Signed, as recorded (in the main currency). */
  amount: string;
  baseAmount: string;
  memo: string | null;
  description: string | null;
};

const current = sql.raw("e.reversed_by_entry_id is null and e.reverses_entry_id is null");

/** Foreign-currency accounts with misrecorded lines, and how many. */
export async function misrecordedAccounts(tx: Transaction) {
  const rows = await tx.execute<{
    account_id: string;
    name: string;
    currency: string;
    n: string;
  }>(sql`
    select a.id as account_id, a.name, a.currency, count(*)::text as n
    from journal_lines l
    join journal_entries e on e.id = l.journal_entry_id
    join accounts a on a.id = l.account_id
    where a.currency is not null and l.currency <> a.currency and ${current}
    group by a.id, a.name, a.currency
    order by a.name`);
  return rows.rows.map((r) => ({
    accountId: r.account_id,
    name: r.name,
    currency: r.currency,
    count: Number(r.n),
  }));
}

/** The misrecorded lines on one account, oldest first. */
export async function misrecordedLines(
  tx: Transaction,
  accountId: string,
): Promise<MisrecordedRow[]> {
  const rows = await tx.execute<{
    line_id: string;
    entry_id: string;
    entry_number: number;
    date: string;
    amount: string;
    base_amount: string;
    memo: string | null;
    description: string | null;
  }>(sql`
    select l.id as line_id, e.id as entry_id, e.entry_number, e.date::text as date,
      l.amount::text as amount, l.base_amount::text as base_amount, e.memo, l.description
    from journal_lines l
    join journal_entries e on e.id = l.journal_entry_id
    join accounts a on a.id = l.account_id
    where l.account_id = ${accountId} and a.currency is not null and l.currency <> a.currency
      and ${current}
    order by e.date, e.entry_number`);
  return rows.rows.map((r) => ({
    lineId: r.line_id,
    entryId: r.entry_id,
    entryNumber: Number(r.entry_number),
    date: r.date,
    amount: r.amount,
    baseAmount: r.base_amount,
    memo: r.memo,
    description: r.description,
  }));
}

export type AmountCorrection = {
  lineId: string;
  /** Signed, in the account's currency. */
  amount: string;
  /** The statement line it came from, recorded so a later sync recognises it. */
  statement?: { feedId: string; externalId: string; date: string; description: string } | null;
};

/**
 * Re-records each line in its account's currency with the given amount, keeping its
 * main-currency value: the entry is replaced like any edit (reversed on its own date, history
 * kept). Lines in a closed period or a completed reconciliation, or whose entry also has a
 * misrecorded line on another account, are skipped with the reason.
 */
export async function applyAmountCorrections(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    accountId: string;
    corrections: readonly AmountCorrection[];
  },
): Promise<{ corrected: number; skipped: { lineId: string; reason: string }[] }> {
  const [account] = await tx.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!account?.currency) throw new LedgerError("This account doesn't hold a single currency.");
  const currency = account.currency;
  const byLine = new Map(input.corrections.map((c) => [c.lineId, c]));
  const targets = await tx
    .select({ id: journalLines.id, entryId: journalLines.journalEntryId })
    .from(journalLines)
    .where(inArray(journalLines.id, [...byLine.keys()]));
  const entryIds = [...new Set(targets.map((t) => t.entryId))];
  const skipped: { lineId: string; reason: string }[] = [];
  let corrected = 0;

  for (const entryId of entryIds) {
    const [entry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, entryId));
    const lines = await tx
      .select({
        line: journalLines,
        accountCurrency: accounts.currency,
        accountName: accounts.name,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.journalEntryId, entryId))
      .orderBy(asc(journalLines.lineNo));
    const mine = lines.filter((l) => byLine.has(l.line.id));
    const skip = (reason: string) => {
      for (const l of mine) skipped.push({ lineId: l.line.id, reason });
    };
    if (!entry || entry.reversedByEntryId || entry.reversesEntryId) {
      skip("It was changed since. Open the screen again.");
      continue;
    }
    const valid = mine.every((l) => {
      const fix = byLine.get(l.line.id);
      return (
        fix &&
        l.line.accountId === input.accountId &&
        l.line.currency !== currency &&
        parseDecimal(fix.amount) !== 0n &&
        parseDecimal(fix.amount) < 0n === parseDecimal(l.line.amount) < 0n
      );
    });
    if (!valid) {
      skip(
        "The amount doesn't fit this transaction (it goes the other way, or it's already fixed).",
      );
      continue;
    }
    const other = lines.find(
      (l) =>
        !byLine.has(l.line.id) &&
        l.accountCurrency !== null &&
        l.accountCurrency !== l.line.currency,
    );
    if (other) {
      skip(
        `It also moves money on ${other.accountName}, which needs correcting too. Fix it by hand.`,
      );
      continue;
    }
    // Usually the rest is categories in the main currency: they move to the account's currency
    // too (at the rate the fixed line implies), so the whole transaction reads in it. Otherwise
    // (e.g. a transfer to a CAD account) the other lines keep their own currency.
    const rest = lines.filter((l) => !byLine.has(l.line.id));
    const whole =
      rest.length > 0 &&
      rest.every((l) => l.accountCurrency === null && l.line.currency === entry.currency);
    const fixedAmount = mine.reduce(
      (t, l) => t + parseDecimal(byLine.get(l.line.id)?.amount ?? "0"),
      0n,
    );
    const fixedBase = mine.reduce((t, l) => t + parseDecimal(l.line.baseAmount), 0n);
    const restated = whole
      ? restateAmounts(
          rest.map((l) => l.line.baseAmount),
          { amount: formatDecimal(fixedAmount), baseAmount: formatDecimal(fixedBase) },
          currency,
          formatDecimal(-fixedAmount),
        )
      : [];
    const amountOf = (lineId: string, original: string) => {
      const fix = byLine.get(lineId);
      if (fix) return formatDecimal(parseDecimal(fix.amount));
      const i = rest.findIndex((l) => l.line.id === lineId);
      return whole ? (restated[i] ?? original) : original;
    };
    const abs = (v: bigint) => (v < 0n ? -v : v);
    const entryCurrency = whole ? currency : entry.currency;
    const prepared: PreparedEntry = {
      currency: entryCurrency,
      fxRate:
        whole && fixedAmount !== 0n
          ? divideDecimals(formatDecimal(abs(fixedBase)), formatDecimal(abs(fixedAmount)))
          : entry.fxRate,
      total: "0",
      lines: lines.map(({ line }, index) => ({
        index,
        accountId: line.accountId,
        description: line.description,
        currency: byLine.has(line.id) || whole ? currency : line.currency,
        amount: amountOf(line.id, line.amount),
        baseAmount: line.baseAmount,
        taxRateId: line.taxRateId,
      })),
    };
    prepared.total = formatDecimal(
      prepared.lines
        .filter((l) => l.currency === entryCurrency)
        .map((l) => parseDecimal(l.amount))
        .filter((a) => a > 0n)
        .reduce((t, a) => t + a, 0n),
    );
    try {
      await tx.transaction(async (sp) => {
        const posted = await replaceJournalEntry(sp, {
          orgId: input.orgId,
          userId: input.userId,
          entryId,
          date: entry.date,
          reference: entry.reference,
          memo: entry.memo,
          contactId: entry.contactId,
          entry: prepared,
        });
        for (const l of mine) {
          const s = byLine.get(l.line.id)?.statement;
          if (!s) continue;
          await sp
            .insert(bankLines)
            .values({
              organizationId: input.orgId,
              feedId: s.feedId,
              externalId: s.externalId,
              date: s.date,
              currency,
              amount: formatDecimal(parseDecimal(byLine.get(l.line.id)?.amount ?? "0")),
              description: s.description,
              kind: "other",
              status: "posted",
              journalEntryId: posted.id,
            })
            .onConflictDoNothing({ target: [bankLines.organizationId, bankLines.externalId] });
        }
      });
      corrected += mine.length;
    } catch (error) {
      if (error instanceof LedgerError) skip(error.message);
      else if ((error as { cause?: { code?: string } }).cause?.code === "23514") {
        skip("It's in a closed period or a completed reconciliation.");
      } else throw error;
    }
  }
  const handled = new Set(targets.map((t) => t.id));
  for (const c of input.corrections) {
    if (!handled.has(c.lineId)) skipped.push({ lineId: c.lineId, reason: "It no longer exists." });
  }
  return { corrected, skipped };
}

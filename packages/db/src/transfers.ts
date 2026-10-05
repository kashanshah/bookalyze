import {
  describeTransaction,
  divideDecimals,
  formatDecimal,
  type MergeCandidate,
  MONEY_ACCOUNT_SUBTYPES,
  type PreparedEntry,
  pairTransfers,
  parseDecimal,
  prepareTransfer,
  type TransferCandidate,
  type TransferPair,
  transferMatchProblem,
} from "@bookalyze/core";
import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { copyAttachmentLinks } from "./attachments";
import type { Transaction } from "./client";
import { carryEntryLinks } from "./duplicates";
import { postJournalEntry, reverseJournalEntry } from "./ledger";
import { accounts, journalEntries, journalLines, transferMatches } from "./schema/accounting";
import { bankLines } from "./schema/banking";

/**
 * Transfer matching. Money moved between two of the company's own accounts usually arrives as
 * two bank transactions, money out of one and money into the other, both uncategorized. Matching
 * reverses both (on their own dates) and posts one transfer in their place, which takes over
 * their bank links and receipts. Unmatching undoes that. Likely pairs are found on the fly from
 * what's still uncategorized (see `pairTransfers` in core); pairs someone turned down are kept
 * in `transfer_matches` so they aren't suggested again.
 */

export class TransferError extends Error {}

const moneySubtypes = new Set<string>(MONEY_ACCOUNT_SUBTYPES);
const moneyList = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "));
const abs = (amount: string) =>
  formatDecimal(parseDecimal(amount) < 0n ? -parseDecimal(amount) : parseDecimal(amount));
const pairKey = (p: TransferPair) => `${p.outId}:${p.inId}`;

/**
 * Current transactions that could be one side of a transfer: on exactly one bank, card or cash
 * account, with everything else still in Uncategorized income or expense. Newest first.
 */
async function transferCandidates(tx: Transaction, limit = 3000): Promise<TransferCandidate[]> {
  const rows = await tx.execute<{
    entry_id: string;
    date: string;
    account_id: string;
    currency: string;
    amount: string;
    base_amount: string;
  }>(sql`
    select e.id as entry_id, e.date::text as date, m.account_id, m.currency,
      m.amount::text as amount, m.base_amount::text as base_amount
    from journal_entries e
    join journal_lines m on m.journal_entry_id = e.id
    join accounts ma on ma.id = m.account_id and ma.subtype in (${moneyList})
    where e.reversed_by_entry_id is null and e.reverses_entry_id is null
      and (select count(*) from journal_lines l join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id and a.subtype in (${moneyList})) = 1
      and exists (select 1 from journal_lines l join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id
          and a.subtype in ('uncategorized_income', 'uncategorized_expense'))
      and not exists (select 1 from journal_lines l join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id and a.subtype not in (${moneyList})
          and a.subtype not in ('uncategorized_income', 'uncategorized_expense'))
    order by e.date desc, e.entry_number desc
    limit ${limit}`);
  return rows.rows.map((r) => ({
    entryId: r.entry_id,
    date: r.date,
    accountId: r.account_id,
    currency: r.currency,
    amount: r.amount,
    baseAmount: r.base_amount,
  }));
}

/** Likely transfers among the uncategorized transactions, leaving out pairs turned down. */
export async function suggestTransfers(tx: Transaction): Promise<TransferPair[]> {
  const candidates = await transferCandidates(tx);
  if (candidates.length < 2) return [];
  const ids = candidates.map((c) => c.entryId);
  const declined = await tx
    .select({ outId: transferMatches.outEntryId, inId: transferMatches.inEntryId })
    .from(transferMatches)
    .where(
      and(
        inArray(transferMatches.status, ["dismissed", "unmatched"]),
        or(inArray(transferMatches.outEntryId, ids), inArray(transferMatches.inEntryId, ids)),
      ),
    );
  const skip = new Set(declined.map(pairKey));
  return pairTransfers(candidates, (p) => skip.has(pairKey(p)));
}

/** Which of `entryIds` are transfers made by matching (and so can be unmatched). */
export async function matchedTransferIds(
  tx: Transaction,
  entryIds: readonly string[],
): Promise<Set<string>> {
  if (!entryIds.length) return new Set();
  const rows = await tx
    .select({ id: transferMatches.transferEntryId })
    .from(transferMatches)
    .where(
      and(
        eq(transferMatches.status, "matched"),
        inArray(transferMatches.transferEntryId, [...entryIds]),
      ),
    );
  return new Set(rows.map((r) => r.id).filter((id): id is string => Boolean(id)));
}

async function currentEntry(tx: Transaction, id: string) {
  const [entry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, id));
  if (!entry) throw new TransferError("One of these transactions no longer exists.");
  if (entry.reversedByEntryId || entry.reversesEntryId) {
    throw new TransferError(
      "One of these transactions has already been changed. Refresh to see the latest.",
    );
  }
  return entry;
}

async function linesOf(tx: Transaction, entryIds: readonly string[]) {
  return tx
    .select({
      entryId: journalLines.journalEntryId,
      accountId: journalLines.accountId,
      description: journalLines.description,
      currency: journalLines.currency,
      amount: journalLines.amount,
      baseAmount: journalLines.baseAmount,
      taxRateId: journalLines.taxRateId,
      subtype: accounts.subtype,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(inArray(journalLines.journalEntryId, [...entryIds]))
    .orderBy(asc(journalLines.lineNo));
}

/**
 * Matches two transactions as one transfer: `outId` (money out of one account) and `inId` (the
 * same money into another). Both are reversed on their own dates and one transfer is posted on
 * the date the money left, carrying their bank links and receipts. Between currencies, each side
 * keeps its own amount; the main-currency value comes from the side already in it (or the
 * sending side's rate), like any transfer.
 */
export async function matchTransfer(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    baseCurrency: string;
    outId: string;
    inId: string;
  },
): Promise<{ transferId: string }> {
  if (input.outId === input.inId) throw new TransferError("Pick two different transactions.");
  const out = await currentEntry(tx, input.outId);
  const into = await currentEntry(tx, input.inId);
  const lines = await linesOf(tx, [out.id, into.id]);
  const isMoney = (id: string) =>
    lines.some((l) => l.accountId === id && moneySubtypes.has(l.subtype));
  const view = (entryId: string, currency: string): MergeCandidate | null => {
    const v = describeTransaction(
      lines.filter((l) => l.entryId === entryId),
      isMoney,
    );
    return v ? { ...v, currency } : null;
  };
  const outView = view(out.id, out.currency);
  const inView = view(into.id, into.currency);
  if (!outView || !inView) throw new TransferError("Only bank transactions can be matched.");
  const problem = transferMatchProblem(outView, inView);
  if (problem) throw new TransferError(problem);
  if (outView.kind !== "withdrawal") throw new TransferError("Pick the money out first.");

  const sentLine = lines.find((l) => l.entryId === out.id && moneySubtypes.has(l.subtype));
  const gotLine = lines.find((l) => l.entryId === into.id && moneySubtypes.has(l.subtype));
  if (!sentLine || !gotLine) throw new TransferError("Only bank transactions can be matched.");
  const ledger = new Map(
    (
      await tx
        .select()
        .from(accounts)
        .where(inArray(accounts.id, [sentLine.accountId, gotLine.accountId]))
    ).map((a) => [a.id, a]),
  );
  const neitherBase =
    sentLine.currency !== input.baseCurrency && gotLine.currency !== input.baseCurrency;
  const prepared = prepareTransfer(
    {
      fromAccountId: sentLine.accountId,
      toAccountId: gotLine.accountId,
      sent: abs(sentLine.amount),
      received: abs(gotLine.amount),
      baseCurrency: input.baseCurrency,
      // The rate the money-out side was recorded at.
      fxRate: neitherBase
        ? divideDecimals(abs(sentLine.baseAmount), abs(sentLine.amount))
        : undefined,
      memo: out.memo ?? into.memo,
    },
    ledger,
  );
  if (!prepared.ok) {
    const errors = prepared.errors;
    throw new TransferError(
      errors.form ??
        Object.values(errors.lines ?? {})[0] ??
        errors.fxRate ??
        "These can't be matched as a transfer.",
    );
  }

  for (const entry of [out, into]) {
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: entry.id,
      date: entry.date,
    });
  }
  const fromBank = out.source === "bank_import" || into.source === "bank_import";
  const transfer = await postJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: out.date,
    reference: out.reference ?? into.reference,
    memo: out.memo ?? into.memo,
    contactId: out.contactId ?? into.contactId,
    ...(fromBank ? { source: "bank_import" as const } : {}),
    entry: prepared.entry,
  });
  for (const entry of [out, into]) {
    await carryEntryLinks(tx, { from: entry.id, to: transfer.id, userId: input.userId });
    await copyAttachmentLinks(tx, {
      orgId: input.orgId,
      entityType: "journal_entry",
      fromEntityId: entry.id,
      toEntityId: transfer.id,
      userId: input.userId,
    });
  }
  await tx
    .insert(transferMatches)
    .values({
      organizationId: input.orgId,
      outEntryId: out.id,
      inEntryId: into.id,
      transferEntryId: transfer.id,
      status: "matched",
      decidedBy: input.userId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        transferMatches.organizationId,
        transferMatches.outEntryId,
        transferMatches.inEntryId,
      ],
      set: {
        transferEntryId: transfer.id,
        status: "matched",
        decidedBy: input.userId ?? null,
        updatedAt: new Date(),
      },
    });
  return { transferId: transfer.id };
}

/** Matches two transactions picked by hand: whichever is money out sends, the other receives. */
export async function matchSelected(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    baseCurrency: string;
    entryIds: readonly string[];
  },
) {
  const ids = [...new Set(input.entryIds)];
  if (ids.length !== 2) throw new TransferError("Pick exactly two transactions to match.");
  const lines = await linesOf(tx, ids);
  const net = (id: string) =>
    lines
      .filter((l) => l.entryId === id && moneySubtypes.has(l.subtype))
      .reduce((t, l) => t + parseDecimal(l.amount), 0n);
  const [a, b] = ids as [string, string];
  const outId = net(a) < 0n ? a : b;
  const inId = outId === a ? b : a;
  return matchTransfer(tx, { ...input, outId, inId });
}

/** They aren't a transfer: the pair isn't suggested again. */
export async function dismissTransfer(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; outId: string; inId: string },
) {
  await tx
    .insert(transferMatches)
    .values({
      organizationId: input.orgId,
      outEntryId: input.outId,
      inEntryId: input.inId,
      status: "dismissed",
      decidedBy: input.userId ?? null,
    })
    .onConflictDoNothing();
}

/** Posts a copy of a reversed entry again (same date, lines, source and import ID). */
async function repost(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; entryId: string },
) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, input.entryId));
  if (!entry) throw new TransferError("One side of this transfer no longer exists.");
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.journalEntryId, entry.id))
    .orderBy(asc(journalLines.lineNo));
  const prepared: PreparedEntry = {
    currency: entry.currency,
    fxRate: entry.fxRate,
    total: formatDecimal(
      lines
        .map((l) => parseDecimal(l.amount))
        .filter((a) => a > 0n)
        .reduce((t, a) => t + a, 0n),
    ),
    lines: lines.map((l, index) => ({
      index,
      accountId: l.accountId,
      description: l.description,
      currency: l.currency,
      amount: l.amount,
      baseAmount: l.baseAmount,
      taxRateId: l.taxRateId,
    })),
  };
  const posted = await postJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: entry.date,
    reference: entry.reference,
    memo: entry.memo,
    contactId: entry.contactId,
    source: entry.source === "reversal" ? "manual" : entry.source,
    sourceId: entry.sourceId,
    entry: prepared,
  });
  await copyAttachmentLinks(tx, {
    orgId: input.orgId,
    entityType: "journal_entry",
    fromEntityId: entry.id,
    toEntityId: posted.id,
    userId: input.userId,
  });
  return posted.id;
}

/** Moves the bank lines of `from` going one way (out or in) to `to`. */
async function moveBankLines(tx: Transaction, from: string, to: string, side: "out" | "in") {
  await tx
    .update(bankLines)
    .set({ journalEntryId: to })
    .where(
      and(
        eq(bankLines.journalEntryId, from),
        side === "out" ? lt(bankLines.amount, "0") : gt(bankLines.amount, "0"),
      ),
    );
}

async function matchOf(tx: Transaction, transferEntryId: string) {
  const [match] = await tx
    .select()
    .from(transferMatches)
    .where(
      and(
        eq(transferMatches.transferEntryId, transferEntryId),
        eq(transferMatches.status, "matched"),
      ),
    );
  return match ?? null;
}

/**
 * Undoes a match: the transfer is reversed on its own date and both sides are posted again as
 * they were (still uncategorized), each taking back its bank line. The pair isn't suggested again.
 */
export async function unmatchTransfer(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; transferEntryId: string },
): Promise<{ outId: string; inId: string }> {
  const match = await matchOf(tx, input.transferEntryId);
  if (!match) throw new TransferError("This transfer wasn't made by matching two transactions.");
  const transfer = await currentEntry(tx, input.transferEntryId);
  await reverseJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: transfer.id,
    date: transfer.date,
  });
  const outId = await repost(tx, { ...input, entryId: match.outEntryId });
  const inId = await repost(tx, { ...input, entryId: match.inEntryId });
  await moveBankLines(tx, transfer.id, outId, "out");
  await moveBankLines(tx, transfer.id, inId, "in");
  await tx
    .update(transferMatches)
    .set({
      outEntryId: outId,
      inEntryId: inId,
      transferEntryId: null,
      status: "unmatched",
      decidedBy: input.userId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(transferMatches.id, match.id));
  return { outId, inId };
}

/**
 * A matched transfer was edited (`from` replaced by `to`, see `replaceJournalEntry`). If `to`
 * still moves money between both accounts, the match follows it. If it no longer touches one of
 * them (it was turned into an expense, say), that side comes back as it was before matching,
 * with its bank line, so nothing the bank sent goes missing. Runs before the bank links of
 * `from` are carried to `to`.
 */
export async function followTransferEdit(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; from: string; to: string },
) {
  const match = await matchOf(tx, input.from);
  if (!match) return;
  const [sides, now] = await Promise.all([
    linesOf(tx, [match.outEntryId, match.inEntryId]),
    linesOf(tx, [input.to]),
  ]);
  const accountOf = (entryId: string) =>
    sides.find((l) => l.entryId === entryId && moneySubtypes.has(l.subtype))?.accountId;
  const keeps = (entryId: string) => {
    const account = accountOf(entryId);
    return Boolean(account && now.some((l) => l.accountId === account));
  };
  const keepsOut = keeps(match.outEntryId);
  const keepsIn = keeps(match.inEntryId);
  if (keepsOut && keepsIn) {
    await tx
      .update(transferMatches)
      .set({ transferEntryId: input.to, updatedAt: new Date() })
      .where(eq(transferMatches.id, match.id));
    return;
  }
  let outId = input.to;
  let inId = input.to;
  if (!keepsOut) {
    outId = await repost(tx, { ...input, entryId: match.outEntryId });
    await moveBankLines(tx, input.from, outId, "out");
  }
  if (!keepsIn) {
    inId = await repost(tx, { ...input, entryId: match.inEntryId });
    await moveBankLines(tx, input.from, inId, "in");
  }
  await tx
    .update(transferMatches)
    .set({
      outEntryId: outId,
      inEntryId: inId,
      transferEntryId: null,
      status: "unmatched",
      decidedBy: input.userId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(transferMatches.id, match.id));
}

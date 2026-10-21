import {
  buildWalmartEntry,
  convertUnits,
  formatDecimal,
  minorUnits,
  parseDecimal,
  readWalmartTotals,
  settlementDepositWindow,
  storeWalmartTotals,
  WALMART_ACCOUNT_KEYS,
  WALMART_READER_VERSION,
  type WalmartAccountKey,
  type WalmartAccounts,
  type WalmartSettlementTotals,
  walmartSettlementProblem,
  walmartSettlementTotals,
} from "@bookalyze/core";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { fxRateOn } from "./fx";
import { formatEntryNumber, LedgerError, reverseJournalEntry } from "./ledger";
import {
  salesChannels,
  walmartAccounts,
  walmartDepositDismissals,
  walmartSettings,
  walmartSettlements,
} from "./schema/commerce";
import {
  type DepositCandidate,
  depositCandidates,
  moveDepositToClearing,
  postClearingEntry,
  restoreDeposit,
} from "./settlements";
import { walmartSettlementRowsOf } from "./walmart-settlements";

/**
 * Walmart in the books (phase 4e, slice 4b-2). Run inside `withOrg()`. Each settlement brought
 * in posts as one entry on its last day, each group to its account and the net to the Walmart
 * balance (core `buildWalmartEntry`); its payout is then matched to the bank deposit, which
 * moves it out of the Walmart balance. A settlement whose rows don't add up to Walmart's payout
 * doesn't post (core `walmartSettlementProblem`).
 */

// --- Setup -----------------------------------------------------------------------------------

export async function getWalmartAccounts(tx: Transaction): Promise<WalmartAccounts> {
  const rows = await tx.select().from(walmartAccounts);
  return Object.fromEntries(
    rows
      .filter((r) => (WALMART_ACCOUNT_KEYS as string[]).includes(r.key))
      .map((r) => [r.key, r.accountId]),
  ) as WalmartAccounts;
}

export async function getWalmartSettings(tx: Transaction) {
  const [row] = await tx.select().from(walmartSettings).limit(1);
  return { postFrom: row?.postFrom ?? null, autoPost: row?.autoPost ?? false };
}

/** Saves the accounts (all of them: kinds left out are cleared) and the day posting starts. */
export async function saveWalmartSetup(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    accounts: WalmartAccounts;
    postFrom: string;
    autoPost?: boolean;
  },
) {
  await tx.delete(walmartAccounts);
  const rows = Object.entries(input.accounts).filter(
    (e): e is [WalmartAccountKey, string] => typeof e[1] === "string" && e[1] !== "",
  );
  if (rows.length) {
    await tx
      .insert(walmartAccounts)
      .values(rows.map(([key, accountId]) => ({ organizationId: input.orgId, key, accountId })));
  }
  const values = {
    postFrom: input.postFrom,
    autoPost: input.autoPost ?? false,
    updatedBy: input.userId,
    updatedAt: new Date(),
  };
  await tx
    .insert(walmartSettings)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: walmartSettings.organizationId, set: values });
}

// --- Settlements -----------------------------------------------------------------------------

export type WalmartSettlementState =
  | "notSetUp"
  | "before"
  | "problem"
  | "empty"
  | "ready"
  | "posted"
  | "changed";

export type WalmartPostingRow = {
  id: string;
  channelId: string;
  channelName: string;
  reportDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  /** The day it posts on: the period's last day, else the report date. */
  date: string;
  currency: string;
  payout: string | null;
  rows: number;
  totals: WalmartSettlementTotals | null;
  /** Why it can't be read into the books, in plain words. */
  problem: string | null;
  state: WalmartSettlementState;
  posted: { net: string; entryId: string; entryLabel: string; rate: string | null } | null;
  deposit: { entryId: string; entryLabel: string; date: string } | null;
};

/** Reads the totals again from the rows of settlements kept with older (or no) totals. */
async function refreshTotals(tx: Transaction, ids: readonly string[]) {
  if (!ids.length) return;
  const stale = await tx
    .select({ id: walmartSettlements.id, columns: walmartSettlements.columns })
    .from(walmartSettlements)
    .where(
      and(
        inArray(walmartSettlements.id, [...ids]),
        or(
          isNull(walmartSettlements.totalsVersion),
          ne(walmartSettlements.totalsVersion, WALMART_READER_VERSION),
        ),
      ),
    );
  for (const s of stale) {
    const rows = (await walmartSettlementRowsOf(tx, s.id)).map((r) => r.data);
    await tx
      .update(walmartSettlements)
      .set({
        totals: storeWalmartTotals(walmartSettlementTotals(s.columns, rows)),
        totalsVersion: WALMART_READER_VERSION,
      })
      .where(eq(walmartSettlements.id, s.id));
  }
}

/** Every Walmart settlement, newest first, with where it is in the books. */
export async function walmartPostingList(
  tx: Transaction,
  options: { channelId?: string } = {},
): Promise<WalmartPostingRow[]> {
  const where = options.channelId ? eq(walmartSettlements.channelId, options.channelId) : undefined;
  const ids = await tx.select({ id: walmartSettlements.id }).from(walmartSettlements).where(where);
  await refreshTotals(
    tx,
    ids.map((r) => r.id),
  );
  const [{ postFrom }, accounts] = await Promise.all([
    getWalmartSettings(tx),
    getWalmartAccounts(tx),
  ]);
  const posted = sql<boolean>`exists (select 1 from journal_entries p
    where p.id = ${walmartSettlements.journalEntryId} and p.reversed_by_entry_id is null)`;
  const matched = sql<boolean>`exists (select 1 from journal_entries d
    where d.id = ${walmartSettlements.depositEntryId} and d.reversed_by_entry_id is null)`;
  const rows = await tx
    .select({
      s: walmartSettlements,
      channelName: salesChannels.name,
      channelCurrency: salesChannels.currency,
      posted,
      matched,
      entryNumber: sql<number | null>`(select entry_number from journal_entries
        where id = ${walmartSettlements.journalEntryId})`,
      depositNumber: sql<number | null>`(select entry_number from journal_entries
        where id = ${walmartSettlements.depositEntryId})`,
      depositDate: sql<string | null>`(select date::text from journal_entries
        where id = ${walmartSettlements.depositEntryId})`,
    })
    .from(walmartSettlements)
    .innerJoin(salesChannels, eq(salesChannels.id, walmartSettlements.channelId))
    .where(where)
    .orderBy(desc(walmartSettlements.reportDate), salesChannels.name);
  return rows.map(({ s, ...r }) => {
    const totals = readWalmartTotals(s.totals ?? null);
    const payout = s.payout === null ? null : String(s.payout);
    const problem = walmartSettlementProblem(totals, payout);
    const date = s.periodTo ?? s.reportDate;
    const isPosted = r.posted && s.journalEntryId && r.entryNumber !== null;
    const changed =
      isPosted &&
      totals !== null &&
      (parseDecimal(String(s.postedNet ?? "0")) !== totals.net || s.postedRows !== s.rows);
    const state: WalmartSettlementState =
      isPosted && !changed
        ? "posted"
        : !postFrom || !accounts.balance
          ? "notSetUp"
          : date < postFrom
            ? "before"
            : problem
              ? "problem"
              : totals && totals.net === 0n && Object.values(totals.groups).every((v) => v === 0n)
                ? "empty"
                : isPosted
                  ? "changed"
                  : "ready";
    return {
      id: s.id,
      channelId: s.channelId,
      channelName: r.channelName,
      reportDate: s.reportDate,
      periodFrom: s.periodFrom,
      periodTo: s.periodTo,
      date,
      currency: s.currency ?? r.channelCurrency,
      payout,
      rows: s.rows,
      totals,
      problem,
      state,
      posted:
        isPosted && s.journalEntryId && r.entryNumber !== null
          ? {
              net: String(s.postedNet ?? "0"),
              entryId: s.journalEntryId,
              entryLabel: formatEntryNumber(r.entryNumber),
              rate: s.postedFxRate === null ? null : String(s.postedFxRate),
            }
          : null,
      deposit:
        r.matched && s.depositEntryId && r.depositNumber !== null && r.depositDate
          ? {
              entryId: s.depositEntryId,
              entryLabel: formatEntryNumber(r.depositNumber),
              date: r.depositDate,
            }
          : null,
    };
  });
}

async function postingRow(tx: Transaction, settlementId: string) {
  const [row] = (await walmartPostingList(tx)).filter((s) => s.id === settlementId);
  return row ?? null;
}

const periodLabel = (s: WalmartPostingRow) =>
  s.periodFrom && s.periodTo ? `${s.periodFrom} – ${s.periodTo}` : s.reportDate;

/**
 * Posts a settlement as one entry on its last day (source `walmart`), in Walmart's currency
 * (another currency than the main one at that day's rate). One posted before whose rows changed
 * is taken out and posted again. Fails, in plain words, when it isn't ready.
 */
export async function postWalmartSettlement(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string; baseCurrency: string },
) {
  // One at a time per company, so a double click can't post a settlement twice.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('walmart-post:' || ${input.orgId}))`);
  const row = await postingRow(tx, input.settlementId);
  if (!row) throw new LedgerError("This Walmart settlement no longer exists.");
  if (row.state === "posted") throw new LedgerError("This settlement is in the books already.");
  if (row.state === "notSetUp") throw new LedgerError("Choose how Walmart posts first.");
  if (row.state === "before") {
    throw new LedgerError("This settlement is before Walmart posting starts.");
  }
  if (row.state === "problem") throw new LedgerError(row.problem ?? "This settlement can't post.");
  if (row.state === "empty" || !row.totals) {
    throw new LedgerError("This settlement has nothing to post.");
  }
  const accounts = await getWalmartAccounts(tx);
  const built = buildWalmartEntry({ groups: row.totals.groups, accounts });
  if (!built.ok) throw new LedgerError(built.error);
  if (row.posted) {
    // Changed since posted: out of the books on its own date, then in again as it is now.
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: row.posted.entryId,
      date: row.date,
    });
  }
  const posted = await postClearingEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: row.date,
    reference: `WMT-${row.reportDate}`,
    memo: `${row.channelName} settlement · ${periodLabel(row)}`,
    source: "walmart",
    sourceId: row.id,
    currency: row.currency,
    baseCurrency: input.baseCurrency,
    lines: built.lines,
    total: built.net,
    clearingId: accounts.balance ?? "",
    what: "settlement",
  });
  await tx
    .update(walmartSettlements)
    .set({
      journalEntryId: posted.id,
      postedNet: built.net,
      postedRows: row.rows,
      postedFxRate: posted.rate,
    })
    .where(eq(walmartSettlements.id, row.id));
  return { ...posted, net: built.net, currency: row.currency, again: Boolean(row.posted) };
}

/** Takes a settlement out of the books: its entry is reversed on the same day. */
export async function unpostWalmartSettlement(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string },
) {
  const row = await postingRow(tx, input.settlementId);
  if (!row?.posted) throw new LedgerError("This settlement isn't in the books.");
  await reverseJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: row.posted.entryId,
    date: row.date,
  });
  await tx
    .update(walmartSettlements)
    .set({ journalEntryId: null, postedNet: null, postedRows: null, postedFxRate: null })
    .where(eq(walmartSettlements.id, row.id));
}

/** Settlements ready to post (or changed since posted), oldest first. */
export async function walmartSettlementsToPost(tx: Transaction) {
  return (await walmartPostingList(tx))
    .filter((s) => s.state === "ready" || s.state === "changed")
    .sort((a, b) => a.date.localeCompare(b.date) || a.reportDate.localeCompare(b.reportDate));
}

// --- Payouts ---------------------------------------------------------------------------------

/** A settlement's payout can be matched once it's posted and Walmart says what it paid. */
const payable = (s: WalmartPostingRow) =>
  s.posted !== null && s.payout !== null && parseDecimal(s.payout) !== 0n;

/**
 * Bank deposits that could be a settlement's payout (`depositCandidates`): its amount, from a few
 * days before the report date to ten after, not on the Walmart balance account already, not
 * turned down for it.
 */
export async function walmartPayoutCandidates(
  tx: Transaction,
  settlementId: string,
  onlyEntryId?: string,
): Promise<DepositCandidate[]> {
  const row = await postingRow(tx, settlementId);
  if (!row?.payout || !payable(row)) return [];
  const { from, to } = settlementDepositWindow({ depositDate: row.reportDate, endDate: row.date });
  return depositCandidates(tx, {
    total: row.payout,
    currency: row.currency,
    from,
    to,
    anchor: row.reportDate,
    clearing: (await getWalmartAccounts(tx)).balance ?? null,
    notDismissed: sql`not exists (select 1 from walmart_deposit_dismissals x
        where x.settlement_id = ${row.id} and x.journal_entry_id = e.id)`,
    onlyEntryId,
  });
}

/**
 * Matches a settlement's payout to its bank deposit: the deposit is replaced with its money line
 * kept and the rest moved to the Walmart balance account (`moveDepositToClearing`), so the payout
 * comes out of Walmart's balance instead of counting as income again.
 */
export async function matchWalmartPayout(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    settlementId: string;
    entryId: string;
    baseCurrency: string;
  },
) {
  const [locked] = await tx
    .select({ id: walmartSettlements.id })
    .from(walmartSettlements)
    .where(eq(walmartSettlements.id, input.settlementId))
    .for("update");
  if (!locked) throw new LedgerError("This settlement no longer exists.");
  const row = await postingRow(tx, input.settlementId);
  if (!row) throw new LedgerError("This settlement no longer exists.");
  if (row.deposit) throw new LedgerError("This payout's deposit is matched already.");
  if (!row.posted) throw new LedgerError("Post the settlement first.");
  if (!row.payout || !payable(row)) throw new LedgerError("Walmart paid nothing out for this one.");
  const balance = (await getWalmartAccounts(tx)).balance;
  if (!balance) throw new LedgerError("Choose the Walmart balance account first.");
  const [candidate] = await walmartPayoutCandidates(tx, row.id, input.entryId);
  if (!candidate) {
    throw new LedgerError(
      "This deposit can't be matched to the payout (it changed, or doesn't fit). Refresh to see the latest.",
    );
  }
  let payoutBase = row.payout;
  if (row.currency !== input.baseCurrency) {
    // At the rate the settlement posted at, so the Walmart balance clears to zero.
    const rate =
      row.posted.rate ??
      (await fxRateOn(tx, { base: input.baseCurrency, quote: row.currency, date: row.date }))
        ?.rate ??
      null;
    if (!rate) {
      throw new LedgerError(
        `There's no ${row.currency} to ${input.baseCurrency} exchange rate for ${row.date} yet. Try again tomorrow.`,
      );
    }
    payoutBase = formatDecimal(
      convertUnits(parseDecimal(row.payout), rate, minorUnits(input.baseCurrency)),
    );
  }
  const posted = await moveDepositToClearing(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: input.entryId,
    clearing: balance,
    currency: row.currency,
    baseCurrency: input.baseCurrency,
    total: row.payout,
    payoutBase,
    description: `Walmart payout ${row.reportDate}`,
  });
  await tx
    .update(walmartSettlements)
    .set({ depositEntryId: posted.id, depositOriginalEntryId: input.entryId })
    .where(eq(walmartSettlements.id, row.id));
  return { ...posted, label: formatEntryNumber(posted.entryNumber), was: candidate };
}

/** Undoes a match: the deposit goes back to how it was, and isn't suggested for it again. */
export async function unmatchWalmartPayout(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string },
) {
  const [s] = await tx
    .select({
      id: walmartSettlements.id,
      depositEntryId: walmartSettlements.depositEntryId,
      depositOriginalEntryId: walmartSettlements.depositOriginalEntryId,
      matched: sql<boolean>`exists (select 1 from journal_entries d
        where d.id = ${walmartSettlements.depositEntryId} and d.reversed_by_entry_id is null)`,
    })
    .from(walmartSettlements)
    .where(eq(walmartSettlements.id, input.settlementId))
    .for("update");
  if (!s?.matched || !s.depositEntryId || !s.depositOriginalEntryId) {
    throw new LedgerError("This payout's deposit isn't matched.");
  }
  const posted = await restoreDeposit(tx, {
    orgId: input.orgId,
    userId: input.userId,
    currentId: s.depositEntryId,
    originalId: s.depositOriginalEntryId,
  });
  await tx
    .update(walmartSettlements)
    .set({ depositEntryId: null, depositOriginalEntryId: null })
    .where(eq(walmartSettlements.id, s.id));
  await dismissWalmartPayoutDeposit(tx, { ...input, entryId: posted.id });
  return posted;
}

/** "Not this one": the deposit isn't suggested for this settlement's payout again. */
export async function dismissWalmartPayoutDeposit(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string; entryId: string },
) {
  await tx
    .insert(walmartDepositDismissals)
    .values({
      organizationId: input.orgId,
      settlementId: input.settlementId,
      journalEntryId: input.entryId,
      createdBy: input.userId,
    })
    .onConflictDoNothing();
}

/**
 * Posted settlements whose payout isn't matched yet and has exactly one deposit of the same
 * amount in the same currency: the ones "Match N payouts" can do without a look.
 */
export async function walmartPayoutsWithOneDeposit(tx: Transaction, limit = 50) {
  const found: { settlementId: string; deposit: DepositCandidate }[] = [];
  const open = (await walmartPostingList(tx)).filter((s) => payable(s) && !s.deposit);
  for (const s of open.reverse()) {
    const exact = (await walmartPayoutCandidates(tx, s.id)).filter((c) => c.fit.kind === "exact");
    if (exact.length === 1 && exact[0]) {
      found.push({ settlementId: s.id, deposit: exact[0] });
      if (found.length >= limit) break;
    }
  }
  return found;
}

import {
  buildEbayEntry,
  convertUnits,
  EBAY_ACCOUNT_KEYS,
  type EbayAccountKey,
  type EbayAccounts,
  type EbayPayout,
  type EbaySum,
  ebayGroupTotals,
  ebayMonthNet,
  ebayPayoutSent,
  formatDecimal,
  minorUnits,
  monthEnd,
  type NoonMonthState,
  noonMonthState,
  parseDecimal,
  settlementDepositWindow,
} from "@bookalyze/core";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { ebayMonths } from "./ebay-transactions";
import { fxRateOn } from "./fx";
import { formatEntryNumber, LedgerError, reverseJournalEntry } from "./ledger";
import { journalEntries } from "./schema/accounting";
import {
  ebayAccounts,
  ebayDepositDismissals,
  ebayPayouts,
  ebayPeriods,
  ebaySettings,
  salesChannels,
} from "./schema/commerce";
import {
  type DepositCandidate,
  depositCandidates,
  moveDepositToClearing,
  postClearingEntry,
  restoreDeposit,
} from "./settlements";

/**
 * eBay in the books (phase 4d, slice 5). Run inside `withOrg()`. Each eBay site's month posts as
 * one entry, the net to the eBay balance account (core `buildEbayEntry`); each payout is matched
 * to its bank deposit, which moves it out of the eBay balance. Same shape as Noon's.
 */

// --- Setup -----------------------------------------------------------------------------------

export async function getEbayAccounts(tx: Transaction): Promise<EbayAccounts> {
  const rows = await tx.select().from(ebayAccounts);
  return Object.fromEntries(
    rows
      .filter((r) => (EBAY_ACCOUNT_KEYS as string[]).includes(r.key))
      .map((r) => [r.key, r.accountId]),
  ) as EbayAccounts;
}

export async function getEbaySettings(tx: Transaction) {
  const [row] = await tx.select().from(ebaySettings).limit(1);
  return { postFrom: row?.postFrom ?? null, autoPost: row?.autoPost ?? false };
}

/** Saves the accounts (all of them: kinds left out are cleared) and the month posting starts. */
export async function saveEbaySetup(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    accounts: EbayAccounts;
    postFrom: string;
    autoPost?: boolean;
  },
) {
  await tx.delete(ebayAccounts);
  const rows = Object.entries(input.accounts).filter(
    (e): e is [EbayAccountKey, string] => typeof e[1] === "string" && e[1] !== "",
  );
  if (rows.length) {
    await tx
      .insert(ebayAccounts)
      .values(rows.map(([key, accountId]) => ({ organizationId: input.orgId, key, accountId })));
  }
  const values = {
    postFrom: input.postFrom,
    autoPost: input.autoPost ?? false,
    updatedBy: input.userId,
    updatedAt: new Date(),
  };
  await tx
    .insert(ebaySettings)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: ebaySettings.organizationId, set: values });
}

// --- Months ----------------------------------------------------------------------------------

export type EbayMonthRow = {
  channelId: string;
  channelName: string;
  currency: string;
  month: string;
  rows: number;
  sums: EbaySum[];
  /** What the month did to the eBay balance (money moved included). */
  net: string;
  state: NoonMonthState;
  posted: { net: string; rows: number; entryId: string; entryLabel: string } | null;
};

/** Posted periods (entry not reversed), by channel and month. */
async function postedPeriods(tx: Transaction) {
  const rows = await tx
    .select({
      id: ebayPeriods.id,
      channelId: ebayPeriods.channelId,
      month: ebayPeriods.month,
      net: ebayPeriods.net,
      rows: ebayPeriods.rows,
      rate: ebayPeriods.postedFxRate,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
    })
    .from(ebayPeriods)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.id, ebayPeriods.journalEntryId),
        sql`${journalEntries.reversedByEntryId} is null`,
      ),
    );
  return new Map(rows.map((r) => [`${r.channelId}|${r.month}`, r]));
}

/** Each eBay site's months, newest first, with where they are in the books. */
export async function ebayPostingMonths(tx: Transaction, today: string): Promise<EbayMonthRow[]> {
  const [{ postFrom }, posted, months] = await Promise.all([
    getEbaySettings(tx),
    postedPeriods(tx),
    ebayMonths(tx),
  ]);
  return months.map((m) => {
    const p = posted.get(`${m.channelId}|${m.month}`);
    const net = ebayMonthNet(m.sums);
    const { groups } = ebayGroupTotals(m.sums);
    return {
      ...m,
      net,
      state: noonMonthState({
        month: m.month,
        today,
        postFrom,
        posted: p ? { earned: String(p.net), rows: p.rows } : null,
        current: { earned: net, rows: m.rows },
        empty: Object.values(groups).every((v) => v === 0n),
      }),
      posted: p
        ? {
            net: String(p.net),
            rows: p.rows,
            entryId: p.entryId,
            entryLabel: formatEntryNumber(p.entryNumber),
          }
        : null,
    };
  });
}

/** The rate each posted month went into the books at (Channel profit converts with it). */
export async function ebayPostedRates(tx: Transaction): Promise<Map<string, string | null>> {
  const posted = await postedPeriods(tx);
  return new Map([...posted.entries()].map(([k, p]) => [k, p.rate]));
}

/**
 * Posts an eBay site's month as one entry on its last day (source `ebay`), in eBay's currency
 * (another currency than the main one at that day's rate). A month posted before whose rows
 * changed is taken out and posted again. Fails, in plain words, when it isn't ready.
 */
export async function postEbayMonth(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    channelId: string;
    month: string;
    baseCurrency: string;
    today: string;
  },
) {
  // One at a time per company, so a double click can't post a month twice.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ebay-post:' || ${input.orgId}))`);
  const [channel] = await tx
    .select({ name: salesChannels.name })
    .from(salesChannels)
    .where(and(eq(salesChannels.id, input.channelId), eq(salesChannels.kind, "ebay")));
  if (!channel) throw new LedgerError("This eBay site no longer exists.");
  const [row] = (await ebayPostingMonths(tx, input.today)).filter(
    (m) => m.channelId === input.channelId && m.month === input.month,
  );
  if (!row) throw new LedgerError("This month has no eBay transactions.");
  if (row.state === "posted") throw new LedgerError("This month is in the books already.");
  if (row.state === "notSetUp") throw new LedgerError("Choose how eBay posts first.");
  if (row.state === "before") throw new LedgerError("This month is before eBay posting starts.");
  if (row.state === "empty") throw new LedgerError("This month has nothing to post.");
  if (row.state === "inProgress") {
    throw new LedgerError("This month isn't over yet. Post it once it has ended.");
  }
  const accounts = await getEbayAccounts(tx);
  const built = buildEbayEntry({ sums: row.sums, accounts });
  if (!built.ok) throw new LedgerError(built.error);
  if (row.posted) {
    // Changed since posted: out of the books on its own date, then in again as it is now.
    const [entry] = await tx
      .select({ date: journalEntries.date })
      .from(journalEntries)
      .where(eq(journalEntries.id, row.posted.entryId));
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: row.posted.entryId,
      date: entry?.date ?? monthEnd(input.month),
    });
  }
  const [period] = await tx
    .insert(ebayPeriods)
    .values({
      organizationId: input.orgId,
      channelId: input.channelId,
      month: input.month,
      currency: row.currency,
      net: built.net,
      rows: 0,
      createdBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [ebayPeriods.organizationId, ebayPeriods.channelId, ebayPeriods.month],
      set: { updatedAt: new Date() },
    })
    .returning({ id: ebayPeriods.id });
  if (!period) throw new LedgerError("The month couldn't be saved.");
  const label = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${input.month}-01T00:00:00Z`));
  const posted = await postClearingEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: monthEnd(input.month),
    reference: `EBAY-${input.month}`,
    memo: `${channel.name} · ${label}`,
    source: "ebay",
    sourceId: period.id,
    currency: row.currency,
    baseCurrency: input.baseCurrency,
    lines: built.lines,
    total: built.net,
    clearingId: accounts.balance ?? "",
    what: "month",
  });
  await tx
    .update(ebayPeriods)
    .set({
      currency: row.currency,
      net: built.net,
      rows: row.rows,
      journalEntryId: posted.id,
      postedFxRate: posted.rate,
      updatedAt: new Date(),
    })
    .where(eq(ebayPeriods.id, period.id));
  return { ...posted, net: built.net, currency: row.currency, again: Boolean(row.posted) };
}

/** Takes a month out of the books: its entry is reversed on the same day. */
export async function unpostEbayMonth(
  tx: Transaction,
  input: { orgId: string; userId: string | null; channelId: string; month: string },
) {
  const p = (await postedPeriods(tx)).get(`${input.channelId}|${input.month}`);
  if (!p) throw new LedgerError("This month isn't in the books.");
  const [entry] = await tx
    .select({ date: journalEntries.date })
    .from(journalEntries)
    .where(eq(journalEntries.id, p.entryId));
  await reverseJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: p.entryId,
    date: entry?.date ?? monthEnd(input.month),
  });
  await tx.update(ebayPeriods).set({ journalEntryId: null }).where(eq(ebayPeriods.id, p.id));
}

/** Months ready to post (or changed since posted), oldest first. */
export async function ebayMonthsToPost(tx: Transaction, today: string) {
  return (await ebayPostingMonths(tx, today))
    .filter((m) => m.state === "ready" || m.state === "changed")
    .sort((a, b) => a.month.localeCompare(b.month));
}

// --- Payouts ---------------------------------------------------------------------------------

/** Saves payouts as eBay reports them (new ones added, known ones' status and amount updated). */
export async function importEbayPayouts(
  tx: Transaction,
  input: { orgId: string; payouts: readonly EbayPayout[] },
): Promise<number> {
  if (!input.payouts.length) return 0;
  const saved = await tx
    .insert(ebayPayouts)
    .values(
      input.payouts.map((p) => ({
        organizationId: input.orgId,
        payoutId: p.payoutId,
        status: p.status,
        payoutAt: new Date(p.payoutDate),
        payoutDate: p.payoutDate.slice(0, 10),
        currency: p.currency,
        amount: p.amount,
        accountLast4: p.accountLast4,
      })),
    )
    .onConflictDoUpdate({
      target: [ebayPayouts.organizationId, ebayPayouts.payoutId],
      set: {
        status: sql`excluded.status`,
        payoutAt: sql`excluded.payout_at`,
        payoutDate: sql`excluded.payout_date`,
        currency: sql`excluded.currency`,
        amount: sql`excluded.amount`,
        accountLast4: sql`excluded.account_last4`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return saved.filter((s) => s.inserted).length;
}

export type EbayPayoutRow = {
  id: string;
  payoutId: string;
  status: string;
  /** Sent (or on its way): a bank deposit can match it. */
  sent: boolean;
  date: string;
  currency: string;
  amount: string;
  accountLast4: string | null;
  /** Before eBay posting starts: the books have it already. */
  before: boolean;
  matched: { entryId: string; entryLabel: string; date: string } | null;
};

const matchedDeposit = sql<boolean>`exists (select 1 from journal_entries d
  where d.id = ${ebayPayouts.depositEntryId} and d.reversed_by_entry_id is null)`;

/** eBay's payouts, newest first, with their matched deposit. */
export async function ebayPayoutList(tx: Transaction): Promise<EbayPayoutRow[]> {
  const { postFrom } = await getEbaySettings(tx);
  const rows = await tx
    .select({
      id: ebayPayouts.id,
      payoutId: ebayPayouts.payoutId,
      status: ebayPayouts.status,
      date: ebayPayouts.payoutDate,
      currency: ebayPayouts.currency,
      amount: ebayPayouts.amount,
      accountLast4: ebayPayouts.accountLast4,
      matched: matchedDeposit,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.date,
    })
    .from(ebayPayouts)
    .leftJoin(journalEntries, eq(journalEntries.id, ebayPayouts.depositEntryId))
    .orderBy(desc(ebayPayouts.payoutAt));
  return rows.map((r) => ({
    id: r.id,
    payoutId: r.payoutId,
    status: r.status,
    sent: ebayPayoutSent(r.status),
    date: r.date,
    currency: r.currency,
    amount: String(r.amount),
    accountLast4: r.accountLast4,
    before: !postFrom || r.date < postFrom,
    matched:
      r.matched && r.entryId && r.entryNumber !== null && r.entryDate
        ? { entryId: r.entryId, entryLabel: formatEntryNumber(r.entryNumber), date: r.entryDate }
        : null,
  }));
}

async function payoutRow(tx: Transaction, id: string) {
  const [r] = await tx
    .select({
      id: ebayPayouts.id,
      payoutId: ebayPayouts.payoutId,
      status: ebayPayouts.status,
      date: ebayPayouts.payoutDate,
      currency: ebayPayouts.currency,
      amount: ebayPayouts.amount,
      depositEntryId: ebayPayouts.depositEntryId,
      depositOriginalEntryId: ebayPayouts.depositOriginalEntryId,
      matched: matchedDeposit,
    })
    .from(ebayPayouts)
    .where(eq(ebayPayouts.id, id))
    .for("update");
  return r ?? null;
}

/**
 * Bank deposits that could be an eBay payout (`depositCandidates`): its amount, a few days before
 * eBay's date to ten after, not on the eBay balance account already, not turned down for it.
 */
export async function ebayPayoutCandidates(
  tx: Transaction,
  payoutId: string,
  onlyEntryId?: string,
): Promise<DepositCandidate[]> {
  const [r] = await tx
    .select({
      id: ebayPayouts.id,
      status: ebayPayouts.status,
      date: ebayPayouts.payoutDate,
      currency: ebayPayouts.currency,
      amount: ebayPayouts.amount,
    })
    .from(ebayPayouts)
    .where(eq(ebayPayouts.id, payoutId));
  if (!r || !ebayPayoutSent(r.status)) return [];
  const { from, to } = settlementDepositWindow({ depositDate: r.date, endDate: r.date });
  return depositCandidates(tx, {
    total: String(r.amount),
    currency: r.currency,
    from,
    to,
    anchor: r.date,
    clearing: (await getEbayAccounts(tx)).balance ?? null,
    notDismissed: sql`not exists (select 1 from ebay_deposit_dismissals x
        where x.payout_id = ${r.id} and x.journal_entry_id = e.id)`,
    onlyEntryId,
  });
}

/**
 * Matches an eBay payout to its bank deposit: the deposit is replaced with its money line kept and
 * the rest moved to the eBay balance account (`moveDepositToClearing`), so the payout comes out of
 * eBay's balance instead of counting as income again.
 */
export async function matchEbayPayout(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    payoutId: string;
    entryId: string;
    baseCurrency: string;
  },
) {
  const r = await payoutRow(tx, input.payoutId);
  if (!r) throw new LedgerError("This payout no longer exists.");
  if (!ebayPayoutSent(r.status)) throw new LedgerError("eBay didn't send this payout.");
  if (r.matched) throw new LedgerError("This payout's deposit is matched already.");
  const { postFrom } = await getEbaySettings(tx);
  if (!postFrom) throw new LedgerError("Choose how eBay posts first.");
  if (r.date < postFrom) {
    throw new LedgerError("This payout is before eBay posting starts: your books have it already.");
  }
  const balance = (await getEbayAccounts(tx)).balance;
  if (!balance) throw new LedgerError("Choose the eBay balance account first.");
  const [candidate] = await ebayPayoutCandidates(tx, r.id, input.entryId);
  if (!candidate) {
    throw new LedgerError(
      "This deposit can't be matched to the payout (it changed, or doesn't fit). Refresh to see the latest.",
    );
  }
  const total = String(r.amount);
  let payoutBase = total;
  if (r.currency !== input.baseCurrency) {
    const quote = await fxRateOn(tx, { base: input.baseCurrency, quote: r.currency, date: r.date });
    if (!quote) {
      throw new LedgerError(
        `There's no ${r.currency} to ${input.baseCurrency} exchange rate for ${r.date} yet. Try again tomorrow.`,
      );
    }
    payoutBase = formatDecimal(
      convertUnits(parseDecimal(total), quote.rate, minorUnits(input.baseCurrency)),
    );
  }
  const posted = await moveDepositToClearing(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: input.entryId,
    clearing: balance,
    currency: r.currency,
    baseCurrency: input.baseCurrency,
    total,
    payoutBase,
    description: `eBay payout ${r.payoutId}`,
  });
  await tx
    .update(ebayPayouts)
    .set({ depositEntryId: posted.id, depositOriginalEntryId: input.entryId })
    .where(eq(ebayPayouts.id, r.id));
  return { ...posted, label: formatEntryNumber(posted.entryNumber), was: candidate };
}

/** Undoes a match: the deposit goes back to how it was, and isn't suggested for it again. */
export async function unmatchEbayPayout(
  tx: Transaction,
  input: { orgId: string; userId: string | null; payoutId: string },
) {
  const r = await payoutRow(tx, input.payoutId);
  if (!r?.matched || !r.depositEntryId || !r.depositOriginalEntryId) {
    throw new LedgerError("This payout's deposit isn't matched.");
  }
  const posted = await restoreDeposit(tx, {
    orgId: input.orgId,
    userId: input.userId,
    currentId: r.depositEntryId,
    originalId: r.depositOriginalEntryId,
  });
  await tx
    .update(ebayPayouts)
    .set({ depositEntryId: null, depositOriginalEntryId: null })
    .where(eq(ebayPayouts.id, r.id));
  await dismissEbayPayoutDeposit(tx, { ...input, entryId: posted.id });
  return posted;
}

/** "Not this one": the deposit isn't suggested for this payout again. */
export async function dismissEbayPayoutDeposit(
  tx: Transaction,
  input: { orgId: string; userId: string | null; payoutId: string; entryId: string },
) {
  await tx
    .insert(ebayDepositDismissals)
    .values({
      organizationId: input.orgId,
      payoutId: input.payoutId,
      journalEntryId: input.entryId,
      createdBy: input.userId,
    })
    .onConflictDoNothing();
}

/**
 * Payouts from when eBay posting starts, sent and not matched yet, with exactly one deposit of
 * the same amount in the same currency: the ones "Match N payouts" can do without a look.
 */
export async function ebayPayoutsWithOneDeposit(tx: Transaction, limit = 50) {
  const found: { payoutId: string; deposit: DepositCandidate }[] = [];
  const payouts = (await ebayPayoutList(tx)).filter((p) => p.sent && !p.before && !p.matched);
  for (const p of payouts.reverse()) {
    const exact = (await ebayPayoutCandidates(tx, p.id)).filter((c) => c.fit.kind === "exact");
    if (exact.length === 1 && exact[0]) {
      found.push({ payoutId: p.id, deposit: exact[0] });
      if (found.length >= limit) break;
    }
  }
  return found;
}

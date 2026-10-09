import {
  buildNoonEntry,
  convertUnits,
  formatDecimal,
  minorUnits,
  monthEnd,
  NOON_ACCOUNT_KEYS,
  NOON_ADVERTISING_PATTERN,
  NOON_AMOUNT_FIELDS,
  NOON_PAYOUT_TYPE,
  type NoonAccountKey,
  type NoonAccounts,
  type NoonAmountField,
  type NoonGroupTotals,
  type NoonMonthState,
  type NoonSum,
  noonGroupTotals,
  noonMonthState,
  parseDecimal,
  settlementDepositWindow,
} from "@bookalyze/core";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { fxRateOn } from "./fx";
import { formatEntryNumber, LedgerError, reverseJournalEntry } from "./ledger";
import { journalEntries } from "./schema/accounting";
import {
  noonAccounts,
  noonDepositDismissals,
  noonPeriods,
  noonSettings,
  noonTransactions,
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
 * Noon in the books (phase 4c, slice 4). Run inside `withOrg()`. Each Noon country's month posts
 * as one entry, the net to the Noon balance account (core `buildNoonEntry`); each payment row is
 * matched to its bank deposit, which moves the payout out of the Noon balance. Noon's balance in
 * the books then ends at what Noon owes.
 */

// --- Setup -----------------------------------------------------------------------------------

export async function getNoonAccounts(tx: Transaction): Promise<NoonAccounts> {
  const rows = await tx.select().from(noonAccounts);
  return Object.fromEntries(
    rows
      .filter((r) => (NOON_ACCOUNT_KEYS as string[]).includes(r.key))
      .map((r) => [r.key, r.accountId]),
  ) as NoonAccounts;
}

export async function getNoonSettings(tx: Transaction) {
  const [row] = await tx.select().from(noonSettings).limit(1);
  return { postFrom: row?.postFrom ?? null };
}

/** Saves the accounts (all of them: kinds left out are cleared) and the month posting starts. */
export async function saveNoonSetup(
  tx: Transaction,
  input: { orgId: string; userId: string | null; accounts: NoonAccounts; postFrom: string },
) {
  await tx.delete(noonAccounts);
  const rows = Object.entries(input.accounts).filter(
    (e): e is [NoonAccountKey, string] => typeof e[1] === "string" && e[1] !== "",
  );
  if (rows.length) {
    await tx
      .insert(noonAccounts)
      .values(rows.map(([key, accountId]) => ({ organizationId: input.orgId, key, accountId })));
  }
  const values = { postFrom: input.postFrom, updatedBy: input.userId, updatedAt: new Date() };
  await tx
    .insert(noonSettings)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: noonSettings.organizationId, set: values });
}

// --- Months ----------------------------------------------------------------------------------

const month = sql<string>`to_char(${noonTransactions.transactionDate}, 'YYYY-MM')`;
const isPayout = sql<boolean>`lower(regexp_replace(trim(${noonTransactions.transactionType}), '[^A-Za-z]+', '_', 'g')) = ${NOON_PAYOUT_TYPE}`;
// Inlined (a fixed word from core), so the same expression can be selected and grouped by.
const advertising = sql<boolean>`coalesce(${noonTransactions.title} ~* ${sql.raw(`'${NOON_ADVERTISING_PATTERN.replace(/[^a-z]/g, "")}'`)}, false)`;
const sumOf = (c: unknown) => sql<string>`coalesce(sum(${c}), 0)::text`;
const AMOUNT_COLUMNS: Record<NoonAmountField, (typeof noonTransactions)[NoonAmountField]> = {
  netProceeds: noonTransactions.netProceeds,
  referralFee: noonTransactions.referralFee,
  fulfilmentFee: noonTransactions.fulfilmentFee,
  shippingCredits: noonTransactions.shippingCredits,
  otherOrderFees: noonTransactions.otherOrderFees,
  orderSubsidies: noonTransactions.orderSubsidies,
  nonOrderFees: noonTransactions.nonOrderFees,
  nonOrderSubsidies: noonTransactions.nonOrderSubsidies,
  others: noonTransactions.others,
};

/** Rows summed per channel, month, type and "advertising": what core groups. */
async function monthSums(tx: Transaction, only?: { channelId: string; month: string }) {
  const rows = await tx
    .select({
      channelId: noonTransactions.channelId,
      currency: noonTransactions.currency,
      month,
      transactionType: noonTransactions.transactionType,
      advertising,
      payout: isPayout,
      rows: sql<number>`count(*)::int`,
      unbalanced: sql<number>`count(*) filter (where not ${noonTransactions.balanced})::int`,
      total: sumOf(noonTransactions.total),
      ...Object.fromEntries(NOON_AMOUNT_FIELDS.map((f) => [f, sumOf(AMOUNT_COLUMNS[f])])),
    })
    .from(noonTransactions)
    .where(
      only
        ? and(eq(noonTransactions.channelId, only.channelId), sql`${month} = ${only.month}`)
        : undefined,
    )
    .groupBy(
      noonTransactions.channelId,
      noonTransactions.currency,
      month,
      noonTransactions.transactionType,
      advertising,
    );
  return rows.map((r) => {
    const amounts = Object.fromEntries(
      NOON_AMOUNT_FIELDS.map((f) => [f, String((r as Record<string, unknown>)[f] ?? "0")]),
    ) as Record<NoonAmountField, string>;
    const sum: NoonSum = {
      transactionType: r.transactionType,
      advertising: r.advertising,
      amounts,
      total: r.total,
    };
    return { ...r, sum };
  });
}

export type NoonMonthRow = {
  channelId: string;
  currency: string;
  /** "2026-09". */
  month: string;
  rows: number;
  unbalanced: number;
  groups: Record<keyof NoonGroupTotals, string>;
  /** What the month added to Noon's balance (everything but payouts). */
  earned: string;
  /** What Noon paid out that month (positive). */
  paidOut: string;
  state: NoonMonthState;
  /** In the books (entry not reversed): what it held then, and the entry. */
  posted: { earned: string; rows: number; entryId: string; entryLabel: string } | null;
};

type Grouped = {
  channelId: string;
  currency: string;
  month: string;
  rows: number;
  postingRows: number;
  unbalanced: number;
  sums: NoonSum[];
};

function group(rows: Awaited<ReturnType<typeof monthSums>>): Grouped[] {
  const byMonth = new Map<string, Grouped>();
  for (const r of rows) {
    const id = `${r.channelId}|${r.month}`;
    const g = byMonth.get(id) ?? {
      channelId: r.channelId,
      currency: r.currency,
      month: r.month,
      rows: 0,
      postingRows: 0,
      unbalanced: 0,
      sums: [],
    };
    g.rows += r.rows;
    if (!r.payout) g.postingRows += r.rows;
    g.unbalanced += r.unbalanced;
    g.sums.push(r.sum);
    byMonth.set(id, g);
  }
  return [...byMonth.values()];
}

/** Posted periods (entry not reversed), by channel and month. */
async function postedPeriods(tx: Transaction) {
  const rows = await tx
    .select({
      id: noonPeriods.id,
      channelId: noonPeriods.channelId,
      month: noonPeriods.month,
      earned: noonPeriods.earned,
      rows: noonPeriods.rows,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
    })
    .from(noonPeriods)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.id, noonPeriods.journalEntryId),
        sql`${journalEntries.reversedByEntryId} is null`,
      ),
    );
  return new Map(rows.map((r) => [`${r.channelId}|${r.month}`, r]));
}

/** Each Noon country's months, newest first, with their groups and where they are. */
export async function noonMonths(tx: Transaction, today: string): Promise<NoonMonthRow[]> {
  const [{ postFrom }, posted] = await Promise.all([getNoonSettings(tx), postedPeriods(tx)]);
  return group(await monthSums(tx))
    .map((g) => {
      const totals = noonGroupTotals(g.sums);
      const p = posted.get(`${g.channelId}|${g.month}`);
      const earned = formatDecimal(totals.earned);
      return {
        channelId: g.channelId,
        currency: g.currency,
        month: g.month,
        rows: g.rows,
        unbalanced: g.unbalanced,
        groups: Object.fromEntries(
          Object.entries(totals.groups).map(([k, v]) => [k, formatDecimal(v)]),
        ) as NoonMonthRow["groups"],
        earned,
        paidOut: formatDecimal(totals.paidOut),
        state: noonMonthState({
          month: g.month,
          today,
          postFrom,
          posted: p ? { earned: String(p.earned), rows: p.rows } : null,
          current: { earned, rows: g.postingRows },
          empty: Object.values(totals.groups).every((v) => v === 0n),
        }),
        posted: p
          ? {
              earned: String(p.earned),
              rows: p.rows,
              entryId: p.entryId,
              entryLabel: formatEntryNumber(p.entryNumber),
            }
          : null,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month) || a.channelId.localeCompare(b.channelId));
}

/**
 * Posts a Noon country's month as one entry on its last day (source `noon`), in its currency
 * (another currency than the main one at that day's rate). A month posted before whose rows
 * changed is taken out and posted again. Fails, in plain words, when it isn't ready.
 */
export async function postNoonMonth(
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
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('noon-post:' || ${input.orgId}))`);
  const [channel] = await tx
    .select({ name: salesChannels.name })
    .from(salesChannels)
    .where(and(eq(salesChannels.id, input.channelId), eq(salesChannels.kind, "noon")));
  if (!channel) throw new LedgerError("This Noon country no longer exists.");
  const [row] = (await noonMonths(tx, input.today)).filter(
    (m) => m.channelId === input.channelId && m.month === input.month,
  );
  if (!row) throw new LedgerError("This month has no Noon transactions.");
  if (row.state === "posted") throw new LedgerError("This month is in the books already.");
  if (row.state === "notSetUp") throw new LedgerError("Choose how Noon posts first.");
  if (row.state === "before") throw new LedgerError("This month is before Noon posting starts.");
  if (row.state === "inProgress") {
    throw new LedgerError("This month isn't over yet. Post it once it has ended.");
  }
  const accounts = await getNoonAccounts(tx);
  const groups = Object.fromEntries(
    Object.entries(row.groups).map(([k, v]) => [k, parseDecimal(v)]),
  ) as NoonGroupTotals;
  const built = buildNoonEntry({ groups, accounts });
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
    .insert(noonPeriods)
    .values({
      organizationId: input.orgId,
      channelId: input.channelId,
      month: input.month,
      currency: row.currency,
      earned: built.earned,
      rows: 0,
      createdBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [noonPeriods.organizationId, noonPeriods.channelId, noonPeriods.month],
      set: { updatedAt: new Date() },
    })
    .returning({ id: noonPeriods.id });
  if (!period) throw new LedgerError("The month couldn't be saved.");
  const date = monthEnd(input.month);
  const label = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${input.month}-01T00:00:00Z`));
  const posted = await postClearingEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date,
    reference: `NOON-${input.month}`,
    memo: `${channel.name} · ${label}`,
    source: "noon",
    sourceId: period.id,
    currency: row.currency,
    baseCurrency: input.baseCurrency,
    lines: built.lines,
    total: built.earned,
    clearingId: accounts.balance ?? "",
    what: "month",
  });
  const postingRows = row.rows - (await payoutRowCount(tx, input.channelId, input.month));
  await tx
    .update(noonPeriods)
    .set({
      currency: row.currency,
      earned: built.earned,
      rows: postingRows,
      journalEntryId: posted.id,
      postedFxRate: posted.rate,
      updatedAt: new Date(),
    })
    .where(eq(noonPeriods.id, period.id));
  return { ...posted, earned: built.earned, currency: row.currency, again: Boolean(row.posted) };
}

async function payoutRowCount(tx: Transaction, channelId: string, m: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(noonTransactions)
    .where(and(eq(noonTransactions.channelId, channelId), sql`${month} = ${m}`, isPayout));
  return r?.n ?? 0;
}

/** Takes a month out of the books: its entry is reversed on the same day. */
export async function unpostNoonMonth(
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
  await tx.update(noonPeriods).set({ journalEntryId: null }).where(eq(noonPeriods.id, p.id));
}

/** Months ready to post (or changed since posted), oldest first. */
export async function noonMonthsToPost(tx: Transaction, today: string) {
  return (await noonMonths(tx, today))
    .filter((m) => m.state === "ready" || m.state === "changed")
    .sort((a, b) => a.month.localeCompare(b.month));
}

// --- Payouts ---------------------------------------------------------------------------------

export type NoonPayout = {
  id: string;
  channelId: string;
  date: string;
  referenceNr: string;
  currency: string;
  /** What Noon paid out (positive). */
  amount: string;
  /** Before Noon posting starts: the books have it already. */
  before: boolean;
  matched: { entryId: string; entryLabel: string; date: string } | null;
};

const matchedDeposit = sql<boolean>`exists (select 1 from journal_entries d
  where d.id = ${noonTransactions.depositEntryId} and d.reversed_by_entry_id is null)`;

/** Noon's payment rows, newest first, with their matched deposit. */
export async function noonPayouts(tx: Transaction): Promise<NoonPayout[]> {
  const { postFrom } = await getNoonSettings(tx);
  const rows = await tx
    .select({
      id: noonTransactions.id,
      channelId: noonTransactions.channelId,
      date: noonTransactions.transactionDate,
      referenceNr: noonTransactions.referenceNr,
      currency: noonTransactions.currency,
      total: noonTransactions.total,
      matched: matchedDeposit,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.date,
    })
    .from(noonTransactions)
    .leftJoin(journalEntries, eq(journalEntries.id, noonTransactions.depositEntryId))
    .where(isPayout)
    .orderBy(sql`${noonTransactions.transactionDate} desc`, asc(noonTransactions.referenceNr));
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    date: r.date,
    referenceNr: r.referenceNr,
    currency: r.currency,
    amount: formatDecimal(-parseDecimal(String(r.total))),
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
      id: noonTransactions.id,
      date: noonTransactions.transactionDate,
      referenceNr: noonTransactions.referenceNr,
      currency: noonTransactions.currency,
      total: noonTransactions.total,
      depositEntryId: noonTransactions.depositEntryId,
      depositOriginalEntryId: noonTransactions.depositOriginalEntryId,
      matched: matchedDeposit,
      payout: isPayout,
    })
    .from(noonTransactions)
    .where(eq(noonTransactions.id, id))
    .for("update");
  return r?.payout ? r : null;
}

/**
 * Bank deposits that could be a Noon payout (`depositCandidates`): its amount, a few days before
 * Noon's date to ten after, not on the Noon balance account already, not turned down for it.
 */
export async function noonPayoutCandidates(
  tx: Transaction,
  transactionId: string,
  onlyEntryId?: string,
): Promise<DepositCandidate[]> {
  const [r] = await tx
    .select({
      id: noonTransactions.id,
      date: noonTransactions.transactionDate,
      currency: noonTransactions.currency,
      total: noonTransactions.total,
    })
    .from(noonTransactions)
    .where(and(eq(noonTransactions.id, transactionId), isPayout));
  if (!r) return [];
  const { from, to } = settlementDepositWindow({ depositDate: r.date, endDate: r.date });
  return depositCandidates(tx, {
    total: formatDecimal(-parseDecimal(String(r.total))),
    currency: r.currency,
    from,
    to,
    anchor: r.date,
    clearing: (await getNoonAccounts(tx)).balance ?? null,
    notDismissed: sql`not exists (select 1 from noon_deposit_dismissals x
        where x.transaction_id = ${r.id} and x.journal_entry_id = e.id)`,
    onlyEntryId,
  });
}

/**
 * Matches a Noon payout to its bank deposit: the deposit is replaced with its money line kept
 * and the rest moved to the Noon balance account (`moveDepositToClearing`), so the payout comes
 * out of Noon's balance instead of counting as income again.
 */
export async function matchNoonPayout(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    transactionId: string;
    entryId: string;
    baseCurrency: string;
  },
) {
  const r = await payoutRow(tx, input.transactionId);
  if (!r) throw new LedgerError("This payout no longer exists.");
  if (r.matched) throw new LedgerError("This payout's deposit is matched already.");
  const { postFrom } = await getNoonSettings(tx);
  if (!postFrom) throw new LedgerError("Choose how Noon posts first.");
  if (r.date < postFrom) {
    throw new LedgerError("This payout is before Noon posting starts: your books have it already.");
  }
  const balance = (await getNoonAccounts(tx)).balance;
  if (!balance) throw new LedgerError("Choose the Noon balance account first.");
  const [candidate] = await noonPayoutCandidates(tx, r.id, input.entryId);
  if (!candidate) {
    throw new LedgerError(
      "This deposit can't be matched to the payout (it changed, or doesn't fit). Refresh to see the latest.",
    );
  }
  const total = formatDecimal(-parseDecimal(String(r.total)));
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
    description: `Noon payout ${r.referenceNr}`,
  });
  await tx
    .update(noonTransactions)
    .set({ depositEntryId: posted.id, depositOriginalEntryId: input.entryId })
    .where(eq(noonTransactions.id, r.id));
  return { ...posted, label: formatEntryNumber(posted.entryNumber), was: candidate };
}

/** Undoes a match: the deposit goes back to how it was, and isn't suggested for it again. */
export async function unmatchNoonPayout(
  tx: Transaction,
  input: { orgId: string; userId: string | null; transactionId: string },
) {
  const r = await payoutRow(tx, input.transactionId);
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
    .update(noonTransactions)
    .set({ depositEntryId: null, depositOriginalEntryId: null })
    .where(eq(noonTransactions.id, r.id));
  await dismissNoonPayoutDeposit(tx, { ...input, entryId: posted.id });
  return posted;
}

/** "Not this one": the deposit isn't suggested for this payout again. */
export async function dismissNoonPayoutDeposit(
  tx: Transaction,
  input: { orgId: string; userId: string | null; transactionId: string; entryId: string },
) {
  await tx
    .insert(noonDepositDismissals)
    .values({
      organizationId: input.orgId,
      transactionId: input.transactionId,
      journalEntryId: input.entryId,
      createdBy: input.userId,
    })
    .onConflictDoNothing();
}

/**
 * Payouts from when Noon posting starts, not matched yet, with exactly one deposit of the same
 * amount in the same currency: the ones "Match N payouts" can do without a look. Oldest first.
 */
export async function noonPayoutsWithOneDeposit(tx: Transaction, limit = 50) {
  const found: { transactionId: string; deposit: DepositCandidate }[] = [];
  const payouts = (await noonPayouts(tx)).filter((p) => !p.before && !p.matched).reverse();
  for (const p of payouts) {
    const exact = (await noonPayoutCandidates(tx, p.id)).filter((c) => c.fit.kind === "exact");
    if (exact.length === 1 && exact[0]) {
      found.push({ transactionId: p.id, deposit: exact[0] });
      if (found.length >= limit) break;
    }
  }
  return found;
}

// --- The balance check -----------------------------------------------------------------------

export type NoonBalanceCheck = {
  currency: string;
  /** The Noon balance account in the books, in this currency. */
  books: string;
  /** What Noon's rows from when posting starts add up to (what Noon owes, by its rows). */
  noon: string;
  /** Why they differ, as far as known: months not in the books (or changed), payouts not matched. */
  notPosted: string;
  monthsNotPosted: number;
  notMatched: string;
  payoutsNotMatched: number;
  /** What's left once those are counted (zero: the books agree with Noon). */
  unexplained: string;
};

/** Noon's balance in the books against Noon's own rows, per currency. */
export async function noonBalanceCheck(
  tx: Transaction,
  today: string,
): Promise<NoonBalanceCheck[]> {
  const [{ postFrom }, accounts] = await Promise.all([getNoonSettings(tx), getNoonAccounts(tx)]);
  if (!postFrom || !accounts.balance) return [];
  const books = await tx.execute<{ currency: string; amount: string }>(sql`
    select l.currency, sum(l.amount)::text as amount from journal_lines l
    where l.account_id = ${accounts.balance} group by l.currency`);
  const months = (await noonMonths(tx, today)).filter((m) => m.state !== "before");
  const payouts = (await noonPayouts(tx)).filter((p) => !p.before);
  const currencies = new Set([
    ...months.map((m) => m.currency),
    ...books.rows.map((b) => b.currency),
  ]);
  return [...currencies].sort().map((currency) => {
    const inBooks = parseDecimal(books.rows.find((b) => b.currency === currency)?.amount ?? "0");
    const mine = months.filter((m) => m.currency === currency);
    const noon = mine.reduce((t, m) => t + parseDecimal(m.earned) - parseDecimal(m.paidOut), 0n);
    const open = mine.filter((m) => m.state !== "posted" && m.state !== "empty");
    const notPosted = open.reduce(
      (t, m) => t + parseDecimal(m.earned) - parseDecimal(m.posted?.earned ?? "0"),
      0n,
    );
    const unmatched = payouts.filter((p) => p.currency === currency && !p.matched);
    const notMatched = unmatched.reduce((t, p) => t + parseDecimal(p.amount), 0n);
    // Books + not posted − payouts not taken out yet = Noon's rows.
    const unexplained = noon - (inBooks + notPosted - notMatched);
    return {
      currency,
      books: formatDecimal(inBooks),
      noon: formatDecimal(noon),
      notPosted: formatDecimal(notPosted),
      monthsNotPosted: open.length,
      notMatched: formatDecimal(notMatched),
      payoutsNotMatched: unmatched.length,
      unexplained: formatDecimal(unexplained),
    };
  });
}

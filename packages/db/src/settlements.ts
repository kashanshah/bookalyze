import {
  buildSettlementEntry,
  convertSettlementEntry,
  type DepositFit,
  depositFit,
  depositMatchLines,
  formatDecimal,
  type LedgerAccount,
  MONEY_ACCOUNT_SUBTYPES,
  type PreparedEntry,
  parseDecimal,
  prepareJournalEntry,
  SETTLEMENT_ACCOUNT_KEYS,
  type Settlement,
  type SettlementAccountKey,
  type SettlementAccounts,
  settlementDepositWindow,
} from "@bookalyze/core";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { fxRateOn } from "./fx";
import { formatEntryNumber, LedgerError, postJournalEntry, reverseJournalEntry } from "./ledger";
import { accounts, journalEntries, journalLines } from "./schema/accounting";
import { connections } from "./schema/banking";
import {
  salesChannels,
  settlementAccounts,
  settlementDepositDismissals,
  settlementLines,
  settlementSettings,
  settlements,
} from "./schema/commerce";
import { replaceJournalEntry } from "./transactions";

/**
 * Amazon settlements as Amazon reports them (one row per settlement, its amounts summed by
 * kind). Brought in from the Reports API or uploaded as the flat file; nothing posts yet.
 */

/** Amazon connections settlements are brought in for (credentials kept, not disconnected). */
export async function settlementConnections(tx: Transaction) {
  return tx
    .select({
      id: connections.id,
      name: connections.name,
      settings: connections.settings,
      secret: connections.secret,
      settlementsSyncedAt: connections.settlementsSyncedAt,
    })
    .from(connections)
    .where(
      and(
        eq(connections.provider, "amazon_sp"),
        isNotNull(connections.secret),
        ne(connections.status, "disconnected"),
      ),
    )
    .orderBy(asc(connections.createdAt));
}

/** Report IDs already in, so they aren't downloaded again. */
export async function knownSettlementReports(tx: Transaction): Promise<Set<string>> {
  const rows = await tx
    .select({ reportId: settlements.reportId })
    .from(settlements)
    .where(isNotNull(settlements.reportId));
  return new Set(rows.map((r) => r.reportId ?? ""));
}

export async function markSettlementsSynced(tx: Transaction, connectionId: string, at: Date) {
  await tx
    .update(connections)
    .set({ settlementsSyncedAt: at })
    .where(eq(connections.id, connectionId));
}

/**
 * The company's channel a settlement is for: the one named like its marketplace (e.g.
 * "Amazon.ca"), else the only channel in its currency (of the connection, when known).
 */
export async function settlementChannel(
  tx: Transaction,
  input: { connectionId: string | null; marketplace: string | null; currency: string },
): Promise<string | null> {
  // Amazon's settlements only: a Noon UAE channel mustn't make Amazon.ae's AED ambiguous.
  const channels = await tx.select().from(salesChannels).where(eq(salesChannels.kind, "amazon"));
  const scoped = input.connectionId
    ? channels.filter((c) => c.connectionId === input.connectionId)
    : channels;
  const named = input.marketplace?.toLowerCase();
  const byName = scoped.find((c) => c.name.toLowerCase() === named);
  if (byName) return byName.id;
  const byCurrency = scoped.filter((c) => c.currency === input.currency);
  return byCurrency.length === 1 ? (byCurrency[0]?.id ?? null) : null;
}

/**
 * Saves a settlement (a new one, or the same settlement again: its amounts are replaced).
 * Returns its ID and whether it was new.
 */
export async function saveSettlement(
  tx: Transaction,
  input: {
    orgId: string;
    connectionId: string | null;
    channelId: string | null;
    reportId: string | null;
    source: "amazon" | "upload";
    settlement: Settlement;
  },
): Promise<{ id: string; created: boolean }> {
  const s = input.settlement;
  const values = {
    connectionId: input.connectionId,
    channelId: input.channelId,
    reportId: input.reportId,
    source: input.source,
    startAt: new Date(s.startAt),
    endAt: new Date(s.endAt),
    depositDate: s.depositDate,
    total: s.total,
    currency: s.currency,
    marketplace: s.marketplace,
    orderCount: s.orderCount,
    balanced: s.balanced,
  };
  const [row] = await tx
    .insert(settlements)
    .values({ organizationId: input.orgId, externalId: s.settlementId, ...values })
    .onConflictDoUpdate({
      target: [settlements.organizationId, settlements.externalId],
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: settlements.id, created: sql<boolean>`(xmax = 0)` });
  if (!row) throw new Error("The settlement couldn't be saved.");
  await tx.delete(settlementLines).where(eq(settlementLines.settlementId, row.id));
  if (s.lines.length) {
    await tx.insert(settlementLines).values(
      s.lines.map((l) => ({
        organizationId: input.orgId,
        settlementId: row.id,
        transactionType: l.transactionType.slice(0, 200),
        amountType: l.amountType.slice(0, 200),
        amountDescription: l.amountDescription.slice(0, 200),
        amount: l.amount,
        count: l.count,
      })),
    );
  }
  return { id: row.id, created: Boolean(row.created) };
}

/** The settlement's entry, while it's in the books (posted and not reversed). */
const postedEntry = and(
  eq(journalEntries.id, settlements.journalEntryId),
  isNull(journalEntries.reversedByEntryId),
);

/** The settlement's bank deposit, while it's matched (that entry not changed since). */
const depositMatched = sql<boolean>`exists (select 1 from journal_entries d
  where d.id = ${settlements.depositEntryId} and d.reversed_by_entry_id is null)`;

/**
 * Settlements to show: of marketplaces still connected and switched on (a disconnected
 * account's, or a switched-off marketplace's, are hidden like its orders), and every one already
 * in the books, so the books never hold an entry the list doesn't show.
 */
const shown = sql`(
  exists (select 1 from journal_entries p
    where p.id = ${settlements.journalEntryId} and p.reversed_by_entry_id is null)
  or (
    (${settlements.connectionId} is null or exists (select 1 from connections c
      where c.id = ${settlements.connectionId} and c.status <> 'disconnected'))
    and (${settlements.channelId} is null or exists (select 1 from sales_channels ch
      where ch.id = ${settlements.channelId} and ch.is_active))
  )
)`;

/** Settlements, newest first, with their marketplace. */
export async function listSettlements(
  tx: Transaction,
  input: { channelId?: string | null; limit: number; offset: number },
) {
  const where = and(
    shown,
    input.channelId ? eq(settlements.channelId, input.channelId) : undefined,
  );
  const rows = await tx
    .select({
      id: settlements.id,
      externalId: settlements.externalId,
      startAt: settlements.startAt,
      endAt: settlements.endAt,
      depositDate: settlements.depositDate,
      total: settlements.total,
      currency: settlements.currency,
      marketplace: settlements.marketplace,
      channelName: salesChannels.name,
      orderCount: settlements.orderCount,
      balanced: settlements.balanced,
      source: settlements.source,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      depositMatched,
    })
    .from(settlements)
    .leftJoin(salesChannels, eq(salesChannels.id, settlements.channelId))
    .leftJoin(journalEntries, postedEntry)
    .where(where)
    .orderBy(desc(settlements.endAt), desc(settlements.externalId))
    .limit(input.limit)
    .offset(input.offset);
  const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(settlements).where(where);
  const [hidden] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(settlements)
    .where(sql`not ${shown}`);
  return {
    rows: rows.map((r) => ({ ...r, total: String(r.total) })),
    count: count?.n ?? 0,
    /** Of disconnected accounts or switched-off marketplaces (and not in the books). */
    hidden: hidden?.n ?? 0,
  };
}

/** One settlement with its amounts, largest first. */
export async function getSettlement(tx: Transaction, id: string) {
  const [row] = await tx
    .select({
      settlement: settlements,
      channelName: salesChannels.name,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      depositMatched,
    })
    .from(settlements)
    .leftJoin(salesChannels, eq(salesChannels.id, settlements.channelId))
    .leftJoin(journalEntries, postedEntry)
    .where(eq(settlements.id, id));
  if (!row) return null;
  const lines = await tx
    .select()
    .from(settlementLines)
    .where(eq(settlementLines.settlementId, id))
    .orderBy(sql`abs(${settlementLines.amount}) desc`, asc(settlementLines.amountDescription));
  return {
    ...row.settlement,
    total: String(row.settlement.total),
    channelName: row.channelName,
    entryId: row.entryId,
    entryNumber: row.entryNumber,
    deposit: row.depositMatched ? await depositOf(tx, row.settlement.depositEntryId ?? "") : null,
    lines: lines.map((l) => ({ ...l, amount: String(l.amount) })),
  };
}

// --- Posting ------------------------------------------------------------------------------

/** The account chosen for each kind of settlement line. */
export async function getSettlementAccounts(tx: Transaction): Promise<SettlementAccounts> {
  const rows = await tx.select().from(settlementAccounts);
  return Object.fromEntries(
    rows
      .filter((r) => (SETTLEMENT_ACCOUNT_KEYS as string[]).includes(r.key))
      .map((r) => [r.key, r.accountId]),
  ) as SettlementAccounts;
}

export async function getSettlementSettings(tx: Transaction) {
  const [row] = await tx.select().from(settlementSettings).limit(1);
  return { postFrom: row?.postFrom ?? null, autoPost: row?.autoPost ?? false };
}

/** Saves the accounts (all of them: kinds left out are cleared) and the date posting starts. */
export async function saveSettlementSetup(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    accounts: SettlementAccounts;
    postFrom: string;
    autoPost?: boolean;
  },
) {
  await tx.delete(settlementAccounts);
  const rows = Object.entries(input.accounts).filter(
    (e): e is [SettlementAccountKey, string] => typeof e[1] === "string" && e[1] !== "",
  );
  if (rows.length) {
    await tx
      .insert(settlementAccounts)
      .values(rows.map(([key, accountId]) => ({ organizationId: input.orgId, key, accountId })));
  }
  const values = {
    postFrom: input.postFrom,
    autoPost: input.autoPost ?? false,
    updatedBy: input.userId,
    updatedAt: new Date(),
  };
  await tx
    .insert(settlementSettings)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: settlementSettings.organizationId, set: values });
}

/**
 * Posts a settlement as one journal entry (core `buildSettlementEntry`), dated `date` (the
 * period's last day), and links them. A settlement in another currency posts in it, each line
 * valued in the main currency at that day's rate (core `convertSettlementEntry`). Fails, in
 * plain words, when it's already in the books, the accounts aren't chosen, or there's no rate.
 */
export async function postSettlement(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    settlementId: string;
    baseCurrency: string;
    date: string;
    /** e.g. "Amazon.ca settlement 123 · Jun 5 – Jul 17, 2026". */
    memo: string;
  },
) {
  const [s] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, input.settlementId))
    .for("update");
  if (!s) throw new LedgerError("This settlement no longer exists.");
  if (s.journalEntryId) {
    const [entry] = await tx
      .select({ reversed: journalEntries.reversedByEntryId })
      .from(journalEntries)
      .where(eq(journalEntries.id, s.journalEntryId));
    if (entry && !entry.reversed) throw new LedgerError("This settlement is in the books already.");
  }
  const lines = await tx
    .select()
    .from(settlementLines)
    .where(eq(settlementLines.settlementId, s.id));
  const built = buildSettlementEntry({
    total: String(s.total),
    lines: lines.map((l) => ({ ...l, amount: String(l.amount) })),
    accounts: await getSettlementAccounts(tx),
  });
  if (!built.ok) throw new LedgerError(built.error);
  const all = await tx.select().from(accounts);
  const record = async (entry: { id: string; entryNumber: number }, rate: string, base: string) => {
    await tx
      .update(settlements)
      .set({ journalEntryId: entry.id, postedFxRate: rate, payoutBaseAmount: base })
      .where(eq(settlements.id, s.id));
    return { ...entry, label: formatEntryNumber(entry.entryNumber) };
  };
  const post = (prepared: PreparedEntry) =>
    postJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      date: input.date,
      reference: s.externalId,
      memo: input.memo,
      source: "settlement",
      sourceId: s.id,
      entry: prepared,
    });
  if (s.currency !== input.baseCurrency) {
    const quote = await fxRateOn(tx, {
      base: input.baseCurrency,
      quote: s.currency,
      date: input.date,
    });
    if (!quote) {
      throw new LedgerError(
        `There's no ${s.currency} to ${input.baseCurrency} exchange rate for ${input.date} yet. Rates come in every weekday evening: try again tomorrow.`,
      );
    }
    const byId = new Map(all.map((a) => [a.id, a]));
    if (built.lines.some((l) => byId.get(l.accountId)?.isArchived)) {
      throw new LedgerError("One of the chosen accounts is archived. Choose another.");
    }
    const clearingId = (await getSettlementAccounts(tx)).clearing ?? "";
    const converted = convertSettlementEntry({
      lines: built.lines,
      total: String(s.total),
      clearingAccountId: clearingId,
      clearingCurrency: byId.get(clearingId)?.currency ?? null,
      currency: s.currency,
      baseCurrency: input.baseCurrency,
      rate: quote.rate,
    });
    if (!converted.ok) throw new LedgerError(converted.error);
    const entry = await post({
      currency: s.currency,
      fxRate: quote.rate,
      total: formatDecimal(
        built.lines.map((l) => parseDecimal(l.amount)).reduce((t, a) => (a > 0n ? t + a : t), 0n),
      ),
      lines: converted.lines.map((l, index) => ({ index, ...l, taxRateId: null })),
    });
    return record(entry, quote.rate, converted.payoutBase);
  }
  const ledger = new Map<string, LedgerAccount>(
    all.map((a) => [
      a.id,
      { id: a.id, name: a.name, currency: a.currency, isArchived: a.isArchived },
    ]),
  );
  const prepared = prepareJournalEntry(
    {
      currency: s.currency,
      baseCurrency: input.baseCurrency,
      lines: built.lines.map((l) =>
        l.amount.startsWith("-")
          ? { accountId: l.accountId, description: l.description, credit: l.amount.slice(1) }
          : { accountId: l.accountId, description: l.description, debit: l.amount },
      ),
    },
    ledger,
  );
  if (!prepared.ok) {
    const first =
      prepared.errors.form ??
      Object.values(prepared.errors.lines ?? {})[0] ??
      "It doesn't balance.";
    throw new LedgerError(`The settlement couldn't be posted: ${first}`);
  }
  return record(await post(prepared.entry), "1", String(s.total));
}

/** Takes a settlement out of the books: its entry is reversed (on the same day). */
export async function unpostSettlement(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string },
) {
  const [s] = await tx
    .select({ entryId: settlements.journalEntryId })
    .from(settlements)
    .where(eq(settlements.id, input.settlementId))
    .for("update");
  if (!s?.entryId) throw new LedgerError("This settlement isn't in the books.");
  if (await isDepositMatched(tx, input.settlementId)) {
    throw new LedgerError("Unmatch its bank deposit first, then take it out of the books.");
  }
  const [entry] = await tx
    .select({ date: journalEntries.date, reversed: journalEntries.reversedByEntryId })
    .from(journalEntries)
    .where(eq(journalEntries.id, s.entryId));
  if (entry && !entry.reversed) {
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: s.entryId,
      date: entry.date,
    });
  }
  await tx
    .update(settlements)
    .set({ journalEntryId: null })
    .where(eq(settlements.id, input.settlementId));
}

/** Settlements not in the books whose period ends on or after `from`, oldest first. */
export async function settlementsToPost(tx: Transaction, input: { from: string; limit: number }) {
  return tx
    .select({ id: settlements.id })
    .from(settlements)
    .leftJoin(journalEntries, postedEntry)
    .where(
      and(
        isNull(journalEntries.id),
        eq(settlements.balanced, true),
        shown,
        sql`${settlements.endAt} >= ${input.from}::date`,
      ),
    )
    .orderBy(asc(settlements.endAt))
    .limit(input.limit);
}

// --- Matching the payout to its bank deposit -----------------------------------------------

const moneyList = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((t) => `'${t}'`).join(", "));

async function isDepositMatched(tx: Transaction, settlementId: string) {
  const [row] = await tx
    .select({ matched: depositMatched })
    .from(settlements)
    .where(eq(settlements.id, settlementId));
  return Boolean(row?.matched);
}

/** The matched deposit as it shows on the settlement: date, bank account, entry number. */
async function depositOf(tx: Transaction, entryId: string) {
  const rows = await tx.execute<{
    id: string;
    entry_number: number;
    date: string;
    account_name: string;
  }>(sql`
    select e.id, e.entry_number, e.date::text as date, a.name as account_name
    from journal_entries e
    join journal_lines l on l.journal_entry_id = e.id and l.amount > 0
    join accounts a on a.id = l.account_id and a.subtype in (${moneyList})
    where e.id = ${entryId}
    order by l.line_no
    limit 1`);
  const r = rows.rows[0];
  return r
    ? { entryId: r.id, entryNumber: r.entry_number, date: r.date, accountName: r.account_name }
    : null;
}

export type DepositCandidate = {
  entryId: string;
  entryNumber: number;
  date: string;
  /** The bank (or card, cash) account it was paid into. */
  accountName: string;
  description: string | null;
  /** The deposit's amount and currency (the payout's, or another when the bank converted it). */
  amount: string;
  currency: string;
  /** Its value in the main currency, as recorded. */
  baseAmount: string;
  /** Same amount and currency (`exact`), or converted by the bank (check the rate first). */
  fit: DepositFit;
  /** Where it's categorized now (e.g. "Amazon Sales", "Uncategorized income"). */
  categories: string[];
  categoryAccountIds: string[];
  /** Still uncategorized: matching it changes nothing anyone chose. */
  uncategorized: boolean;
};

/**
 * Bank deposits that could be a settlement's payout: money into one bank, card or cash account
 * (not the clearing account), within `settlementDepositWindow`, not already moved to the
 * clearing account and not turned down for this settlement, that fit the payout (core
 * `depositFit`): exactly its amount in its currency, or, paid in another currency, close to it
 * at that day's rate. Exact ones first, then by date (closest to Amazon's deposit date).
 */
export async function settlementDepositCandidates(
  tx: Transaction,
  settlementId: string,
  onlyEntryId?: string,
): Promise<DepositCandidate[]> {
  const [s] = await tx.select().from(settlements).where(eq(settlements.id, settlementId));
  if (!s || parseDecimal(String(s.total)) <= 0n) return [];
  const clearing = (await getSettlementAccounts(tx)).clearing ?? null;
  const endDate = s.endAt.toISOString().slice(0, 10);
  const { from, to } = settlementDepositWindow({ depositDate: s.depositDate, endDate });
  const anchor = s.depositDate ?? endDate;
  const rows = await tx.execute<{
    entry_id: string;
    entry_number: number;
    date: string;
    account_name: string;
    description: string | null;
    amount: string;
    currency: string;
    base_amount: string;
    categories: string[] | null;
    category_ids: string[] | null;
    uncategorized: boolean;
  }>(sql`
    select e.id as entry_id, e.entry_number, e.date::text as date, ma.name as account_name,
      coalesce(nullif(e.memo, ''), nullif(m.description, ''), e.reference) as description,
      m.amount::text as amount, m.currency, m.base_amount::text as base_amount,
      (select array_agg(distinct a.name order by a.name) from journal_lines l
        join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id and a.subtype not in (${moneyList})) as categories,
      (select array_agg(distinct l.account_id) from journal_lines l
        join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id and a.subtype not in (${moneyList})) as category_ids,
      not exists (select 1 from journal_lines l join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id and a.subtype not in (${moneyList})
          and a.subtype not in ('uncategorized_income', 'uncategorized_expense')) as uncategorized
    from journal_entries e
    join journal_lines m on m.journal_entry_id = e.id and m.amount > 0
    join accounts ma on ma.id = m.account_id and ma.subtype in (${moneyList})
    where e.reversed_by_entry_id is null and e.reverses_entry_id is null
      and e.source not in ('settlement', 'reversal')
      and e.date between ${from}::date and ${to}::date
      and (select count(*) from journal_lines l join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id and a.subtype in (${moneyList})) = 1
      ${
        clearing
          ? sql`and m.account_id <> ${clearing}
        and not exists (select 1 from journal_lines l
          where l.journal_entry_id = e.id and l.account_id = ${clearing})`
          : sql``
      }
      and not exists (select 1 from settlement_deposit_dismissals x
        where x.settlement_id = ${s.id} and x.journal_entry_id = e.id)
      ${onlyEntryId ? sql`and e.id = ${onlyEntryId}` : sql``}
    order by abs(e.date - ${anchor}::date), e.date, e.entry_number
    limit 300`);
  // The market rate (deposit units per payout unit) on Amazon's deposit date, per currency.
  const rates = new Map<string, string | null>();
  const rateFor = async (currency: string) => {
    if (!rates.has(currency)) {
      const quote = await fxRateOn(tx, { base: currency, quote: s.currency, date: anchor });
      rates.set(currency, quote?.rate ?? null);
    }
    return rates.get(currency) ?? null;
  };
  const found: DepositCandidate[] = [];
  for (const r of rows.rows) {
    const fit = depositFit({
      total: String(s.total),
      currency: s.currency,
      depositAmount: r.amount,
      depositCurrency: r.currency,
      rate: r.currency === s.currency ? null : await rateFor(r.currency),
    });
    if (!fit) continue;
    found.push({
      entryId: r.entry_id,
      entryNumber: r.entry_number,
      date: r.date,
      accountName: r.account_name,
      description: r.description,
      amount: r.amount,
      currency: r.currency,
      baseAmount: r.base_amount,
      fit,
      categories: r.categories ?? [],
      categoryAccountIds: r.category_ids ?? [],
      uncategorized: r.uncategorized,
    });
  }
  const closeness = (c: DepositCandidate) =>
    c.fit.kind === "exact" ? 0 : 1 + Math.abs(c.fit.differenceBp) / 10_000;
  return found
    .map((c, order) => ({ c, order }))
    .sort((a, b) => closeness(a.c) - closeness(b.c) || a.order - b.order)
    .map((x) => x.c)
    .slice(0, 10);
}

/**
 * Matches a posted settlement's payout to its bank deposit: the deposit is replaced (reversed
 * on its own date, posted again) with its money line kept and everything else moved to the
 * clearing account, so the payout is counted once (as the settlement) and clearing returns to
 * zero. Bank links, receipts and the reviewed tick follow (`replaceJournalEntry`).
 */
export async function matchSettlementDeposit(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    settlementId: string;
    entryId: string;
    baseCurrency: string;
  },
) {
  const [s] = await tx
    .select({
      id: settlements.id,
      externalId: settlements.externalId,
      total: settlements.total,
      currency: settlements.currency,
      payoutBase: settlements.payoutBaseAmount,
      posted: journalEntries.id,
    })
    .from(settlements)
    .leftJoin(journalEntries, postedEntry)
    .where(eq(settlements.id, input.settlementId))
    .for("update", { of: settlements });
  if (!s) throw new LedgerError("This settlement no longer exists.");
  if (!s.posted) throw new LedgerError("Post the settlement to the books first.");
  if (await isDepositMatched(tx, s.id)) {
    throw new LedgerError("This settlement's deposit is matched already.");
  }
  const clearing = (await getSettlementAccounts(tx)).clearing;
  if (!clearing) throw new LedgerError("Choose the clearing account first.");
  const [candidate] = await settlementDepositCandidates(tx, s.id, input.entryId);
  if (!candidate) {
    throw new LedgerError(
      "This deposit can't be matched to the settlement (it changed, or doesn't fit). Refresh to see the latest.",
    );
  }
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, input.entryId));
  if (!entry) throw new LedgerError("This deposit no longer exists.");
  const lines = await tx
    .select({
      accountId: journalLines.accountId,
      description: journalLines.description,
      currency: journalLines.currency,
      amount: journalLines.amount,
      baseAmount: journalLines.baseAmount,
      subtype: accounts.subtype,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.journalEntryId, entry.id))
    .orderBy(asc(journalLines.lineNo));
  const money = lines.find((l) =>
    (MONEY_ACCOUNT_SUBTYPES as readonly string[]).includes(l.subtype),
  );
  if (!money) throw new LedgerError("This deposit isn't on a bank account.");
  // Settlements posted before their main-currency value was kept were in the main currency.
  const payoutBase =
    s.payoutBase !== null
      ? String(s.payoutBase)
      : s.currency === input.baseCurrency
        ? String(s.total)
        : null;
  if (!payoutBase) {
    throw new LedgerError("Take this settlement out of the books and post it again, then match.");
  }
  const system = await tx
    .select({ id: accounts.id, key: accounts.systemKey, currency: accounts.currency })
    .from(accounts)
    .where(sql`${accounts.systemKey} in ('fx_gain', 'fx_loss') or ${accounts.id} = ${clearing}`);
  const built = depositMatchLines({
    money: {
      accountId: money.accountId,
      description: money.description,
      currency: money.currency,
      amount: String(money.amount),
      baseAmount: String(money.baseAmount),
    },
    clearingAccountId: clearing,
    clearingCurrency: system.find((a) => a.id === clearing)?.currency ?? null,
    currency: s.currency,
    baseCurrency: input.baseCurrency,
    total: String(s.total),
    payoutBase,
    fxGainAccountId: system.find((a) => a.key === "fx_gain")?.id ?? null,
    fxLossAccountId: system.find((a) => a.key === "fx_loss")?.id ?? null,
    description: `Amazon settlement ${s.externalId}`,
  });
  if (!built.ok) throw new LedgerError(built.error);
  const prepared: PreparedEntry = {
    currency: entry.currency,
    fxRate: entry.fxRate,
    total: String(money.amount),
    lines: built.lines.map((l, index) => ({ index, ...l, taxRateId: null })),
  };
  const posted = await replaceJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: entry.id,
    date: entry.date,
    reference: entry.reference,
    memo: entry.memo,
    contactId: entry.contactId,
    entry: prepared,
  });
  await tx
    .update(settlements)
    .set({ depositEntryId: posted.id, depositOriginalEntryId: entry.id })
    .where(eq(settlements.id, s.id));
  return { ...posted, label: formatEntryNumber(posted.entryNumber), was: candidate };
}

/**
 * Undoes a match: the deposit goes back to how it was before (its categories), and isn't
 * suggested for this settlement again.
 */
export async function unmatchSettlementDeposit(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string },
) {
  const [s] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, input.settlementId))
    .for("update");
  if (!s) throw new LedgerError("This settlement no longer exists.");
  if (!s.depositEntryId || !s.depositOriginalEntryId || !(await isDepositMatched(tx, s.id))) {
    throw new LedgerError("This settlement's deposit isn't matched.");
  }
  const [current] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, s.depositEntryId));
  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, s.depositOriginalEntryId));
  if (!current || !original) throw new LedgerError("This deposit no longer exists.");
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.journalEntryId, original.id))
    .orderBy(asc(journalLines.lineNo));
  const prepared: PreparedEntry = {
    currency: original.currency,
    fxRate: original.fxRate,
    total: formatDecimal(
      lines.map((l) => parseDecimal(String(l.amount))).reduce((t, a) => (a > 0n ? t + a : t), 0n),
    ),
    lines: lines.map((l, index) => ({
      index,
      accountId: l.accountId,
      description: l.description,
      currency: l.currency,
      amount: String(l.amount),
      baseAmount: String(l.baseAmount),
      taxRateId: l.taxRateId,
    })),
  };
  const posted = await replaceJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: current.id,
    date: current.date,
    reference: current.reference,
    memo: current.memo,
    contactId: current.contactId,
    entry: prepared,
  });
  await tx
    .update(settlements)
    .set({ depositEntryId: null, depositOriginalEntryId: null })
    .where(eq(settlements.id, s.id));
  await dismissSettlementDeposit(tx, { ...input, entryId: posted.id });
  return posted;
}

/** "Not this one": the deposit isn't suggested for this settlement again. */
export async function dismissSettlementDeposit(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string; entryId: string },
) {
  await tx
    .insert(settlementDepositDismissals)
    .values({
      organizationId: input.orgId,
      settlementId: input.settlementId,
      journalEntryId: input.entryId,
      createdBy: input.userId,
    })
    .onConflictDoNothing();
}

/**
 * Posted settlements whose deposit isn't matched yet and that have exactly one deposit of the
 * same amount in the same currency: the ones "Match N deposits" (and the daily job) can do
 * without a look at a rate. Oldest first.
 */
export async function settlementsWithOneDeposit(tx: Transaction, limit = 50) {
  const rows = await tx
    .select({ id: settlements.id })
    .from(settlements)
    .innerJoin(journalEntries, postedEntry)
    .where(sql`not ${depositMatched} and ${settlements.total} > 0`)
    .orderBy(asc(settlements.endAt))
    .limit(200);
  const found: { settlementId: string; deposit: DepositCandidate }[] = [];
  for (const r of rows) {
    const exact = (await settlementDepositCandidates(tx, r.id)).filter(
      (c) => c.fit.kind === "exact",
    );
    if (exact.length === 1 && exact[0]) {
      found.push({ settlementId: r.id, deposit: exact[0] });
      if (found.length >= limit) break;
    }
  }
  return found;
}

// --- Profit by channel --------------------------------------------------------------------

/**
 * The settlements (shown ones: see `shown`) whose period ends between `from` and `to` in the
 * company's time zone, with their marketplace, the rate they posted at (if posted), and their
 * lines: what the channel profit report adds up.
 */
export async function settlementsForProfit(
  tx: Transaction,
  input: { from: string; to: string; timezone: string },
) {
  const rows = await tx
    .select({
      id: settlements.id,
      externalId: settlements.externalId,
      channelId: settlements.channelId,
      channelName: salesChannels.name,
      marketplace: settlements.marketplace,
      currency: settlements.currency,
      endAt: settlements.endAt,
      balanced: settlements.balanced,
      postedFxRate: settlements.postedFxRate,
      posted: journalEntries.id,
    })
    .from(settlements)
    .leftJoin(salesChannels, eq(salesChannels.id, settlements.channelId))
    .leftJoin(journalEntries, postedEntry)
    .where(
      and(
        shown,
        sql`(${settlements.endAt} at time zone ${input.timezone})::date between ${input.from}::date and ${input.to}::date`,
      ),
    )
    .orderBy(asc(settlements.endAt));
  if (!rows.length) return [];
  const lines = await tx
    .select({
      settlementId: settlementLines.settlementId,
      transactionType: settlementLines.transactionType,
      amountType: settlementLines.amountType,
      amountDescription: settlementLines.amountDescription,
      amount: settlementLines.amount,
    })
    .from(settlementLines)
    .where(
      sql`${settlementLines.settlementId} in (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`, `,
      )})`,
    );
  const bySettlement = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = bySettlement.get(l.settlementId) ?? [];
    list.push(l);
    bySettlement.set(l.settlementId, list);
  }
  return rows.map((r) => ({
    ...r,
    postedFxRate: r.posted && r.postedFxRate !== null ? String(r.postedFxRate) : null,
    lines: (bySettlement.get(r.id) ?? []).map((l) => ({ ...l, amount: String(l.amount) })),
  }));
}

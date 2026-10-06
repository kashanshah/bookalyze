import {
  buildSettlementEntry,
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
  const channels = await tx.select().from(salesChannels);
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

/** Settlements, newest first, with their marketplace. */
export async function listSettlements(
  tx: Transaction,
  input: { channelId?: string | null; limit: number; offset: number },
) {
  const where = input.channelId ? eq(settlements.channelId, input.channelId) : undefined;
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
  return {
    rows: rows.map((r) => ({ ...r, total: String(r.total) })),
    count: count?.n ?? 0,
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
  return { postFrom: row?.postFrom ?? null };
}

/** Saves the accounts (all of them: kinds left out are cleared) and the date posting starts. */
export async function saveSettlementSetup(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    accounts: SettlementAccounts;
    postFrom: string;
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
  const values = { postFrom: input.postFrom, updatedBy: input.userId, updatedAt: new Date() };
  await tx
    .insert(settlementSettings)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: settlementSettings.organizationId, set: values });
}

/**
 * Posts a settlement as one journal entry (core `buildSettlementEntry`), dated `date` (the
 * period's last day), and links them. Fails, in plain words, when it's already in the books,
 * isn't in the main currency, or the accounts aren't chosen.
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
  if (s.currency !== input.baseCurrency) {
    throw new LedgerError(
      `This settlement is in ${s.currency}. Posting settlements in another currency than ${input.baseCurrency} comes later.`,
    );
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
  const entry = await postJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: input.date,
    reference: s.externalId,
    memo: input.memo,
    source: "settlement",
    sourceId: s.id,
    entry: prepared.entry,
  });
  await tx.update(settlements).set({ journalEntryId: entry.id }).where(eq(settlements.id, s.id));
  return { ...entry, label: formatEntryNumber(entry.entryNumber) };
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
        sql`${settlements.endAt} >= ${input.from}::date`,
      ),
    )
    .orderBy(asc(settlements.endAt))
    .limit(input.limit);
}

// --- Matching the payout to its bank deposit -----------------------------------------------

const moneyList = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((t) => `'${t}'`).join(", "));
const neg = (amount: string) => formatDecimal(-parseDecimal(amount));

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
  /** Where it's categorized now (e.g. "Amazon Sales", "Uncategorized income"). */
  categories: string[];
  /** Still uncategorized: matching it changes nothing anyone chose. */
  uncategorized: boolean;
};

/**
 * Bank deposits that could be a settlement's payout: money into one bank, card or cash account
 * (not the clearing account), in the settlement's currency, of exactly its total, within
 * `settlementDepositWindow`, not already moved to the clearing account and not turned down for
 * this settlement. Closest to Amazon's deposit date first.
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
    categories: string[] | null;
    uncategorized: boolean;
  }>(sql`
    select e.id as entry_id, e.entry_number, e.date::text as date, ma.name as account_name,
      coalesce(nullif(e.memo, ''), nullif(m.description, ''), e.reference) as description,
      (select array_agg(distinct a.name order by a.name) from journal_lines l
        join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id and a.subtype not in (${moneyList})) as categories,
      not exists (select 1 from journal_lines l join accounts a on a.id = l.account_id
        where l.journal_entry_id = e.id and a.subtype not in (${moneyList})
          and a.subtype not in ('uncategorized_income', 'uncategorized_expense')) as uncategorized
    from journal_entries e
    join journal_lines m on m.journal_entry_id = e.id
    join accounts ma on ma.id = m.account_id and ma.subtype in (${moneyList})
    where e.reversed_by_entry_id is null and e.reverses_entry_id is null
      and e.source not in ('settlement', 'reversal')
      and e.date between ${from}::date and ${to}::date
      and m.currency = ${s.currency} and m.amount = ${String(s.total)}::numeric
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
    limit 10`);
  return rows.rows.map((r) => ({
    entryId: r.entry_id,
    entryNumber: r.entry_number,
    date: r.date,
    accountName: r.account_name,
    description: r.description,
    categories: r.categories ?? [],
    uncategorized: r.uncategorized,
  }));
}

/**
 * Matches a posted settlement's payout to its bank deposit: the deposit is replaced (reversed
 * on its own date, posted again) with its money line kept and everything else moved to the
 * clearing account, so the payout is counted once (as the settlement) and clearing returns to
 * zero. Bank links, receipts and the reviewed tick follow (`replaceJournalEntry`).
 */
export async function matchSettlementDeposit(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settlementId: string; entryId: string },
) {
  const [s] = await tx
    .select({ id: settlements.id, externalId: settlements.externalId, posted: journalEntries.id })
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
  const amount = String(money.amount);
  const baseAmount = String(money.baseAmount);
  const prepared: PreparedEntry = {
    currency: entry.currency,
    fxRate: entry.fxRate,
    total: amount,
    lines: [
      {
        index: 0,
        accountId: money.accountId,
        description: money.description,
        currency: money.currency,
        amount,
        baseAmount,
        taxRateId: null,
      },
      {
        index: 1,
        accountId: clearing,
        description: `Amazon settlement ${s.externalId}`,
        currency: money.currency,
        amount: neg(amount),
        baseAmount: neg(baseAmount),
        taxRateId: null,
      },
    ],
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
 * Posted settlements whose deposit isn't matched yet and that have exactly one candidate: the
 * ones "Match found deposits" can do in one go. Oldest first.
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
    const candidates = await settlementDepositCandidates(tx, r.id);
    if (candidates.length === 1 && candidates[0]) {
      found.push({ settlementId: r.id, deposit: candidates[0] });
      if (found.length >= limit) break;
    }
  }
  return found;
}

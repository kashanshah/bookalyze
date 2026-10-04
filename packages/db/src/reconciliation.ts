import {
  type AccountType,
  isMoneyAccountSubtype,
  type ReconciliationTotals,
  reconciliationTotals,
} from "@bookalyze/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { accounts, contacts, journalEntries, journalLines } from "./schema/accounting";
import { reconciliationLines, reconciliations } from "./schema/reconciliation";

/**
 * Reconciling accounts against statements. Run inside `withOrg()`. The database keeps
 * completed reconciliations fixed (see migration 0014): their ticks can't change and their
 * transactions can't be edited or removed until the reconciliation is undone.
 */

export class ReconcileError extends Error {}

/** Lines of current entries only: an edited or removed transaction's lines drop out. */
const currentEntry = sql`${journalEntries.reversedByEntryId} is null and ${journalEntries.reversesEntryId} is null`;

export type ReconcilableAccount = {
  id: string;
  name: string;
  code: string | null;
  type: AccountType;
  subtype: string;
  currency: string | null;
  lastReconciled: { statementDate: string; statementBalance: string } | null;
  inProgressId: string | null;
};

/** Bank, card and cash accounts with where each reconciliation stands. */
export async function listReconcilableAccounts(tx: Transaction): Promise<ReconcilableAccount[]> {
  const all = await tx.select().from(accounts).where(eq(accounts.isArchived, false));
  const money = all.filter((a) => isMoneyAccountSubtype(a.subtype));
  if (!money.length) return [];
  const recs = await tx
    .select()
    .from(reconciliations)
    .where(
      inArray(
        reconciliations.accountId,
        money.map((a) => a.id),
      ),
    )
    .orderBy(desc(reconciliations.statementDate));
  return money
    .map((a) => {
      const last = recs.find((r) => r.accountId === a.id && r.status === "completed");
      const open = recs.find((r) => r.accountId === a.id && r.status === "in_progress");
      return {
        id: a.id,
        name: a.name,
        code: a.code,
        type: a.type,
        subtype: a.subtype,
        currency: a.currency,
        lastReconciled: last
          ? { statementDate: last.statementDate, statementBalance: last.statementBalance }
          : null,
        inProgressId: open?.id ?? null,
      };
    })
    .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name));
}

export async function reconciliationHistory(tx: Transaction, accountId: string) {
  return tx
    .select()
    .from(reconciliations)
    .where(and(eq(reconciliations.accountId, accountId), eq(reconciliations.status, "completed")))
    .orderBy(desc(reconciliations.statementDate));
}

async function lastCompleted(tx: Transaction, accountId: string) {
  const [row] = await tx
    .select()
    .from(reconciliations)
    .where(and(eq(reconciliations.accountId, accountId), eq(reconciliations.status, "completed")))
    .orderBy(desc(reconciliations.statementDate), desc(reconciliations.completedAt))
    .limit(1);
  return row ?? null;
}

/** Starts reconciling an account against a statement. */
export async function startReconciliation(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    accountId: string;
    statementDate: string;
    statementBalance: string;
  },
) {
  const [account] = await tx.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!account || !isMoneyAccountSubtype(account.subtype)) {
    throw new ReconcileError("Choose a bank, card or cash account.");
  }
  const last = await lastCompleted(tx, input.accountId);
  if (last && input.statementDate <= last.statementDate) {
    throw new ReconcileError(
      `This account is reconciled through ${last.statementDate}. Choose a later statement date.`,
    );
  }
  const [row] = await tx
    .insert(reconciliations)
    .values({
      organizationId: input.orgId,
      accountId: input.accountId,
      statementDate: input.statementDate,
      statementBalance: input.statementBalance,
      createdBy: input.userId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new ReconcileError("This account already has a reconciliation in progress.");
  return row;
}

export async function updateReconciliationStatement(
  tx: Transaction,
  input: { id: string; statementDate: string; statementBalance: string },
) {
  const rec = await getReconciliation(tx, input.id);
  if (rec?.status !== "in_progress") throw new ReconcileError("This reconciliation is finished.");
  const last = await lastCompleted(tx, rec.accountId);
  if (last && input.statementDate <= last.statementDate) {
    throw new ReconcileError(
      `This account is reconciled through ${last.statementDate}. Choose a later statement date.`,
    );
  }
  // Ticked lines after the new date no longer belong to this statement.
  await tx.execute(sql`
    delete from ${reconciliationLines} rl
    using ${journalLines} l, ${journalEntries} e
    where rl.reconciliation_id = ${input.id} and l.id = rl.journal_line_id
      and e.id = l.journal_entry_id and e.date > ${input.statementDate}`);
  await tx
    .update(reconciliations)
    .set({ statementDate: input.statementDate, statementBalance: input.statementBalance })
    .where(eq(reconciliations.id, input.id));
}

export async function getReconciliation(tx: Transaction, id: string) {
  const [row] = await tx.select().from(reconciliations).where(eq(reconciliations.id, id));
  return row ?? null;
}

export type ReconcileLine = {
  lineId: string;
  entryId: string;
  entryNumber: number;
  date: string;
  memo: string | null;
  description: string | null;
  contactName: string | null;
  /** Signed ledger amount in the account's currency (debits positive). */
  amount: string;
  cleared: boolean;
};

export type ReconciliationState = {
  reconciliation: typeof reconciliations.$inferSelect;
  account: typeof accounts.$inferSelect;
  lines: ReconcileLine[];
  totals: ReconciliationTotals;
};

/**
 * Everything the reconcile screen needs: the account's lines up to the statement date that no
 * earlier reconciliation cleared (ticked or not), and the running totals.
 */
export async function reconciliationState(
  tx: Transaction,
  id: string,
): Promise<ReconciliationState | null> {
  const reconciliation = await getReconciliation(tx, id);
  if (!reconciliation) return null;
  const [account] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, reconciliation.accountId));
  if (!account) return null;

  const clearedElsewhere = sql`exists (
    select 1 from ${reconciliationLines} rl join ${reconciliations} r on r.id = rl.reconciliation_id
    where rl.journal_line_id = ${journalLines.id} and r.id <> ${id} and r.status = 'completed')`;
  const clearedHere = sql<boolean>`exists (
    select 1 from ${reconciliationLines} rl
    where rl.journal_line_id = ${journalLines.id} and rl.reconciliation_id = ${id})`;
  const rows = await tx
    .select({
      lineId: journalLines.id,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      date: journalEntries.date,
      memo: journalEntries.memo,
      description: journalLines.description,
      contactName: contacts.name,
      amount: journalLines.amount,
      cleared: clearedHere,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .leftJoin(contacts, eq(contacts.id, journalEntries.contactId))
    .where(
      and(
        eq(journalLines.accountId, reconciliation.accountId),
        currentEntry,
        sql`(${journalEntries.date} <= ${reconciliation.statementDate} or ${clearedHere})`,
        sql`not ${clearedElsewhere}`,
      ),
    )
    .orderBy(journalEntries.date, journalEntries.entryNumber);

  const previous = await tx
    .select({ amount: journalLines.amount })
    .from(reconciliationLines)
    .innerJoin(reconciliations, eq(reconciliations.id, reconciliationLines.reconciliationId))
    .innerJoin(journalLines, eq(journalLines.id, reconciliationLines.journalLineId))
    .where(
      and(
        eq(reconciliations.accountId, reconciliation.accountId),
        eq(reconciliations.status, "completed"),
        sql`${reconciliations.id} <> ${id}`,
      ),
    );
  const lines = rows.map((r) => ({ ...r, cleared: Boolean(r.cleared) }));
  const totals = reconciliationTotals({
    type: account.type,
    previouslyCleared: previous.map((p) => p.amount),
    cleared: lines.filter((l) => l.cleared).map((l) => l.amount),
    statementBalance: reconciliation.statementBalance,
  });
  return { reconciliation, account, lines, totals };
}

/** Ticks or unticks lines. Only lines the reconcile screen offers can be ticked. */
export async function setLinesCleared(
  tx: Transaction,
  input: { orgId: string; reconciliationId: string; lineIds: string[]; cleared: boolean },
): Promise<void> {
  if (!input.lineIds.length) return;
  const state = await reconciliationState(tx, input.reconciliationId);
  if (state?.reconciliation.status !== "in_progress") {
    throw new ReconcileError("This reconciliation is finished.");
  }
  const offered = new Set(state.lines.map((l) => l.lineId));
  const ids = input.lineIds.filter((id) => offered.has(id));
  if (!ids.length) return;
  if (input.cleared) {
    await tx
      .insert(reconciliationLines)
      .values(
        ids.map((journalLineId) => ({
          organizationId: input.orgId,
          reconciliationId: input.reconciliationId,
          journalLineId,
        })),
      )
      .onConflictDoNothing();
  } else {
    await tx
      .delete(reconciliationLines)
      .where(
        and(
          eq(reconciliationLines.reconciliationId, input.reconciliationId),
          inArray(reconciliationLines.journalLineId, ids),
        ),
      );
  }
}

/** Finishes a reconciliation. Its cleared balance must equal the statement's. */
export async function completeReconciliation(
  tx: Transaction,
  input: { id: string; userId?: string | null },
) {
  const state = await reconciliationState(tx, input.id);
  if (state?.reconciliation.status !== "in_progress") {
    throw new ReconcileError("This reconciliation is already finished.");
  }
  if (!state.totals.balanced) {
    throw new ReconcileError("The cleared balance doesn't match the statement yet.");
  }
  // Ticked lines dated after the statement (possible if the date moved) don't belong here.
  const late = state.lines.filter((l) => l.cleared && l.date > state.reconciliation.statementDate);
  if (late.length) throw new ReconcileError("Untick transactions dated after the statement.");
  await tx
    .update(reconciliations)
    .set({ status: "completed", completedAt: new Date(), completedBy: input.userId ?? null })
    .where(eq(reconciliations.id, input.id));
  return state.totals;
}

/** Throws away a reconciliation in progress and its ticks. */
export async function cancelReconciliation(tx: Transaction, id: string) {
  const rec = await getReconciliation(tx, id);
  if (rec?.status !== "in_progress") throw new ReconcileError("This reconciliation is finished.");
  await tx.delete(reconciliations).where(eq(reconciliations.id, id));
}

/**
 * Reopens the latest completed reconciliation of an account, so its transactions can change
 * and its ticks be redone. Only the latest: earlier ones are the opening balance of later ones.
 */
export async function undoReconciliation(tx: Transaction, id: string) {
  const rec = await getReconciliation(tx, id);
  if (rec?.status !== "completed") throw new ReconcileError("This reconciliation isn't finished.");
  const last = await lastCompleted(tx, rec.accountId);
  if (last?.id !== rec.id) {
    throw new ReconcileError("Only the latest reconciliation of an account can be undone.");
  }
  const [open] = await tx
    .select({ id: reconciliations.id })
    .from(reconciliations)
    .where(
      and(eq(reconciliations.accountId, rec.accountId), eq(reconciliations.status, "in_progress")),
    );
  if (open) throw new ReconcileError("Finish or cancel the reconciliation in progress first.");
  await tx
    .update(reconciliations)
    .set({ status: "in_progress", completedAt: null, completedBy: null })
    .where(eq(reconciliations.id, id));
}

/** The statement date a transaction was reconciled to, or null if it isn't reconciled. */
export async function entryReconciledThrough(
  tx: Transaction,
  entryId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ date: reconciliations.statementDate })
    .from(journalLines)
    .innerJoin(reconciliationLines, eq(reconciliationLines.journalLineId, journalLines.id))
    .innerJoin(reconciliations, eq(reconciliations.id, reconciliationLines.reconciliationId))
    .where(and(eq(journalLines.journalEntryId, entryId), eq(reconciliations.status, "completed")))
    .limit(1);
  return row?.date ?? null;
}

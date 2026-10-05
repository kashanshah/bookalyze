"use server";

import {
  isMoneyAccountSubtype,
  minorUnits,
  parseDecimal,
  prepareJournalEntry,
  prepareTransfer,
  type TaxRateInfo,
  type TransactionInput,
  transactionLines,
} from "@bookalyze/core";
import {
  acceptDuplicate,
  booksLockedThrough,
  DuplicateError,
  dismissDuplicate,
  dismissTransfer,
  entryReconciledThrough,
  formatEntryNumber,
  getContact,
  LedgerError,
  linkAttachments,
  listTaxRates,
  matchSelected,
  matchTransfer,
  mergeSelected,
  postJournalEntry,
  replaceJournalEntry,
  schema,
  setTransactionReviewed,
  TransferError,
  unmatchTransfer,
  voidJournalEntry,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatDate } from "@/lib/dates";
import { type TransactionFormInput, transactionSchema } from "@/lib/validation/accounting";
import {
  type AccountingContext,
  type AccountRow,
  getAccountingContext,
  inOrg,
  listAccounts,
  toLedgerMap,
} from "@/server/accounting";
import { audit } from "@/server/audit";

export type TransactionErrors = Record<string, string>;
export type SaveTransactionResult =
  | { ok: true; data: { id: string; number: string } }
  | { ok: false; message?: string; errors?: TransactionErrors };
export type SimpleResult = { ok: true } | { ok: false; message: string };

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/accounting`, "layout");
}

function closedMessage(ctx: AccountingContext, lockedThrough: string) {
  return `Your books are closed through ${formatDate(lockedThrough, ctx.profile.locale, "long")}.`;
}

/** Loads the entry being edited or removed and checks it's a current, open transaction. */
async function loadEditable(ctx: AccountingContext, id: string) {
  return inOrg(ctx, async (tx) => {
    const [entry] = await tx
      .select()
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.id, id));
    const locked = await booksLockedThrough(tx);
    if (!entry) return { error: "This transaction no longer exists." };
    if (entry.reversedByEntryId || entry.reversesEntryId) {
      return { error: "This transaction has already been changed. Refresh to see the latest." };
    }
    if (locked && entry.date <= locked) {
      return {
        error: `${closedMessage(ctx, locked)} Transactions dated in a closed period can't be changed.`,
      };
    }
    const reconciled = await entryReconciledThrough(tx, entry.id);
    if (reconciled) {
      return {
        error: `This transaction is reconciled to your statement of ${formatDate(reconciled, ctx.profile.locale, "long")}. Undo that reconciliation to change it.`,
      };
    }
    return { entry };
  });
}

export async function saveTransactionAction(
  slug: string,
  input: TransactionFormInput,
): Promise<SaveTransactionResult> {
  const ctx = await getAccountingContext(slug);
  const parsed = transactionSchema.safeParse(input);
  if (!parsed.success) {
    const errors: TransactionErrors = {};
    for (const issue of parsed.error.issues)
      errors[issue.path.join(".") || "form"] ??= issue.message;
    return { ok: false, errors };
  }
  const value = parsed.data;
  const accounts = await listAccounts(ctx);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const isMoney = (a: AccountRow | undefined) => Boolean(a && isMoneyAccountSubtype(a.subtype));
  const base = ctx.profile.baseCurrency;

  // Shape the form into a transaction and catch the mistakes the journal rules can't explain.
  let txInput: TransactionInput;
  let currency: string;
  let splitIndex: number[] = [];
  let crossCurrency = false;
  let taxRates = new Map<string, TaxRateInfo>();
  if (value.kind === "transfer") {
    const from = byId.get(value.fromAccountId ?? "");
    const to = byId.get(value.toAccountId ?? "");
    const errors: TransactionErrors = {};
    if (!isMoney(from)) errors.fromAccountId = "Choose the account the money left.";
    if (!isMoney(to)) errors.toAccountId = "Choose the account the money went to.";
    if (from && to && from.id === to.id) errors.toAccountId = "Choose two different accounts.";
    if (Object.keys(errors).length) return { ok: false, errors };
    const fromCurrency = from?.currency ?? base;
    crossCurrency = fromCurrency !== (to?.currency ?? base);
    currency = fromCurrency;
    txInput = {
      kind: "transfer",
      fromAccountId: from?.id ?? "",
      toAccountId: to?.id ?? "",
      amount: value.amount ?? "",
    };
    if (!value.amount) return { ok: false, errors: { amount: "Enter the amount." } };
  } else {
    const money = byId.get(value.moneyAccountId ?? "");
    if (!isMoney(money)) {
      return { ok: false, errors: { moneyAccountId: "Choose a bank, card or cash account." } };
    }
    // Keep each filled row's position in the form so errors land on the right row.
    const filled = (value.splits ?? [])
      .map((s, index) => ({ ...s, index }))
      .filter((s) => s.accountId || s.amount);
    splitIndex = filled.map((s) => s.index);
    const splits = filled.map(({ index: _, ...s }) => s);
    if (!splits.length)
      return { ok: false, errors: { "splits.0": "Choose a category and amount." } };
    const splitErrors: TransactionErrors = {};
    splits.forEach((s, j) => {
      const i = splitIndex[j];
      if (!s.accountId) splitErrors[`splits.${i}`] = "Choose a category.";
      else if (isMoney(byId.get(s.accountId))) {
        splitErrors[`splits.${i}`] = "To move money between your accounts, use Transfer.";
      } else if (!s.amount) splitErrors[`splits.${i}`] = "Enter an amount.";
    });
    // Sales tax: rates must belong to the company; retired rates only stay on older transactions.
    if (splits.some((s) => s.taxRateId)) {
      const { rows, kept } = await inOrg(ctx, async (tx) => {
        const rows = await listTaxRates(tx, { includeArchived: true });
        // Rates already on the transaction being edited.
        const used = value.id
          ? await tx
              .select({ id: schema.journalLines.taxRateId })
              .from(schema.journalLines)
              .where(eq(schema.journalLines.journalEntryId, value.id))
          : [];
        return { rows, kept: new Set(used.map((u) => u.id)) };
      });
      taxRates = new Map(
        rows.map((r) => [
          r.id,
          {
            id: r.id,
            name: r.name,
            rate: r.rate,
            accountId: r.accountId,
            isRecoverable: r.isRecoverable,
          },
        ]),
      );
      splits.forEach((s, j) => {
        if (!s.taxRateId) return;
        const rate = rows.find((r) => r.id === s.taxRateId);
        if (!rate || (rate.isArchived && !kept.has(rate.id))) {
          splitErrors[`splits.${splitIndex[j]}`] =
            "Choose a tax rate from your sales tax settings.";
        }
      });
    }
    if (Object.keys(splitErrors).length) return { ok: false, errors: splitErrors };
    let total = 0n;
    for (const s of splits) {
      try {
        total += parseDecimal(s.amount);
      } catch {
        // Reported per line by prepareJournalEntry below.
      }
    }
    if (total <= 0n) {
      return { ok: false, message: "The total must be more than zero." };
    }
    currency = money?.currency ?? base;
    txInput = { kind: value.kind, moneyAccountId: money?.id ?? "", splits };
  }

  const prepared =
    txInput.kind === "transfer"
      ? prepareTransfer(
          {
            fromAccountId: txInput.fromAccountId,
            toAccountId: txInput.toAccountId,
            sent: txInput.amount,
            received: value.received,
            baseCurrency: base,
            fxRate: value.fxRate,
            memo: value.memo,
          },
          toLedgerMap(accounts),
        )
      : prepareJournalEntry(
          {
            currency,
            baseCurrency: base,
            fxRate: value.fxRate,
            lines: transactionLines(txInput, value.memo, {
              rates: taxRates,
              decimals: minorUnits(currency),
            }),
          },
          toLedgerMap(accounts),
        );
  if (!prepared.ok) {
    const errors: TransactionErrors = {};
    if (prepared.errors.fxRate) errors.fxRate = prepared.errors.fxRate;
    for (const [index, message] of Object.entries(prepared.errors.lines ?? {})) {
      const i = Number(index);
      // Transfers: line 0 is the receiving side, line 1 the sending side. Between currencies the
      // messages are about the amounts; otherwise about the accounts.
      if (txInput.kind === "transfer" && crossCurrency)
        errors[i === 0 ? "received" : "amount"] = message;
      else if (txInput.kind === "transfer")
        errors[i === 0 ? "toAccountId" : "fromAccountId"] = message;
      else if (i === 0) errors.moneyAccountId = message;
      else errors[`splits.${splitIndex[i - 1] ?? i - 1}`] = message;
    }
    return { ok: false, message: prepared.errors.form, errors };
  }

  // The customer or vendor, if any (transfers have none).
  const contactId = value.kind === "transfer" ? null : value.contactId || null;
  if (contactId) {
    const contact = await inOrg(ctx, (tx) => getContact(tx, contactId));
    if (!contact) return { ok: false, errors: { contactId: "This contact no longer exists." } };
  }

  if (value.id) {
    const editable = await loadEditable(ctx, value.id);
    if ("error" in editable) return { ok: false, message: editable.error };
  }

  try {
    const posted = await inOrg(ctx, async (tx) => {
      const common = {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        date: value.date,
        memo: value.memo,
        contactId,
        entry: prepared.entry,
      };
      const result = value.id
        ? await replaceJournalEntry(tx, { ...common, entryId: value.id })
        : await postJournalEntry(tx, common);
      if (!value.id && value.attachmentIds?.length) {
        await linkAttachments(tx, {
          orgId: ctx.org.id,
          attachmentIds: value.attachmentIds,
          entityType: "journal_entry",
          entityId: result.id,
          userId: ctx.session.user.id,
        });
      }
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: value.id ? "transaction.updated" : "transaction.created",
        entityType: "journal_entry",
        entityId: result.id,
        after: {
          kind: value.kind,
          date: value.date,
          memo: value.memo,
          replaces: value.id ?? null,
          ...prepared.entry,
        },
      });
      return result;
    });
    revalidate(slug);
    return { ok: true, data: { id: posted.id, number: formatEntryNumber(posted.entryNumber) } };
  } catch (error) {
    if (error instanceof LedgerError && error.code === "period_locked" && error.lockedThrough) {
      return {
        ok: false,
        errors: { date: `${closedMessage(ctx, error.lockedThrough)} Choose a later date.` },
      };
    }
    if (error instanceof LedgerError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function setReviewedAction(
  slug: string,
  entryId: string,
  reviewed: boolean,
): Promise<SimpleResult> {
  const ctx = await getAccountingContext(slug);
  await inOrg(ctx, async (tx) => {
    await setTransactionReviewed(tx, {
      orgId: ctx.org.id,
      entryId,
      reviewed,
      userId: ctx.session.user.id,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: reviewed ? "transaction.reviewed" : "transaction.unreviewed",
      entityType: "journal_entry",
      entityId: entryId,
    });
  });
  revalidate(slug);
  return { ok: true };
}

export async function deleteTransactionAction(
  slug: string,
  entryId: string,
): Promise<SimpleResult> {
  const ctx = await getAccountingContext(slug);
  const editable = await loadEditable(ctx, entryId);
  if ("error" in editable) return { ok: false, message: editable.error ?? "Can't remove this." };
  try {
    await inOrg(ctx, async (tx) => {
      const reversal = await voidJournalEntry(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        entryId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "transaction.removed",
        entityType: "journal_entry",
        entityId: entryId,
        after: { reversalId: reversal.id },
      });
    });
  } catch (error) {
    if (error instanceof LedgerError) return { ok: false, message: error.message };
    throw error;
  }
  revalidate(slug);
  return { ok: true };
}

function duplicateFailure(error: unknown): SimpleResult {
  if (
    error instanceof DuplicateError ||
    error instanceof TransferError ||
    error instanceof LedgerError
  ) {
    return { ok: false, message: error.message };
  }
  throw error;
}

const idSchema = z.string().uuid();

/** A flagged transaction is a copy: the one already in the books stays, the copy is removed. */
export async function acceptDuplicateAction(
  slug: string,
  suggestionId: string,
): Promise<SimpleResult> {
  const ctx = await getAccountingContext(slug);
  if (!idSchema.safeParse(suggestionId).success) return { ok: false, message: "Unknown item." };
  try {
    await inOrg(ctx, async (tx) => {
      const merged = await acceptDuplicate(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        suggestionId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "transaction.merged",
        entityType: "journal_entry",
        entityId: merged.keptId,
        after: { removedId: merged.removedId, suggestionId },
      });
    });
  } catch (error) {
    return duplicateFailure(error);
  }
  revalidate(slug);
  return { ok: true };
}

/** A flagged transaction isn't a copy: both stay, and the pair isn't flagged again. */
export async function dismissDuplicateAction(
  slug: string,
  suggestionId: string,
): Promise<SimpleResult> {
  const ctx = await getAccountingContext(slug);
  if (!idSchema.safeParse(suggestionId).success) return { ok: false, message: "Unknown item." };
  try {
    await inOrg(ctx, async (tx) => {
      await dismissDuplicate(tx, { userId: ctx.session.user.id, suggestionId });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "transaction.duplicate_dismissed",
        entityType: "duplicate_suggestion",
        entityId: suggestionId,
      });
    });
  } catch (error) {
    return duplicateFailure(error);
  }
  revalidate(slug);
  return { ok: true };
}

/** Merges two transactions picked on the list (same amount, bank account and category). */
export async function mergeTransactionsAction(
  slug: string,
  entryIds: string[],
): Promise<SimpleResult> {
  const ctx = await getAccountingContext(slug);
  const parsed = z.array(idSchema).length(2).safeParse(entryIds);
  if (!parsed.success) return { ok: false, message: "Pick exactly two transactions to merge." };
  for (const id of parsed.data) {
    const editable = await loadEditable(ctx, id);
    if ("error" in editable) return { ok: false, message: editable.error ?? "Can't merge these." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      const merged = await mergeSelected(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        entryIds: parsed.data,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "transaction.merged",
        entityType: "journal_entry",
        entityId: merged.keptId,
        after: { removedId: merged.removedId, manual: true },
      });
    });
  } catch (error) {
    return duplicateFailure(error);
  }
  revalidate(slug);
  return { ok: true };
}

/**
 * Removes several transactions (each reversed on its own date, like removing one). Those in a
 * closed period or a completed reconciliation are left alone and reported.
 */
export async function removeTransactionsAction(
  slug: string,
  entryIds: string[],
): Promise<
  { ok: true; removed: number; kept: number; reasons: string[] } | { ok: false; message: string }
> {
  const ctx = await getAccountingContext(slug);
  const parsed = z.array(idSchema).min(1).max(200).safeParse(entryIds);
  if (!parsed.success) return { ok: false, message: "Pick up to 200 transactions to remove." };
  let removed = 0;
  let kept = 0;
  const reasons = new Set<string>();
  for (const entryId of new Set(parsed.data)) {
    const editable = await loadEditable(ctx, entryId);
    if ("error" in editable) {
      kept++;
      reasons.add(editable.error ?? "It couldn't be removed.");
      continue;
    }
    try {
      await inOrg(ctx, async (tx) => {
        const reversal = await voidJournalEntry(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          entryId,
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "transaction.removed",
          entityType: "journal_entry",
          entityId: entryId,
          after: { reversalId: reversal.id, bulk: true },
        });
      });
      removed++;
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      kept++;
      reasons.add(error.message);
    }
  }
  if (removed) revalidate(slug);
  return { ok: true, removed, kept, reasons: [...reasons] };
}

/** Checks every entry can still be changed (current, open period, not reconciled). */
async function allEditable(ctx: AccountingContext, ids: readonly string[]) {
  for (const id of ids) {
    const editable = await loadEditable(ctx, id);
    if ("error" in editable) return editable.error ?? "These can't be changed.";
  }
  return null;
}

/**
 * Matches money out of one account with money into another as one transfer: both are replaced
 * by a single transfer that keeps their bank links and receipts. `outId` sends, `inId` receives;
 * picked by hand (`entryIds`), the direction comes from the amounts.
 */
export async function matchTransferAction(
  slug: string,
  input: { outId: string; inId: string } | { entryIds: string[] },
): Promise<SimpleResult> {
  const ctx = await getAccountingContext(slug);
  const ids = "entryIds" in input ? input.entryIds : [input.outId, input.inId];
  const parsed = z.array(idSchema).length(2).safeParse(ids);
  if (!parsed.success) return { ok: false, message: "Pick two transactions to match." };
  const blocked = await allEditable(ctx, parsed.data);
  if (blocked) return { ok: false, message: blocked };
  try {
    await inOrg(ctx, async (tx) => {
      const common = {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        baseCurrency: ctx.profile.baseCurrency,
      };
      const [outId, inId] = parsed.data as [string, string];
      const { transferId } =
        "entryIds" in input
          ? await matchSelected(tx, { ...common, entryIds: parsed.data })
          : await matchTransfer(tx, { ...common, outId, inId });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "transaction.transfer_matched",
        entityType: "journal_entry",
        entityId: transferId,
        after: { entryIds: parsed.data, manual: "entryIds" in input },
      });
    });
  } catch (error) {
    return duplicateFailure(error);
  }
  revalidate(slug);
  return { ok: true };
}

/** A suggested pair isn't a transfer: both stay as they are and the pair isn't suggested again. */
export async function dismissTransferAction(
  slug: string,
  outId: string,
  inId: string,
): Promise<SimpleResult> {
  const ctx = await getAccountingContext(slug);
  if (!idSchema.safeParse(outId).success || !idSchema.safeParse(inId).success || outId === inId) {
    return { ok: false, message: "Unknown item." };
  }
  await inOrg(ctx, async (tx) => {
    await dismissTransfer(tx, { orgId: ctx.org.id, userId: ctx.session.user.id, outId, inId });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "transaction.transfer_dismissed",
      entityType: "journal_entry",
      entityId: outId,
      after: { inId },
    });
  });
  revalidate(slug);
  return { ok: true };
}

/** Undoes a match: the transfer goes and both bank transactions come back, uncategorized. */
export async function unmatchTransferAction(slug: string, entryId: string): Promise<SimpleResult> {
  const ctx = await getAccountingContext(slug);
  if (!idSchema.safeParse(entryId).success) return { ok: false, message: "Unknown item." };
  const blocked = await allEditable(ctx, [entryId]);
  if (blocked) return { ok: false, message: blocked };
  try {
    await inOrg(ctx, async (tx) => {
      const back = await unmatchTransfer(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        transferEntryId: entryId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "transaction.transfer_unmatched",
        entityType: "journal_entry",
        entityId: entryId,
        after: back,
      });
    });
  } catch (error) {
    return duplicateFailure(error);
  }
  revalidate(slug);
  return { ok: true };
}

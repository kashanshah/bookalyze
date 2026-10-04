"use server";

import {
  isMoneyAccountSubtype,
  parseDecimal,
  prepareJournalEntry,
  type TransactionInput,
  transactionLines,
} from "@bookalyze/core";
import {
  booksLockedThrough,
  formatEntryNumber,
  getContact,
  LedgerError,
  linkAttachments,
  postJournalEntry,
  replaceJournalEntry,
  schema,
  setTransactionReviewed,
  voidJournalEntry,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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
  if (value.kind === "transfer") {
    const from = byId.get(value.fromAccountId ?? "");
    const to = byId.get(value.toAccountId ?? "");
    const errors: TransactionErrors = {};
    if (!isMoney(from)) errors.fromAccountId = "Choose the account the money left.";
    if (!isMoney(to)) errors.toAccountId = "Choose the account the money went to.";
    if (from && to && from.id === to.id) errors.toAccountId = "Choose two different accounts.";
    if (Object.keys(errors).length) return { ok: false, errors };
    const fromCurrency = from?.currency ?? base;
    const toCurrency = to?.currency ?? base;
    if (fromCurrency !== toCurrency) {
      return {
        ok: false,
        errors: {
          toAccountId: `Transfers between ${fromCurrency} and ${toCurrency} accounts are coming soon. For now, record it as a journal entry.`,
        },
      };
    }
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

  const prepared = prepareJournalEntry(
    {
      currency,
      baseCurrency: base,
      fxRate: value.fxRate,
      lines: transactionLines(txInput, value.memo),
    },
    toLedgerMap(accounts),
  );
  if (!prepared.ok) {
    const errors: TransactionErrors = {};
    if (prepared.errors.fxRate) errors.fxRate = prepared.errors.fxRate;
    for (const [index, message] of Object.entries(prepared.errors.lines ?? {})) {
      const i = Number(index);
      if (txInput.kind === "transfer") errors[i === 0 ? "toAccountId" : "fromAccountId"] = message;
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

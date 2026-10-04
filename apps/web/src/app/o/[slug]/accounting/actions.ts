"use server";

import { prepareJournalEntry } from "@bookalyze/core";
import {
  createDefaultChart,
  formatEntryNumber,
  LedgerError,
  postJournalEntry,
  reverseJournalEntry,
  schema,
} from "@bookalyze/db";
import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { isIsoDate } from "@/lib/dates";
import {
  type AccountInput,
  accountSchema,
  type JournalEntryFormInput,
  journalEntrySchema,
} from "@/lib/validation/accounting";
import { getAccountingContext, inOrg, listAccounts, toLedgerMap } from "@/server/accounting";
import { audit } from "@/server/audit";

export type FieldErrors = Record<string, string>;
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message?: string; errors?: FieldErrors };

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Postgres error code and constraint behind a Drizzle error, if any. */
function pgError(error: unknown): { code?: string; constraint?: string } {
  const cause = (error as { cause?: { code?: string; constraint?: string } })?.cause;
  return cause ?? (error as { code?: string; constraint?: string }) ?? {};
}

function revalidateAccounting(slug: string) {
  revalidatePath(`/o/${slug}/accounting`, "layout");
  revalidatePath(`/o/${slug}`);
}

/** Creates the standard chart of accounts for a company that has none yet. */
export async function setupChartAction(slug: string): Promise<ActionResult<{ created: number }>> {
  const ctx = await getAccountingContext(slug);
  const created = await inOrg(ctx, async (tx) => {
    const n = await createDefaultChart(tx, {
      orgId: ctx.org.id,
      baseCurrency: ctx.profile.baseCurrency,
      userId: ctx.session.user.id,
    });
    if (n > 0) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "accounts.chart_created",
        entityType: "account",
        after: { accounts: n },
      });
    }
    return n;
  });
  revalidateAccounting(slug);
  return { ok: true, data: { created } };
}

export async function saveAccountAction(
  slug: string,
  input: AccountInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAccountingContext(slug);
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error.issues) };
  const value = parsed.data;
  const userId = ctx.session.user.id;

  try {
    const result = await inOrg(ctx, async (tx): Promise<ActionResult<{ id: string }>> => {
      if (!value.id) {
        const [row] = await tx
          .insert(schema.accounts)
          .values({
            organizationId: ctx.org.id,
            name: value.name,
            code: value.code,
            type: value.type,
            subtype: value.subtype,
            description: value.description,
            currency: value.currency,
            createdBy: userId,
          })
          .returning();
        if (!row) return { ok: false, message: "Could not create the account." };
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: userId,
          action: "account.created",
          entityType: "account",
          entityId: row.id,
          after: row,
        });
        return { ok: true, data: { id: row.id } };
      }

      const [existing] = await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, value.id));
      if (!existing) return { ok: false, message: "This account no longer exists." };
      const [usage] = await tx
        .select({ n: count() })
        .from(schema.journalLines)
        .where(eq(schema.journalLines.accountId, existing.id));
      const used = (usage?.n ?? 0) > 0;
      if (
        existing.systemKey &&
        (existing.type !== value.type || existing.subtype !== value.subtype)
      ) {
        return {
          ok: false,
          errors: { subtype: "Bookalyze relies on this account, so its type can't change." },
        };
      }
      if (used && existing.type !== value.type) {
        return {
          ok: false,
          errors: { type: "This account already has entries, so its type can't change." },
        };
      }
      if (used && existing.currency !== value.currency) {
        return {
          ok: false,
          errors: { currency: "This account already has entries, so its currency can't change." },
        };
      }
      const [row] = await tx
        .update(schema.accounts)
        .set({
          name: value.name,
          code: value.code,
          type: value.type,
          subtype: value.subtype,
          description: value.description,
          currency: value.currency,
        })
        .where(eq(schema.accounts.id, existing.id))
        .returning();
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: userId,
        action: "account.updated",
        entityType: "account",
        entityId: existing.id,
        before: existing,
        after: row,
      });
      return { ok: true, data: { id: existing.id } };
    });
    if (result.ok) revalidateAccounting(slug);
    return result;
  } catch (error) {
    const pg = pgError(error);
    if (pg.code === "23505" && pg.constraint === "accounts_org_code_key") {
      return { ok: false, errors: { code: "Another account already uses this code." } };
    }
    throw error;
  }
}

export async function setAccountArchivedAction(
  slug: string,
  id: string,
  archived: boolean,
): Promise<ActionResult> {
  const ctx = await getAccountingContext(slug);
  const result = await inOrg(ctx, async (tx): Promise<ActionResult> => {
    const [existing] = await tx.select().from(schema.accounts).where(eq(schema.accounts.id, id));
    if (!existing) return { ok: false, message: "This account no longer exists." };
    if (archived && existing.systemKey) {
      return {
        ok: false,
        message: `Bookalyze relies on ${existing.name}, so it can't be archived.`,
      };
    }
    await tx
      .update(schema.accounts)
      .set({ isArchived: archived })
      .where(eq(schema.accounts.id, id));
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: archived ? "account.archived" : "account.restored",
      entityType: "account",
      entityId: id,
    });
    return { ok: true, data: undefined };
  });
  if (result.ok) revalidateAccounting(slug);
  return result;
}

export type PostEntryResult =
  | { ok: true; data: { id: string; number: string } }
  | {
      ok: false;
      message?: string;
      errors?: FieldErrors;
      lineErrors?: Record<number, string>;
    };

export async function postJournalEntryAction(
  slug: string,
  input: JournalEntryFormInput,
): Promise<PostEntryResult> {
  const ctx = await getAccountingContext(slug);
  const parsed = journalEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error.issues) };
  const value = parsed.data;

  const accounts = await listAccounts(ctx);
  const prepared = prepareJournalEntry(
    {
      currency: value.currency,
      baseCurrency: ctx.profile.baseCurrency,
      fxRate: value.fxRate,
      lines: value.lines,
    },
    toLedgerMap(accounts),
  );
  if (!prepared.ok) {
    const { form, fxRate, lines } = prepared.errors;
    return {
      ok: false,
      message: form,
      errors: fxRate ? { fxRate } : undefined,
      lineErrors: lines,
    };
  }

  const posted = await inOrg(ctx, async (tx) => {
    const result = await postJournalEntry(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      date: value.date,
      reference: value.reference,
      memo: value.memo,
      entry: prepared.entry,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "journal_entry.posted",
      entityType: "journal_entry",
      entityId: result.id,
      after: { number: result.entryNumber, date: value.date, memo: value.memo, ...prepared.entry },
    });
    return result;
  });
  revalidateAccounting(slug);
  return { ok: true, data: { id: posted.id, number: formatEntryNumber(posted.entryNumber) } };
}

export async function reverseJournalEntryAction(
  slug: string,
  entryId: string,
  date: string,
): Promise<ActionResult<{ id: string; number: string }>> {
  const ctx = await getAccountingContext(slug);
  if (!isIsoDate(date)) return { ok: false, errors: { date: "Choose a date." } };
  try {
    const result = await inOrg(ctx, async (tx) => {
      const reversal = await reverseJournalEntry(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        entryId,
        date,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "journal_entry.reversed",
        entityType: "journal_entry",
        entityId: entryId,
        after: { reversalId: reversal.id, date },
      });
      return reversal;
    });
    revalidateAccounting(slug);
    return { ok: true, data: { id: result.id, number: formatEntryNumber(result.entryNumber) } };
  } catch (error) {
    if (error instanceof LedgerError) return { ok: false, message: error.message };
    throw error;
  }
}

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
import { formatDate, isIsoDate } from "@/lib/dates";
import {
  type AccountInput,
  accountSchema,
  type JournalEntryFormInput,
  journalEntrySchema,
} from "@/lib/validation/accounting";
import {
  type AccountingContext,
  getAccountingContext,
  inOrg,
  listAccounts,
  toLedgerMap,
} from "@/server/accounting";
import { audit } from "@/server/audit";
import { suggestRate } from "@/server/fx";
import { isOrgAdmin } from "@/server/org";

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

type PgErrorInfo = { code?: string; constraint?: string; hint?: string; message?: string };

/** Postgres error details behind a Drizzle error, if any. */
function pgError(error: unknown): PgErrorInfo {
  const cause = (error as { cause?: PgErrorInfo })?.cause;
  return cause ?? (error as PgErrorInfo) ?? {};
}

/**
 * A friendly message when `error` is the ledger refusing a date in a closed period, either from
 * the ledger helpers or from the database trigger (if the lock changed mid-request).
 */
function closedPeriodMessage(error: unknown, ctx: AccountingContext): string | null {
  let lockedThrough: string | undefined;
  if (error instanceof LedgerError && error.code === "period_locked") {
    lockedThrough = error.lockedThrough;
  } else {
    const pg = pgError(error);
    if (pg.hint !== "period_locked") return null;
    lockedThrough = pg.message?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  }
  const when = lockedThrough ? formatDate(lockedThrough, ctx.profile.locale, "long") : "that date";
  return `Your books are closed through ${when}. Choose a later date, or ask an owner to reopen the period.`;
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
      // The currency may change at any time; amounts already recorded stay exactly as they are
      // (each line keeps the currency it was written in). Only new transactions use the new one.
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

  let posted: { id: string; entryNumber: number };
  try {
    posted = await inOrg(ctx, async (tx) => {
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
        after: {
          number: result.entryNumber,
          date: value.date,
          memo: value.memo,
          ...prepared.entry,
        },
      });
      return result;
    });
  } catch (error) {
    const closed = closedPeriodMessage(error, ctx);
    if (closed) return { ok: false, errors: { date: closed } };
    throw error;
  }
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
    const closed = closedPeriodMessage(error, ctx);
    if (closed) return { ok: false, errors: { date: closed } };
    if (error instanceof LedgerError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Closes the books through `date` (no entries on or before it), or reopens every period when
 * `date` is null. Owners and admins only.
 */
export async function setBooksLockAction(
  slug: string,
  date: string | null,
): Promise<ActionResult<{ lockedThrough: string | null }>> {
  const ctx = await getAccountingContext(slug);
  if (!isOrgAdmin(ctx)) {
    return { ok: false, message: "Only owners and admins can close or reopen the books." };
  }
  if (date !== null && !isIsoDate(date)) return { ok: false, errors: { date: "Choose a date." } };
  const before = ctx.profile.booksLockedThrough;
  await inOrg(ctx, async (tx) => {
    await tx
      .update(schema.organizationProfiles)
      .set({ booksLockedThrough: date })
      .where(eq(schema.organizationProfiles.organizationId, ctx.org.id));
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: date ? "books.closed" : "books.reopened",
      entityType: "organization_profile",
      entityId: ctx.org.id,
      before: { booksLockedThrough: before },
      after: { booksLockedThrough: date },
    });
  });
  revalidatePath(`/o/${slug}`, "layout");
  return { ok: true, data: { lockedThrough: date } };
}

/**
 * The exchange rate to suggest for `currency` on `date`, in this company's main currency, or null
 * if none is published for that date.
 */
export async function suggestRateAction(
  slug: string,
  currency: string,
  date: string,
): Promise<{ rate: string; asOf: string | null; source: string } | null> {
  const ctx = await getAccountingContext(slug);
  if (!isIsoDate(date) || !/^[A-Z]{3}$/.test(currency)) return null;
  return suggestRate(ctx.profile.baseCurrency, currency, date);
}

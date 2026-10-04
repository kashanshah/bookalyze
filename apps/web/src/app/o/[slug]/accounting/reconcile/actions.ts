"use server";

import { isDecimal, parseDecimal } from "@bookalyze/core";
import {
  cancelReconciliation,
  completeReconciliation,
  ReconcileError,
  setLinesCleared,
  startReconciliation,
  undoReconciliation,
  updateReconciliationStatement,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";

export type ReconcileResult =
  | { ok: true; id?: string }
  | { ok: false; message?: string; errors?: Record<string, string> };

const statementSchema = z.object({
  statementDate: z.string().refine(isIsoDate, "Choose the statement's closing date."),
  statementBalance: z
    .string()
    .trim()
    .transform((v) => v.replace(/[,$\s]/g, ""))
    .refine((v) => isDecimal(v), "Enter the ending balance, like 1,250.00.")
    .refine((v) => {
      try {
        parseDecimal(v);
        return true;
      } catch {
        return false;
      }
    }, "Use up to 4 decimal places."),
});

function issues(error: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[issue.path.join(".") || "form"] ??= issue.message;
  return errors;
}

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/accounting`, "layout");
}

async function guarded<T>(fn: () => Promise<T>): Promise<T | { ok: false; message: string }> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ReconcileError) return { ok: false, message: error.message };
    const hint = (error as { cause?: { hint?: string } })?.cause?.hint;
    if (hint === "reconciled") {
      return { ok: false, message: "This reconciliation is finished. Undo it to change it." };
    }
    throw error;
  }
}

export async function startReconciliationAction(
  slug: string,
  accountId: string,
  input: { statementDate: string; statementBalance: string },
): Promise<ReconcileResult> {
  const ctx = await getAccountingContext(slug);
  const parsed = statementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error) };
  if (!z.uuid().safeParse(accountId).success) return { ok: false, message: "Choose an account." };
  return guarded(async () => {
    const rec = await inOrg(ctx, async (tx) => {
      const row = await startReconciliation(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        accountId,
        ...parsed.data,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "reconciliation.started",
        entityType: "reconciliation",
        entityId: row.id,
        after: row,
      });
      return row;
    });
    revalidate(slug);
    return { ok: true as const, id: rec.id };
  });
}

export async function updateStatementAction(
  slug: string,
  id: string,
  input: { statementDate: string; statementBalance: string },
): Promise<ReconcileResult> {
  const ctx = await getAccountingContext(slug);
  const parsed = statementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error) };
  return guarded(async () => {
    await inOrg(ctx, (tx) => updateReconciliationStatement(tx, { id, ...parsed.data }));
    revalidate(slug);
    return { ok: true as const };
  });
}

export async function setClearedAction(
  slug: string,
  id: string,
  lineIds: string[],
  cleared: boolean,
): Promise<ReconcileResult> {
  const ctx = await getAccountingContext(slug);
  const ids = z.array(z.uuid()).max(10000).safeParse(lineIds);
  if (!ids.success) return { ok: false, message: "Something went wrong. Refresh and try again." };
  return guarded(async () => {
    await inOrg(ctx, (tx) =>
      setLinesCleared(tx, { orgId: ctx.org.id, reconciliationId: id, lineIds: ids.data, cleared }),
    );
    return { ok: true as const };
  });
}

export async function completeReconciliationAction(
  slug: string,
  id: string,
): Promise<ReconcileResult> {
  const ctx = await getAccountingContext(slug);
  return guarded(async () => {
    await inOrg(ctx, async (tx) => {
      const totals = await completeReconciliation(tx, { id, userId: ctx.session.user.id });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "reconciliation.completed",
        entityType: "reconciliation",
        entityId: id,
        after: totals,
      });
    });
    revalidate(slug);
    return { ok: true as const };
  });
}

export async function cancelReconciliationAction(
  slug: string,
  id: string,
): Promise<ReconcileResult> {
  const ctx = await getAccountingContext(slug);
  return guarded(async () => {
    await inOrg(ctx, async (tx) => {
      await cancelReconciliation(tx, id);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "reconciliation.cancelled",
        entityType: "reconciliation",
        entityId: id,
      });
    });
    revalidate(slug);
    return { ok: true as const };
  });
}

export async function undoReconciliationAction(slug: string, id: string): Promise<ReconcileResult> {
  const ctx = await getAccountingContext(slug);
  return guarded(async () => {
    await inOrg(ctx, async (tx) => {
      await undoReconciliation(tx, id);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "reconciliation.undone",
        entityType: "reconciliation",
        entityId: id,
      });
    });
    revalidate(slug);
    return { ok: true as const };
  });
}

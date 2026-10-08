"use server";

import { isDecimal } from "@bookalyze/core";
import {
  addOpeningStock,
  CogsError,
  LedgerError,
  postCogs,
  removeOpeningStock,
  undoCogs,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";

const FEATURE = "inventory.cogs";
export type CogsActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; errors?: Record<string, string> };

function friendly(error: unknown): CogsActionResult {
  if (error instanceof CogsError || error instanceof LedgerError) {
    return { ok: false, message: error.message };
  }
  throw error;
}

const monthSchema = z.object({
  channelId: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

/** Posts a marketplace's month of cost of goods sold. */
export async function postCogsAction(slug: string, input: unknown): Promise<CogsActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const parsed = monthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a month to post." };
  const { timezone, baseCurrency } = ctx.profile;
  try {
    const posted = await inOrg(ctx, async (tx) => {
      const result = await postCogs(tx, {
        ...parsed.data,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        timezone,
        baseCurrency,
        currentMonth: nowIn(timezone).date.slice(0, 7),
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "cogs.posted",
        entityType: "cogs_period",
        entityId: result.id,
        after: { ...parsed.data, units: result.units, cost: result.cost },
      });
      return result;
    });
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true, message: posted.cost };
  } catch (error) {
    return friendly(error);
  }
}

/** Undoes the latest posted month. */
export async function undoCogsAction(slug: string, periodId: string): Promise<CogsActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!z.uuid().safeParse(periodId).success) {
    return { ok: false, message: "This month is no longer posted." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      const undone = await undoCogs(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        periodId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "cogs.undone",
        entityType: "cogs_period",
        entityId: periodId,
        before: undone,
      });
    });
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

const openingSchema = z.object({
  productId: z.uuid("Choose a product."),
  quantity: z.coerce
    .number({ message: "Enter how many you had." })
    .int("Use a whole number.")
    .min(1, "At least 1.")
    .max(10_000_000, "That's too many."),
  unitCost: z
    .string()
    .trim()
    .refine((v) => isDecimal(v) && !v.startsWith("-"), "Enter what one cost, e.g. 2.45.")
    .refine((v) => (v.split(".")[1] ?? "").length <= 4, "At most 4 decimals."),
  date: z.string().refine(isIsoDate, "Choose the date you counted it."),
  notes: z
    .string()
    .trim()
    .max(300, "Keep it under 300 characters.")
    .optional()
    .transform((v) => v || null),
});

/** Stock on hand before Bookalyze, as a lot at its cost. */
export async function addOpeningStockAction(
  slug: string,
  input: unknown,
): Promise<CogsActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const parsed = openingSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  try {
    const lot = await inOrg(ctx, async (tx) => {
      const added = await addOpeningStock(tx, {
        ...parsed.data,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        baseCurrency: ctx.profile.baseCurrency,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "inventory_lot.opening_added",
        entityType: "inventory_lot",
        entityId: added.id,
        after: { ...parsed.data, total: added.total },
      });
      return added;
    });
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true, message: lot.total };
  } catch (error) {
    return friendly(error);
  }
}

export async function removeOpeningStockAction(
  slug: string,
  lotId: string,
): Promise<CogsActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!z.uuid().safeParse(lotId).success) {
    return { ok: false, message: "This opening stock no longer exists." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      await removeOpeningStock(tx, { orgId: ctx.org.id, userId: ctx.session.user.id, lotId });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "inventory_lot.opening_removed",
        entityType: "inventory_lot",
        entityId: lotId,
      });
    });
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

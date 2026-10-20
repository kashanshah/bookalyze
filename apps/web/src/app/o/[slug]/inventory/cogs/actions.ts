"use server";

import { isDecimal } from "@bookalyze/core";
import {
  addOpeningStock,
  CogsError,
  LedgerError,
  moveStock,
  postCogs,
  putBackInStock,
  removeOpeningStock,
  takeOutOfStock,
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

const takeOutSchema = z.object({
  lotId: z.uuid("This stock lot no longer exists."),
  quantity: z.coerce
    .number("Enter how many.")
    .int("Use a whole number.")
    .min(1, "Take out at least 1.")
    .max(1_000_000, "That's more than a lot holds."),
  date: z.string().refine(isIsoDate, "Choose the day they left."),
  accountId: z.uuid("Choose where the cost goes."),
  notes: z
    .string()
    .trim()
    .max(200, "Keep the note under 200 characters.")
    .optional()
    .transform((v) => v || null),
});

/** Takes units out of a stock lot by hand (sold outside the marketplaces, taken, lost…). */
export async function takeOutOfStockAction(
  slug: string,
  input: unknown,
): Promise<CogsActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const parsed = takeOutSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  try {
    const removed = await inOrg(ctx, async (tx) => {
      const r = await takeOutOfStock(tx, {
        ...parsed.data,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        baseCurrency: ctx.profile.baseCurrency,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "inventory_lot.taken_out",
        entityType: "stock_removal",
        entityId: r.id,
        after: { ...parsed.data, cost: r.cost },
      });
      return r;
    });
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true, message: removed.cost };
  } catch (error) {
    return friendly(error);
  }
}

/** Puts units taken out by hand back into their lot. */
export async function putBackInStockAction(
  slug: string,
  removalId: string,
): Promise<CogsActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!z.uuid().safeParse(removalId).success) {
    return { ok: false, message: "This was already put back." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      await putBackInStock(tx, { orgId: ctx.org.id, userId: ctx.session.user.id, removalId });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "inventory_lot.put_back",
        entityType: "stock_removal",
        entityId: removalId,
      });
    });
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

const moveSchema = z.object({
  lotId: z.uuid("This stock lot no longer exists."),
  productId: z.uuid("Choose the product they really are."),
  quantity: z.coerce
    .number("Enter how many.")
    .int("Use a whole number.")
    .min(1, "Move at least 1.")
    .max(1_000_000, "That's more than a lot holds."),
  date: z.string().refine(isIsoDate, "Choose the day."),
  notes: z
    .string()
    .trim()
    .max(200, "Keep the note under 200 characters.")
    .optional()
    .transform((v) => v || null),
});

/** Moves units from a lot to the product they really are (a label or listing mix-up). */
export async function moveStockAction(slug: string, input: unknown): Promise<CogsActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  try {
    await inOrg(ctx, async (tx) => {
      const moved = await moveStock(tx, {
        ...parsed.data,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        baseCurrency: ctx.profile.baseCurrency,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "inventory_lot.moved",
        entityType: "stock_removal",
        entityId: moved.id,
        after: { ...parsed.data, toLotId: moved.lotId, cost: moved.cost },
      });
    });
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

"use server";

import { addStockCount, CogsError, removeStockCount } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";

const FEATURE = "inventory.cogs";
export type StockActionResult =
  | { ok: true }
  | { ok: false; message: string; errors?: Record<string, string> };

const countSchema = z.object({
  productId: z.uuid("This product no longer exists."),
  quantity: z.coerce
    .number("Enter how many you have.")
    .int("Use a whole number.")
    .min(0, "Use 0 or more.")
    .max(10_000_000, "That's more than we can count."),
  countedOn: z.string().refine(isIsoDate, "Choose the day you counted."),
  notes: z
    .string()
    .trim()
    .max(200, "Keep the note under 200 characters.")
    .optional()
    .transform((v) => v || null),
});

/** Records stock you hold yourself (with you, at a 3PL), counted on a day. */
export async function addStockCountAction(
  slug: string,
  input: unknown,
): Promise<StockActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const parsed = countSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  try {
    await inOrg(ctx, async (tx) => {
      const row = await addStockCount(tx, {
        ...parsed.data,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "stock_count.added",
        entityType: "stock_count",
        entityId: row.id,
        after: parsed.data,
      });
    });
    revalidatePath(`/o/${slug}/inventory/stock`);
    return { ok: true };
  } catch (error) {
    if (error instanceof CogsError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Removes a count you made by mistake. */
export async function removeStockCountAction(
  slug: string,
  input: { productId: string; countId: string },
): Promise<StockActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!z.uuid().safeParse(input.productId).success || !z.uuid().safeParse(input.countId).success) {
    return { ok: false, message: "This count was already removed." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      await removeStockCount(tx, input);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "stock_count.removed",
        entityType: "stock_count",
        entityId: input.countId,
      });
    });
    revalidatePath(`/o/${slug}/inventory/stock`);
    return { ok: true };
  } catch (error) {
    if (error instanceof CogsError) return { ok: false, message: error.message };
    throw error;
  }
}

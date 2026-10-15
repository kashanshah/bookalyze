"use server";

import { getProduct, saveProductReorder, saveReorderSettings } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";
import { isOrgAdmin } from "@/server/org";

export type ReorderActionResult =
  | { ok: true }
  | { ok: false; message: string; errors?: Record<string, string> };

const path = (slug: string) => `/o/${slug}/inventory/reorder`;

function issues(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

const days = (label: string, min: number) =>
  z.coerce
    .number({ error: `Enter ${label} in days.` })
    .int(`Enter ${label} as a whole number of days.`)
    .min(
      min,
      `${label[0]?.toUpperCase()}${label.slice(1)} is at least ${min} day${min === 1 ? "" : "s"}.`,
    )
    .max(730, "That's more than two years. Enter up to 730 days.");

const settingsSchema = z.object({
  leadTimeDays: days("the lead time", 0),
  coverDays: days("how long an order should last", 1),
});

/** The company's lead time and how many days each order should cover. */
export async function saveReorderSettingsAction(
  slug: string,
  input: unknown,
): Promise<ReorderActionResult> {
  const ctx = await getInventoryContext(slug, "inventory.reorder");
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can change this." };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", errors: issues(parsed.error) };
  }
  await inOrg(ctx, async (tx) => {
    await saveReorderSettings(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      ...parsed.data,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "reorder.settings_saved",
      entityType: "organization",
      entityId: ctx.org.id,
      after: parsed.data,
    });
  });
  revalidatePath(path(slug));
  return { ok: true };
}

/** Blank is "none" (or, for lead time, the company's). */
const optionalWhole = (message: string, min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.coerce.number({ error: message }).int(message).min(min, message).max(max, message).nullable(),
  );

const productSchema = z.object({
  productId: z.uuid(),
  leadTimeDays: optionalWhole("Enter whole days from 0 to 730, or leave it blank.", 0, 730),
  minimumOrder: optionalWhole("Enter a whole number of units, or leave it blank.", 1, 10_000_000),
  casePack: optionalWhole("Enter a whole number of units, or leave it blank.", 1, 100_000),
});

/** A product's own lead time, minimum order and case pack. */
export async function saveProductReorderAction(
  slug: string,
  input: unknown,
): Promise<ReorderActionResult> {
  const ctx = await getInventoryContext(slug, "inventory.reorder");
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", errors: issues(parsed.error) };
  }
  const saved = await inOrg(ctx, async (tx) => {
    const before = await getProduct(tx, parsed.data.productId);
    if (!before) return false;
    await saveProductReorder(tx, parsed.data);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "product.reorder_saved",
      entityType: "product",
      entityId: parsed.data.productId,
      after: {
        leadTimeDays: parsed.data.leadTimeDays,
        minimumOrder: parsed.data.minimumOrder,
        casePack: parsed.data.casePack,
      },
    });
    return true;
  });
  if (!saved) return { ok: false, message: "This product no longer exists." };
  revalidatePath(path(slug));
  return { ok: true };
}

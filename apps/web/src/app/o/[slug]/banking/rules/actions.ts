"use server";

import { parseDecimal, RULE_DIRECTIONS } from "@bookalyze/core";
import {
  applyRuleToExisting,
  countRuleMatches,
  createRule,
  deleteRule,
  moveRule,
  RuleError,
  updateRule,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getBankingContext, inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";

export type RuleResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string; errors?: Record<string, string> };

const amount = z
  .string()
  .trim()
  .transform((v) => v.replace(/[,$\s]/g, ""))
  .refine((v) => v === "" || /^\d{1,15}(\.\d{1,4})?$/.test(v), "Enter an amount like 50 or 49.99.")
  .transform((v) => (v === "" ? null : v));

const ruleSchema = z
  .object({
    matchText: z
      .string()
      .trim()
      .min(2, "Enter at least 2 characters the description contains.")
      .max(200),
    direction: z.enum(RULE_DIRECTIONS),
    amountMin: amount,
    amountMax: amount,
    accountId: z
      .string()
      .uuid()
      .or(z.literal(""))
      .transform((v) => v || null),
    categoryAccountId: z.string().uuid("Choose a category."),
    contactId: z
      .string()
      .uuid()
      .or(z.literal(""))
      .transform((v) => v || null),
    isActive: z.boolean(),
  })
  .refine(
    (r) => !r.amountMin || !r.amountMax || parseDecimal(r.amountMin) <= parseDecimal(r.amountMax),
    {
      message: "The lowest amount is above the highest.",
      path: ["amountMax"],
    },
  );
export type RuleFormInput = z.input<typeof ruleSchema>;

function fieldErrors(error: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

const revalidate = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

/** Creates or updates a rule. */
export async function saveRuleAction(
  slug: string,
  ruleId: string | null,
  input: RuleFormInput,
): Promise<RuleResult<{ id: string }>> {
  const ctx = await getBankingContext(slug);
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the rule.", errors: fieldErrors(parsed.error) };
  }
  if (ruleId && !z.string().uuid().safeParse(ruleId).success) {
    return { ok: false, message: "Unknown rule." };
  }
  try {
    const row = await inOrg(ctx, async (tx) => {
      const saved = ruleId
        ? await updateRule(tx, ruleId, parsed.data)
        : await createRule(tx, {
            ...parsed.data,
            orgId: ctx.org.id,
            userId: ctx.session.user.id,
          });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: ruleId ? "rule.updated" : "rule.created",
        entityType: "bank_rule",
        entityId: saved.id,
        after: saved,
      });
      return saved;
    });
    revalidate(slug);
    return { ok: true, id: row.id };
  } catch (error) {
    if (error instanceof RuleError) return { ok: false, message: error.message };
    throw error;
  }
}

/** How many uncategorized transactions a rule being written would categorize. */
export async function countMatchesAction(
  slug: string,
  input: RuleFormInput,
): Promise<{ ok: true; count: number } | { ok: false }> {
  const ctx = await getBankingContext(slug);
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const count = await inOrg(ctx, (tx) => countRuleMatches(tx, parsed.data));
  return { ok: true, count };
}

/** Categorizes the uncategorized transactions a saved rule matches. */
export async function applyRuleAction(
  slug: string,
  ruleId: string,
): Promise<RuleResult<{ categorized: number; skipped: number }>> {
  const ctx = await getBankingContext(slug);
  if (!z.string().uuid().safeParse(ruleId).success) return { ok: false, message: "Unknown rule." };
  try {
    const result = await inOrg(ctx, async (tx) => {
      const done = await applyRuleToExisting(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        ruleId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "rule.applied",
        entityType: "bank_rule",
        entityId: ruleId,
        after: done,
      });
      return done;
    });
    revalidate(slug);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof RuleError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function moveRuleAction(
  slug: string,
  ruleId: string,
  direction: "up" | "down",
): Promise<RuleResult> {
  const ctx = await getBankingContext(slug);
  if (!z.string().uuid().safeParse(ruleId).success) return { ok: false, message: "Unknown rule." };
  await inOrg(ctx, (tx) => moveRule(tx, ruleId, direction === "up" ? "up" : "down"));
  revalidate(slug);
  return { ok: true };
}

export async function deleteRuleAction(slug: string, ruleId: string): Promise<RuleResult> {
  const ctx = await getBankingContext(slug);
  if (!z.string().uuid().safeParse(ruleId).success) return { ok: false, message: "Unknown rule." };
  await inOrg(ctx, async (tx) => {
    await deleteRule(tx, ruleId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "rule.deleted",
      entityType: "bank_rule",
      entityId: ruleId,
    });
  });
  revalidate(slug);
  return { ok: true };
}

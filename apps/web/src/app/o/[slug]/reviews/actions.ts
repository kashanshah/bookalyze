"use server";

import {
  REVIEW_DELAY_MAX,
  REVIEW_DELAY_MIN,
  REVIEW_FULFILLMENT,
  type ReviewSettings,
} from "@bookalyze/core";
import {
  clearReviewRequests,
  getReviewSettings,
  recordReviewOutcome,
  reviewTargets,
  saveReviewSettings,
  schema,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getReviewsContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import {
  type AskResult,
  askForReviews,
  checkOrderEligibility,
  planOrgReviewRequests,
} from "@/server/reviews";

export type ReviewResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string; errors?: Record<string, string> };

const DENIED = { ok: false, message: "Only owners and admins can send review requests." } as const;
const orderIds = z.array(z.uuid()).min(1).max(100);

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/reviews`, "layout");
  revalidatePath(`/o/${slug}/commerce/orders`, "layout");
}

async function adminContext(slug: string) {
  const ctx = await getReviewsContext(slug);
  return { ctx, denied: isOrgAdmin(ctx) ? null : DENIED };
}

const askSchema = z.union([
  z.object({ orderIds, bulk: z.boolean().optional() }),
  z.object({ all: z.literal(true), channelId: z.uuid().nullable() }),
]);

/**
 * Sends Amazon's "Request a Review" now, for the given orders or (with `all`) for orders whose
 * window is open. Amazon allows about one a second, so a call handles what fits in ~45 seconds:
 * call again while `more` is true.
 */
export async function askReviewsAction(
  slug: string,
  input: z.input<typeof askSchema>,
): Promise<ReviewResult<AskResult>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose the orders to ask." };
  const who = { orgId: ctx.org.id, userId: ctx.session.user.id };
  const result = await askForReviews(
    who,
    "all" in parsed.data
      ? { all: true, channelId: parsed.data.channelId, source: "bulk" }
      : {
          orderIds: parsed.data.orderIds,
          source: parsed.data.bulk || parsed.data.orderIds.length > 1 ? "bulk" : "manual",
        },
    45_000,
  );
  if (result.sent) {
    await inOrg(ctx, (tx) =>
      audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "review_requests.sent",
        entityType: "review_request",
        after: { sent: result.sent, notEligible: result.notEligible, skipped: result.skipped },
      }),
    );
  }
  revalidate(slug);
  return { ok: true, ...result };
}

/**
 * Asks Amazon whether it takes a review request for the order now (nothing is sent), and keeps
 * the answer on the order. Anyone who can see review requests may check.
 */
export async function checkReviewEligibilityAction(
  slug: string,
  orderId: string,
): Promise<ReviewResult<{ eligible: boolean | null }>> {
  const ctx = await getReviewsContext(slug);
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const result = await checkOrderEligibility(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    orderId,
  );
  if (result.error) return { ok: false, message: result.error };
  revalidate(slug);
  return { ok: true, eligible: result.eligible };
}

/** "Don't ask": leaves the orders out of automatic and bulk requests. */
export async function skipReviewsAction(
  slug: string,
  ids: string[],
): Promise<ReviewResult<{ count: number }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = orderIds.safeParse(ids);
  if (!parsed.success) return { ok: false, message: "Choose the orders to leave out." };
  const count = await inOrg(ctx, async (tx) => {
    let n = 0;
    for (const target of await reviewTargets(tx, parsed.data)) {
      const saved = await recordReviewOutcome(tx, {
        orgId: ctx.org.id,
        orderId: target.orderId,
        source: "manual",
        status: "skipped",
        reason: "You chose not to ask",
        userId: ctx.session.user.id,
      });
      if (saved) n++;
    }
    return n;
  });
  revalidate(slug);
  return { ok: true, count };
}

/** Puts orders back among those to ask (undoes "Don't ask", or after a failure). */
export async function restoreReviewsAction(
  slug: string,
  ids: string[],
): Promise<ReviewResult<{ count: number }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = orderIds.safeParse(ids);
  if (!parsed.success) return { ok: false, message: "Choose the orders to put back." };
  const count = await inOrg(ctx, (tx) => clearReviewRequests(tx, parsed.data));
  revalidate(slug);
  return { ok: true, count };
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  daysAfterDelivery: z
    .number()
    .int()
    .min(REVIEW_DELAY_MIN, `Amazon takes requests from ${REVIEW_DELAY_MIN} days after delivery.`)
    .max(REVIEW_DELAY_MAX, `Choose ${REVIEW_DELAY_MAX} days or fewer, so there's time to retry.`),
  sendHour: z.number().int().min(0).max(23),
  sendDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Choose at least one day.")
    .transform((days) => [...new Set(days)].sort()),
  channelIds: z.array(z.uuid()).min(1, "Choose at least one marketplace.").nullable(),
  fulfillment: z.enum(REVIEW_FULFILLMENT),
  skipRefunded: z.boolean(),
  skipReplacements: z.boolean(),
  skipBusiness: z.boolean(),
  skipPromotions: z.boolean(),
  excludedSkus: z
    .array(z.string().trim().min(1).max(100))
    .max(200)
    .transform((skus) => [...new Set(skus)]),
  startsFrom: z.string().refine(isIsoDate).nullable(),
}) satisfies z.ZodType<ReviewSettings, unknown>;

/** Saves the automatic request settings, then plans requests under them straight away. */
export async function saveReviewSettingsAction(
  slug: string,
  input: ReviewSettings,
): Promise<ReviewResult<{ planned: number }>> {
  const ctx = await getReviewsContext(slug);
  if (!isOrgAdmin(ctx)) {
    return { ok: false, message: "Only owners and admins can change automatic requests." };
  }
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      errors[key] ??= issue.message;
    }
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  const settings = parsed.data;
  const saved = await inOrg(ctx, async (tx) => {
    if (settings.channelIds) {
      const mine = new Set((await tx.select().from(schema.salesChannels)).map((c) => c.id));
      if (settings.channelIds.some((id) => !mine.has(id))) return false;
    }
    const before = await getReviewSettings(tx);
    await saveReviewSettings(tx, { orgId: ctx.org.id, userId: ctx.session.user.id, settings });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "review_settings.updated",
      entityType: "review_settings",
      before,
      after: settings,
    });
    return true;
  });
  if (!saved) return { ok: false, message: "Choose marketplaces from the list." };
  const planned = settings.enabled
    ? await planOrgReviewRequests({ orgId: ctx.org.id, userId: ctx.session.user.id }, 20_000)
    : 0;
  revalidate(slug);
  return { ok: true, planned };
}

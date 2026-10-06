"use server";

import { can } from "@bookalyze/core";
import { saveSettlement, settlementChannel } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inOrg } from "@/server/accounting";
import { type SettlementSyncResult, syncOrgSettlements } from "@/server/amazon-settlements";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";

export type SettlementResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function settlementsContext(slug: string) {
  const ctx = await getCommerceContext(slug);
  const allowed = can(ctx.plan, ctx.enabledModules, "commerce.settlements");
  return { ctx, allowed };
}

/**
 * Brings in new settlement reports from Amazon, for up to ~40 seconds. `more` says to call again
 * (Amazon lets a report list through about once a minute, so a first look can take a few calls).
 */
export async function syncSettlementsAction(
  slug: string,
): Promise<SettlementResult<SettlementSyncResult>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  const result = await syncOrgSettlements(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    40_000,
  );
  if (!result.connections) {
    return { ok: false, message: "Connect Amazon Seller Central on the Channels page first." };
  }
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  const { connections: _, ...rest } = result;
  return { ok: true, ...rest };
}

const amount = z.string().regex(/^-?\d+(\.\d{1,4})?$/);
/** A settlement read in the browser from the flat file (core `parseSettlementReport`). */
const settlementSchema = z.object({
  settlementId: z.string().trim().min(1).max(100),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  depositDate: z.iso.date().nullable(),
  total: amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  marketplace: z.string().max(100).nullable(),
  orderCount: z.number().int().min(0),
  balanced: z.boolean(),
  lines: z
    .array(
      z.object({
        transactionType: z.string().max(200),
        amountType: z.string().max(200),
        amountDescription: z.string().max(200),
        amount,
        count: z.number().int().min(0),
      }),
    )
    .max(2_000),
});

/**
 * Adds a settlement from Amazon's flat file (Seller Central → Payments → All statements →
 * “Flat File V2”), read in the browser: for periods the Reports API no longer lists.
 */
export async function uploadSettlementAction(
  slug: string,
  input: z.input<typeof settlementSchema>,
): Promise<SettlementResult<{ id: string; created: boolean }>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx))
    return { ok: false, message: "Only owners and admins can add settlements." };
  const parsed = settlementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That settlement couldn't be read." };
  const settlement = parsed.data;
  const saved = await inOrg(ctx, async (tx) => {
    const channelId = await settlementChannel(tx, {
      connectionId: null,
      marketplace: settlement.marketplace,
      currency: settlement.currency,
    });
    const row = await saveSettlement(tx, {
      orgId: ctx.org.id,
      connectionId: null,
      channelId,
      reportId: null,
      source: "upload",
      settlement,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "settlements.uploaded",
      entityType: "settlement",
      entityId: row.id,
      after: { settlementId: settlement.settlementId, total: settlement.total },
    });
    return row;
  });
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  return { ok: true, ...saved };
}

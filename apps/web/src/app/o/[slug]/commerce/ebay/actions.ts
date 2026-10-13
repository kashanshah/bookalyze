"use server";

import { can } from "@bookalyze/core";
import { revalidatePath } from "next/cache";
import { nowIn } from "@/lib/dates";
import { getCommerceContext } from "@/server/commerce";
import { type EbayMoneyResult, syncEbayTransactions } from "@/server/ebay-finances";
import { logError } from "@/server/log";
import { isOrgAdmin } from "@/server/org";

export type EbayResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * Brings in eBay's money rows through the Finances API for up to ~25 seconds: a year back, a
 * month at a time. `more` says to call again.
 */
export async function syncEbayMoneyAction(slug: string): Promise<EbayResult<EbayMoneyResult>> {
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) {
    return { ok: false, message: "Payouts aren't part of this company's plan." };
  }
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  try {
    const result = await syncEbayTransactions(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      nowIn(ctx.profile.timezone).date,
      25_000,
    );
    if (!result) return { ok: false, message: "Connect eBay on an eBay site's page first." };
    revalidatePath(`/o/${slug}/commerce/ebay`);
    return { ok: true, ...result };
  } catch (error) {
    logError("ebay.transactions_sync_failed", error, { orgId: ctx.org.id });
    return { ok: false, message: "eBay's payments couldn't be brought in. Try again in a minute." };
  }
}

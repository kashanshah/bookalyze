"use server";

import { can } from "@bookalyze/core";
import { channelCostCategories, saveChannelCostAccounts, schema } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";

export type ProfitResult = { ok: true } | { ok: false; message: string };

const costsSchema = z.object({
  choices: z
    .array(z.object({ accountId: z.uuid(), channel: z.union([z.uuid(), z.literal("shared")]) }))
    .max(500),
});

/** Saves which expense categories Channel profit counts, and against which channel. */
export async function saveChannelCostsAction(
  slug: string,
  input: z.input<typeof costsSchema>,
): Promise<ProfitResult> {
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) {
    return { ok: false, message: "Channel profit isn't part of this company's plan." };
  }
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  const parsed = costsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the categories and channels." };
  const saved = await inOrg(ctx, async (tx) => {
    const categories = new Set((await channelCostCategories(tx)).map((c) => c.accountId));
    const channels = new Set(
      (await tx.select({ id: schema.salesChannels.id }).from(schema.salesChannels)).map(
        (c) => c.id,
      ),
    );
    const choices = parsed.data.choices.map((c) => ({
      accountId: c.accountId,
      channelId: c.channel === "shared" ? null : c.channel,
    }));
    if (
      choices.some(
        (c) => !categories.has(c.accountId) || (c.channelId !== null && !channels.has(c.channelId)),
      )
    ) {
      return false;
    }
    await saveChannelCostAccounts(tx, { orgId: ctx.org.id, userId: ctx.session.user.id, choices });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "commerce.channel_costs_updated",
      entityType: "organization",
      entityId: ctx.org.id,
      after: { choices },
    });
    return true;
  });
  if (!saved) return { ok: false, message: "Choose categories and channels from the lists." };
  revalidatePath(`/o/${slug}/commerce/profit`, "layout");
  return { ok: true };
}

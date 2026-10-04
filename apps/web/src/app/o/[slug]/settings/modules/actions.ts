"use server";

import { isModuleKey, toggleModule } from "@bookalyze/core";
import { getDb, schema, withOrg } from "@bookalyze/db";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/server/audit";
import { getOrgContext, isOrgAdmin } from "@/server/org";

export type ModuleToggleResult = { ok: true } | { ok: false; message: string };

export async function setModuleEnabledAction(
  slug: string,
  key: string,
  enabled: boolean,
): Promise<ModuleToggleResult> {
  const ctx = await getOrgContext(slug);
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can change modules." };
  if (!isModuleKey(key)) return { ok: false, message: "Unknown module." };

  const result = toggleModule(ctx.enabledModules, key, enabled, ctx.plan.modules);
  if (!result.ok) return { ok: false, message: result.reason };

  await withOrg(getDb(), { orgId: ctx.org.id, userId: ctx.session.user.id }, async (tx) => {
    await tx
      .insert(schema.organizationModules)
      .values({
        organizationId: ctx.org.id,
        moduleKey: key,
        enabled,
        updatedBy: ctx.session.user.id,
      })
      .onConflictDoUpdate({
        target: [schema.organizationModules.organizationId, schema.organizationModules.moduleKey],
        set: { enabled, updatedBy: ctx.session.user.id, updatedAt: sql`now()` },
      });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: enabled ? "module.enabled" : "module.disabled",
      entityType: "module",
      entityId: key,
    });
  });
  revalidatePath(`/o/${slug}`, "layout");
  return { ok: true };
}

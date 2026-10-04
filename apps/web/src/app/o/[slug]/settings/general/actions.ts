"use server";

import { getDb, schema, withOrg } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { type FieldErrors, fieldErrors, orgProfileSchema } from "@/lib/validation/org-profile";
import { audit } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { getOrgContext, isOrgAdmin } from "@/server/org";
import { profileValues } from "@/server/organizations";

export type ProfileState = { errors?: FieldErrors; message?: string; saved?: boolean };

export async function updateProfileAction(
  slug: string,
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const ctx = await getOrgContext(slug);
  if (!isOrgAdmin(ctx))
    return { message: "Only owners and admins can change organization settings." };

  const raw = Object.fromEntries(formData);
  const name = z.string().trim().min(2, "Enter a name").max(100).safeParse(raw.name);
  const parsed = orgProfileSchema.safeParse(raw);
  if (!name.success || !parsed.success) {
    return {
      errors: {
        ...(name.success ? {} : { name: name.error.issues[0]?.message }),
        ...(parsed.success ? {} : fieldErrors(parsed.error)),
      },
    };
  }

  const values = profileValues(parsed.data);
  const result = await withOrg(
    getDb(),
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    async (tx) => {
      if (ctx.profile && ctx.profile.baseCurrency !== values.baseCurrency) {
        const [entry] = await tx
          .select({ id: schema.journalEntries.id })
          .from(schema.journalEntries)
          .limit(1);
        if (entry) {
          return {
            errors: {
              baseCurrency: "The main currency can't change once you have journal entries.",
            },
          };
        }
      }
      if (ctx.profile) {
        await tx.update(schema.organizationProfiles).set(values);
      } else {
        await tx
          .insert(schema.organizationProfiles)
          .values({ organizationId: ctx.org.id, ...values });
      }
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "organization.profile_updated",
        entityType: "organization_profile",
        entityId: ctx.org.id,
        before: { name: ctx.org.name, ...ctx.profile },
        after: { name: name.data, ...values },
      });
      return null;
    },
  );
  if (result) return result;
  if (name.data !== ctx.org.name) {
    await getAuth().api.updateOrganization({
      body: { organizationId: ctx.org.id, data: { name: name.data } },
      headers: await headers(),
    });
  }
  revalidatePath(`/o/${slug}`, "layout");
  return { saved: true };
}

"use server";

import { getContact, schema } from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ContactInput, contactSchema } from "@/lib/validation/accounting";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";

export type ContactResult =
  | { ok: true; data: { id: string; name: string; type: "customer" | "vendor" | "both" } }
  | { ok: false; message?: string; errors?: Record<string, string> };

function pgCode(error: unknown): string | undefined {
  return (error as { cause?: { code?: string } })?.cause?.code;
}

/** Creates or updates a customer or vendor. */
export async function saveContactAction(slug: string, input: ContactInput): Promise<ContactResult> {
  const ctx = await getAccountingContext(slug);
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[issue.path.join(".") || "form"] ??= issue.message;
    return { ok: false, errors };
  }
  const { id, ...values } = parsed.data;
  try {
    const row = await inOrg(ctx, async (tx) => {
      if (id) {
        const before = await getContact(tx, id);
        if (!before) return null;
        const [updated] = await tx
          .update(schema.contacts)
          .set(values)
          .where(eq(schema.contacts.id, id))
          .returning();
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "contact.updated",
          entityType: "contact",
          entityId: id,
          before,
          after: updated,
        });
        return updated ?? null;
      }
      const [created] = await tx
        .insert(schema.contacts)
        .values({ ...values, organizationId: ctx.org.id, createdBy: ctx.session.user.id })
        .returning();
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "contact.created",
        entityType: "contact",
        entityId: created?.id,
        after: created,
      });
      return created ?? null;
    });
    if (!row) return { ok: false, message: "This contact no longer exists." };
    revalidatePath(`/o/${slug}/accounting`, "layout");
    return { ok: true, data: { id: row.id, name: row.name, type: row.type } };
  } catch (error) {
    if (pgCode(error) === "23505") {
      return {
        ok: false,
        errors: {
          name: `You already have a ${values.type === "vendor" ? "vendor" : "customer"} with this name.`,
        },
      };
    }
    throw error;
  }
}

export async function setContactArchivedAction(
  slug: string,
  id: string,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await getAccountingContext(slug);
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Something went wrong." };
  await inOrg(ctx, async (tx) => {
    await tx
      .update(schema.contacts)
      .set({ isArchived: archived })
      .where(eq(schema.contacts.id, id));
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: archived ? "contact.archived" : "contact.restored",
      entityType: "contact",
      entityId: id,
    });
  });
  revalidatePath(`/o/${slug}/accounting`, "layout");
  return { ok: true };
}

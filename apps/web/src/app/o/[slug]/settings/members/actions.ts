"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/server/auth";
import { getOrgContext, isOrgAdmin } from "@/server/org";

export type InviteState = { error?: string; invited?: string };

const inviteSchema = z.object({
  email: z.email("Enter a valid email address").transform((e) => e.toLowerCase()),
  role: z.enum(["admin", "member"]),
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function inviteMemberAction(
  slug: string,
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const ctx = await getOrgContext(slug);
  if (!isOrgAdmin(ctx)) return { error: "Only owners and admins can invite members." };
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    await getAuth().api.createInvitation({
      body: { email: parsed.data.email, role: parsed.data.role, organizationId: ctx.org.id },
      headers: await headers(),
    });
  } catch (error) {
    return { error: errorMessage(error, "Could not send the invitation.") };
  }
  revalidatePath(`/o/${slug}/settings/members`);
  return { invited: parsed.data.email };
}

export async function cancelInvitationAction(slug: string, invitationId: string) {
  const ctx = await getOrgContext(slug);
  if (!isOrgAdmin(ctx)) return;
  await getAuth().api.cancelInvitation({ body: { invitationId }, headers: await headers() });
  revalidatePath(`/o/${slug}/settings/members`);
}

export async function removeMemberAction(slug: string, memberId: string) {
  const ctx = await getOrgContext(slug);
  if (!isOrgAdmin(ctx)) return;
  await getAuth().api.removeMember({
    body: { memberIdOrEmail: memberId, organizationId: ctx.org.id },
    headers: await headers(),
  });
  revalidatePath(`/o/${slug}/settings/members`);
}

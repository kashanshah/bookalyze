"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { type FieldErrors, fieldErrors, orgProfileSchema } from "@/lib/validation/org-profile";
import { createOrganization } from "@/server/organizations";
import { requireSession } from "@/server/session";

export type CreateOrgState = { errors?: FieldErrors; message?: string };

const nameSchema = z.string().trim().min(2, "Enter a name for this organization").max(100);

export async function createOrganizationAction(
  _prev: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const session = await requireSession();
  const raw = Object.fromEntries(formData);
  const name = nameSchema.safeParse(raw.name);
  const profile = orgProfileSchema.safeParse(raw);
  if (!name.success || !profile.success) {
    return {
      errors: {
        ...(name.success ? {} : { name: name.error.issues[0]?.message }),
        ...(profile.success ? {} : fieldErrors(profile.error)),
      },
    };
  }
  let slug: string;
  try {
    ({ slug } = await createOrganization(session.user.id, name.data, profile.data));
  } catch (error) {
    console.error(error);
    return { message: "Something went wrong creating the organization. Please try again." };
  }
  redirect(`/o/${slug}`);
}

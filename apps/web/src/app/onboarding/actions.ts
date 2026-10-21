"use server";

import { TRIAL_DAYS } from "@bookalyze/core";
import { getDb, requireBillingCard, withBillingWriter } from "@bookalyze/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type FieldErrors, fieldErrors, orgProfileSchema } from "@/lib/validation/org-profile";
import { logError } from "@/server/log";
import { listUserOrgs } from "@/server/org";
import { createOrganization } from "@/server/organizations";
import { requireSession } from "@/server/session";
import { stripeConfigured } from "@/server/stripe";

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
  // Sign-up takes a card (when payments are set up): an owner's first company gets 30 days free,
  // further companies are charged from the start.
  const cardAtSignUp = stripeConfigured();
  const ownsOne = cardAtSignUp
    ? (await listUserOrgs(session.user.id)).some((o) => o.role === "owner")
    : false;
  let slug: string;
  try {
    const org = await createOrganization(session.user.id, name.data, profile.data);
    slug = org.slug;
    if (cardAtSignUp) {
      await withBillingWriter(getDb(), { orgId: org.id }, (tx) =>
        requireBillingCard(tx, { orgId: org.id, trialDays: ownsOne ? 0 : TRIAL_DAYS }),
      );
    }
  } catch (error) {
    logError("onboarding.create_company_failed", error, { userId: session.user.id });
    return { message: "Something went wrong creating the organization. Please try again." };
  }
  redirect(cardAtSignUp ? `/start/${slug}` : `/o/${slug}`);
}

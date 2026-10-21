"use server";

import { firstChargeOn, PACKAGE_KEYS, priceLookupKey, signupTrialDays } from "@bookalyze/core";
import { getDb, saveBillingCustomer, withBillingWriter } from "@bookalyze/db";
import { z } from "zod";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { getOrgContext } from "@/server/org";
import {
  createCheckoutSession,
  createCustomer,
  createPortalSession,
  pricesByLookupKey,
  StripeError,
  stripeConfigured,
} from "@/server/stripe";

export type BillingResult = { ok: true; url: string } | { ok: false; message: string };

const selection = z.object({
  package: z.enum(PACKAGE_KEYS as [string, ...string[]]),
  interval: z.enum(["month", "year"]),
});

async function ownerContext(slug: string) {
  const ctx = await getOrgContext(slug);
  if (ctx.role !== "owner") return { ctx, denied: "Only owners can change the plan." };
  if (!stripeConfigured()) return { ctx, denied: "Billing isn't set up yet." };
  return { ctx, denied: null };
}

/** Starts Stripe Checkout for a package; returns where to send the browser. */
export async function startCheckoutAction(slug: string, input: unknown): Promise<BillingResult> {
  const { ctx, denied } = await ownerContext(slug);
  if (denied) return { ok: false, message: denied };
  const parsed = selection.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a plan first." };
  const choice = parsed.data as {
    package: (typeof PACKAGE_KEYS)[number];
    interval: "month" | "year";
  };
  const active = ctx.billing.state.subscription;
  if (active && !["canceled", "incomplete_expired"].includes(active.status)) {
    return { ok: false, message: "You already have a plan. Use Manage billing to change it." };
  }
  try {
    // One package per subscription, so Stripe's customer portal can switch between them.
    const lookups = [priceLookupKey(choice.package, choice.interval)];
    const prices = await pricesByLookupKey(lookups);
    const missing = lookups.filter((l) => !prices.has(l));
    if (missing.length) {
      return { ok: false, message: `Stripe has no price for ${missing.join(", ")} yet.` };
    }
    let customerId = ctx.billing.state.account?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await createCustomer({
        name: ctx.profile?.legalName ?? ctx.org.name,
        email: ctx.session.user.email,
        orgId: ctx.org.id,
      });
      customerId = customer.id;
      await withBillingWriter(getDb(), { orgId: ctx.org.id }, async (tx) => {
        await saveBillingCustomer(tx, { orgId: ctx.org.id, stripeCustomerId: customer.id });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "billing.customer_created",
          entityType: "billing_account",
        });
      });
    }
    const atSignUp = ctx.billing.entitlement.mode === "needs_card";
    const base = atSignUp
      ? `${env().BETTER_AUTH_URL}/start/${slug}`
      : `${env().BETTER_AUTH_URL}/o/${slug}/settings/billing`;
    let trialEnd: number | null;
    if (ctx.billing.state.account?.cardRequired) {
      // A card at sign-up: the trial runs from today (30 days for an owner's first company).
      const days = signupTrialDays(ctx.billing.state.account, ctx.billing.state.subscription);
      trialEnd = days ? Math.floor(Date.now() / 1000) + days * 86_400 : null;
    } else {
      // Chosen during early access or the free trial: nothing is charged until the trial is over.
      const chargeOn = firstChargeOn(ctx.billing.entitlement, ctx.billing.companyCreatedOn);
      trialEnd = chargeOn ? Math.floor(new Date(`${chargeOn}T00:00:00Z`).getTime() / 1000) : null;
    }
    const session = await createCheckoutSession({
      customerId,
      orgId: ctx.org.id,
      // Stripe wants a trial to end at least two days ahead.
      trialEnd: trialEnd && trialEnd > Date.now() / 1000 + 2 * 86_400 ? trialEnd : null,
      priceIds: lookups.map((l) => prices.get(l)?.id ?? ""),
      successUrl: `${base}?checkout=done`,
      cancelUrl: `${base}?checkout=cancelled`,
    });
    return { ok: true, url: session.url };
  } catch (error) {
    if (error instanceof StripeError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Stripe's customer portal: card, invoices, change plan, cancel. */
export async function openPortalAction(slug: string): Promise<BillingResult> {
  const { ctx, denied } = await ownerContext(slug);
  if (denied) return { ok: false, message: denied };
  const customerId = ctx.billing.state.account?.stripeCustomerId;
  if (!customerId)
    return { ok: false, message: "There's no billing account yet. Choose a plan first." };
  try {
    const session = await createPortalSession({
      customerId,
      returnUrl: `${env().BETTER_AUTH_URL}/o/${slug}/settings/billing`,
    });
    return { ok: true, url: session.url };
  } catch (error) {
    if (error instanceof StripeError) return { ok: false, message: error.message };
    throw error;
  }
}

import { eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "./client";
import { billingAccounts, subscriptionItems, subscriptions } from "./schema/billing";

/**
 * Billing rows. Reads run in `withOrg()`; writes only in `withBillingWriter()` (the row-level
 * security policies refuse them anywhere else).
 */

export async function getBilling(tx: Transaction) {
  const [account] = await tx.select().from(billingAccounts).limit(1);
  const [subscription] = await tx.select().from(subscriptions).limit(1);
  const items = subscription
    ? await tx.select().from(subscriptionItems).orderBy(subscriptionItems.itemKey)
    : [];
  return { account: account ?? null, subscription: subscription ?? null, items };
}

export type BillingState = Awaited<ReturnType<typeof getBilling>>;

/** Records the company's Stripe customer (once; the same customer again changes nothing). */
export async function saveBillingCustomer(
  tx: Transaction,
  input: { orgId: string; stripeCustomerId: string },
) {
  await tx
    .insert(billingAccounts)
    .values({ organizationId: input.orgId, stripeCustomerId: input.stripeCustomerId })
    .onConflictDoUpdate({
      target: billingAccounts.organizationId,
      set: { stripeCustomerId: input.stripeCustomerId },
    });
}

/** The company a Stripe customer belongs to, or null. Outside any tenant (the webhook). */
export async function billingOrgForCustomer(db: Database, customerId: string) {
  const result = await db.execute<{ org: string | null }>(
    sql`select billing_org_for_customer(${customerId}) as org`,
  );
  return result.rows[0]?.org ?? null;
}

export type SubscriptionUpdate = {
  orgId: string;
  stripeSubscriptionId: string;
  status: string;
  interval: "month" | "year";
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  items: { itemKey: string; stripeItemId: string; stripePriceId: string }[];
  /** When Stripe made this change (the event's `created`). */
  at: Date;
};

/**
 * Applies the subscription as Stripe reports it: its status and exactly these items. An event
 * older than the last one applied changes nothing ("stale"), since Stripe doesn't promise order.
 */
export async function applySubscription(
  tx: Transaction,
  input: SubscriptionUpdate,
): Promise<"applied" | "stale"> {
  const [current] = await tx.select().from(subscriptions).limit(1).for("update");
  if (current && current.stripeUpdatedAt > input.at) return "stale";
  const values = {
    stripeSubscriptionId: input.stripeSubscriptionId,
    status: input.status,
    interval: input.interval,
    currentPeriodEnd: input.currentPeriodEnd,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    stripeUpdatedAt: input.at,
    // A subscription that's paid up again has no failed payment.
    ...(input.status === "active" || input.status === "trialing" ? { paymentFailedAt: null } : {}),
  };
  await tx
    .insert(subscriptions)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: subscriptions.organizationId, set: values });
  await tx.delete(subscriptionItems).where(eq(subscriptionItems.organizationId, input.orgId));
  if (input.items.length) {
    await tx
      .insert(subscriptionItems)
      .values(input.items.map((item) => ({ organizationId: input.orgId, ...item })));
  }
  return "applied";
}

/**
 * A payment failed, or went through (null). The grace period counts from the first failure, so a
 * retry that fails again doesn't extend it.
 */
export async function setPaymentFailed(tx: Transaction, failedAt: Date | null) {
  await tx
    .update(subscriptions)
    .set({
      paymentFailedAt: failedAt
        ? sql`coalesce(${subscriptions.paymentFailedAt}, ${failedAt.toISOString()}::timestamptz)`
        : null,
    })
    .where(sql`true`);
}

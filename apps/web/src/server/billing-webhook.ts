import "server-only";
import { parseLookupKey } from "@bookalyze/core";
import {
  applySubscription,
  billingOrgForCustomer,
  getDb,
  setPaymentFailed,
  withBillingWriter,
} from "@bookalyze/db";
import { audit } from "./audit";
import { logInfo, logWarn } from "./log";
import { getSubscription, type StripeSubscription } from "./stripe";

type StripeEvent = {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: Record<string, unknown> };
};

export type WebhookResult = "applied" | "stale" | "ignored";

/** The company a subscription belongs to: its metadata, checked against its customer. */
async function orgFor(customer: string | null, metadataOrg: string | undefined) {
  const byCustomer = customer ? await billingOrgForCustomer(getDb(), customer) : null;
  if (byCustomer && metadataOrg && byCustomer !== metadataOrg) {
    logWarn("billing.org_mismatch", { customer });
    return null;
  }
  return byCustomer ?? null;
}

async function apply(subscription: StripeSubscription, at: Date): Promise<WebhookResult> {
  const orgId = await orgFor(subscription.customer, subscription.metadata?.organization_id);
  if (!orgId) {
    logWarn("billing.unknown_customer", { subscription: subscription.id });
    return "ignored";
  }
  const items = subscription.items.data.flatMap((item) => {
    const parsed = parseLookupKey(item.price.lookup_key);
    return parsed
      ? [
          {
            itemKey: parsed.key,
            stripeItemId: item.id,
            stripePriceId: item.price.id,
            interval: parsed.interval,
          },
        ]
      : [];
  });
  const interval = items[0]?.interval ?? "month";
  const periodEnd =
    subscription.current_period_end ?? subscription.items.data[0]?.current_period_end ?? null;
  // A deleted subscription pays for nothing.
  const ended = subscription.status === "canceled" || subscription.status === "incomplete_expired";
  const result = await withBillingWriter(getDb(), { orgId }, async (tx) => {
    const applied = await applySubscription(tx, {
      orgId,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      interval,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      items: ended ? [] : items.map(({ interval: _, ...item }) => item),
      at,
    });
    if (applied === "applied") {
      await audit(tx, {
        orgId,
        actorUserId: null,
        action: "billing.subscription_updated",
        entityType: "subscription",
        after: { status: subscription.status, items: ended ? [] : items.map((i) => i.itemKey) },
      });
    }
    return applied;
  });
  logInfo("billing.subscription", { orgId, status: subscription.status, result });
  return result;
}

/**
 * One Stripe event. Subscriptions are applied as Stripe reports them (for Checkout, read fresh
 * from Stripe); a failed invoice starts the grace period and a paid one ends it.
 */
export async function handleStripeEvent(event: StripeEvent): Promise<WebhookResult> {
  const object = event.data?.object ?? {};
  const at = new Date((event.created ?? Date.now() / 1000) * 1000);
  switch (event.type) {
    case "checkout.session.completed": {
      const id = typeof object.subscription === "string" ? object.subscription : null;
      if (!id) return "ignored";
      return apply(await getSubscription(id), at);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return apply(object as unknown as StripeSubscription, at);
    case "invoice.payment_failed":
    case "invoice.paid": {
      const customer = typeof object.customer === "string" ? object.customer : null;
      const orgId = customer ? await billingOrgForCustomer(getDb(), customer) : null;
      if (!orgId) return "ignored";
      await withBillingWriter(getDb(), { orgId }, (tx) =>
        setPaymentFailed(tx, event.type === "invoice.payment_failed" ? at : null),
      );
      logInfo("billing.invoice", { orgId, type: event.type });
      return "applied";
    }
    default:
      return "ignored";
  }
}

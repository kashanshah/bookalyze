import { handleStripeEvent } from "@/server/billing-webhook";
import { env } from "@/server/env";
import { logError } from "@/server/log";
import { verifyStripeSignature } from "@/server/stripe";

/**
 * Stripe's webhook: the source of truth for subscriptions. Signed with STRIPE_WEBHOOK_SECRET;
 * anything unsigned is refused. 500 on a database or Stripe hiccup so Stripe retries.
 */
export async function POST(request: Request) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  const body = await request.text();
  if (!verifyStripeSignature(secret, request.headers.get("stripe-signature"), body)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const result = await handleStripeEvent(event as Parameters<typeof handleStripeEvent>[0]);
    return Response.json({ result });
  } catch (error) {
    logError("billing.webhook_failed", error);
    return new Response("Error", { status: 500 });
  }
}

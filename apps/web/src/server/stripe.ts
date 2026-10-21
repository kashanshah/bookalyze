import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { logError } from "./log";

/**
 * Stripe's REST API, the few calls billing needs (no SDK). Test mode unless the owner has set
 * STRIPE_LIVE=true; tests point STRIPE_API_URL at a stand-in.
 */

export class StripeError extends Error {}

/** The secret key, or null when billing is off (none set, or a live key without STRIPE_LIVE). */
export function stripeKey(): string | null {
  const { STRIPE_SECRET_KEY: key, STRIPE_LIVE } = env();
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key) && !STRIPE_LIVE) {
    logError(
      "stripe.live_key_refused",
      new Error("A live Stripe key is set without STRIPE_LIVE=true"),
    );
    return null;
  }
  return key;
}

export function stripeConfigured(): boolean {
  return Boolean(stripeKey());
}

/** Stripe's form encoding: nested keys as a[b][0]=c. */
export function formEncode(value: unknown, prefix = "", out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) formEncode(v, `${prefix}[${i}]`, out);
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

async function call<T>(method: "GET" | "POST", path: string, params?: unknown): Promise<T> {
  const key = stripeKey();
  if (!key) throw new StripeError("Billing isn't set up yet.");
  const base = env().STRIPE_API_URL ?? "https://api.stripe.com";
  const body = params ? formEncode(params).toString() : undefined;
  const url = method === "GET" && body ? `${base}${path}?${body}` : `${base}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    logError("stripe.unreachable", error, { path });
    throw new StripeError("Stripe couldn't be reached. Try again in a minute.");
  });
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string; type?: string } })
    | null;
  if (!response.ok || !json) {
    logError("stripe.failed", new Error(json?.error?.message ?? `HTTP ${response.status}`), {
      path,
      status: response.status,
      stripeError: json?.error?.type,
    });
    throw new StripeError("Stripe didn't accept that. Try again, or contact support.");
  }
  return json;
}

export type StripePrice = { id: string; lookup_key: string | null; unit_amount: number | null };

/** Prices by lookup key ("seller_month"…), as set up in Stripe's dashboard. */
export async function pricesByLookupKey(keys: string[]): Promise<Map<string, StripePrice>> {
  const result = await call<{ data: StripePrice[] }>("GET", "/v1/prices", {
    lookup_keys: keys,
    active: true,
    limit: 20,
  });
  return new Map(result.data.filter((p) => p.lookup_key).map((p) => [p.lookup_key as string, p]));
}

export async function createCustomer(input: { name: string; email: string; orgId: string }) {
  return call<{ id: string }>("POST", "/v1/customers", {
    name: input.name,
    email: input.email,
    metadata: { organization_id: input.orgId },
  });
}

export async function createCheckoutSession(input: {
  customerId: string;
  orgId: string;
  priceIds: string[];
  /** Unix seconds: no charge before then (chosen during early access). */
  trialEnd?: number | null;
  successUrl: string;
  cancelUrl: string;
}) {
  return call<{ id: string; url: string }>("POST", "/v1/checkout/sessions", {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.orgId,
    line_items: input.priceIds.map((price) => ({ price, quantity: 1 })),
    // The card is taken now, even when the first charge is after a free trial.
    payment_method_collection: "always",
    metadata: { organization_id: input.orgId },
    subscription_data: {
      metadata: { organization_id: input.orgId },
      ...(input.trialEnd ? { trial_end: input.trialEnd } : {}),
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
}

export async function createPortalSession(input: { customerId: string; returnUrl: string }) {
  return call<{ url: string }>("POST", "/v1/billing_portal/sessions", {
    customer: input.customerId,
    return_url: input.returnUrl,
  });
}

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number | null;
  metadata?: Record<string, string>;
  items: {
    data: {
      id: string;
      current_period_end?: number | null;
      price: { id: string; lookup_key: string | null; recurring?: { interval?: string } | null };
    }[];
  };
};

export async function getSubscription(id: string) {
  return call<StripeSubscription>("GET", `/v1/subscriptions/${encodeURIComponent(id)}`);
}

export type StripeInvoice = {
  id: string;
  number: string | null;
  status: string | null;
  total: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
};

export async function listInvoices(customerId: string) {
  const result = await call<{ data: StripeInvoice[] }>("GET", "/v1/invoices", {
    customer: customerId,
    limit: 12,
  });
  return result.data;
}

/**
 * Checks the Stripe-Signature header: "t=…,v1=…", HMAC-SHA256 of "t.body" with the webhook
 * secret, within five minutes.
 */
export function verifyStripeSignature(
  secret: string,
  header: string | null,
  body: string,
  now = Date.now(),
): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  const seconds = Number(t);
  if (!t || !Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

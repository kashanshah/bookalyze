import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { invoiceInboxToken, parseInvoiceRequestEmail } from "@bookalyze/core";
import {
  getDb,
  invoiceInboxOrg,
  noteInboxEmail,
  recordInvoiceRequest,
  withOrg,
} from "@bookalyze/db";
import { env } from "@/server/env";
import { logInfo, logWarn } from "@/server/log";

/** Resend signs webhooks the Svix way: HMAC-SHA256 of "id.timestamp.body", base64. */
export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  // Five minutes either way, so a captured request can't be replayed later.
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type ReceivedEmail = {
  email_id?: string;
  created_at?: string;
  from?: string;
  to?: string[] | string;
  subject?: string;
};

/**
 * Every place a forwarding address can show up. Gmail's forward keeps the original To (the
 * seller), so ours may only be in the envelope or in headers such as X-Forwarded-To: search the
 * whole event, then the full email from Resend's API when the event didn't have it.
 */
async function tokenOf(event: unknown, data: ReceivedEmail, domain: string) {
  const inEvent = invoiceInboxToken([JSON.stringify(event)], domain);
  if (inEvent || !data.email_id) return inEvent;
  const key = env().RESEND_API_KEY;
  if (!key) return null;
  const response = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(data.email_id)}`,
    { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) },
  ).catch(() => null);
  if (!response?.ok) return null;
  return invoiceInboxToken([await response.text()], domain);
}

/**
 * Handles one received email: finds the company by its forwarding address and records the
 * buyer's invoice request, or keeps the subject of anything else (a forwarding confirmation).
 * Emails to no company are dropped.
 */
export async function handleReceivedEmail(
  event: unknown,
): Promise<"recorded" | "noted" | "ignored"> {
  const domain = env().INBOUND_EMAIL_DOMAIN;
  const body = (event ?? {}) as { type?: string; data?: ReceivedEmail };
  if (!domain || body.type !== "email.received" || !body.data) return "ignored";
  const data = body.data;
  const token = await tokenOf(event, data, domain);
  const orgId = token ? await invoiceInboxOrg(getDb(), token) : null;
  if (!orgId) {
    logWarn("inbound.unknown_address", { emailId: data.email_id });
    return "ignored";
  }
  const at = data.created_at ? new Date(data.created_at) : new Date();
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  const request = parseInvoiceRequestEmail({ subject: data.subject });
  return withOrg(getDb(), { orgId }, async (tx) => {
    if (!request) {
      await noteInboxEmail(tx, {
        subject: data.subject ?? null,
        from: data.from ?? null,
        at: when,
      });
      return "noted" as const;
    }
    await recordInvoiceRequest(tx, {
      orgId,
      externalOrderId: request.externalOrderId,
      buyerName: request.buyerName,
      requestedAt: when,
    });
    logInfo("inbound.invoice_request", { orgId, order: request.externalOrderId });
    return "recorded" as const;
  });
}

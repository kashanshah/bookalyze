import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type InboxKind,
  inboxRecipient,
  parseInvoiceRequestEmail,
  supportRecipient,
} from "@bookalyze/core";
import {
  createEmailAttachment,
  getDb,
  hasEmailAttachment,
  invoiceInboxOrg,
  noteInboxEmail,
  noteInboxReceipt,
  recordInvoiceRequest,
  withOrg,
} from "@bookalyze/db";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { env } from "@/server/env";
import { logInfo, logWarn } from "@/server/log";
import { attachmentKey, putStoredFile, removeStoredFile } from "@/server/storage";
import { handleSupportEmail } from "@/server/support";

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
  /** The plain-text body, when the event carries it (Resend's API always has it). */
  text?: string;
};

const RESEND_API = "https://api.resend.com";

async function resendGet(path: string): Promise<Response | null> {
  const key = env().RESEND_API_KEY;
  if (!key) return null;
  const response = await fetch(`${RESEND_API}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return response?.ok ? response : null;
}

/**
 * Which forwarding address the email came to. Gmail's forward keeps the original To (the
 * seller), so ours may only be in the envelope or in headers such as X-Forwarded-To: search the
 * whole event, then the full email from Resend's API when the event didn't have it.
 */
async function recipientOf(event: unknown, data: ReceivedEmail, domain: string) {
  const inEvent = inboxRecipient([JSON.stringify(event)], domain);
  if (inEvent || !data.email_id) return inEvent;
  const response = await resendGet(`/emails/receiving/${encodeURIComponent(data.email_id)}`);
  return response ? inboxRecipient([await response.text()], domain) : null;
}

type ResendAttachment = {
  id?: string;
  filename?: string;
  content_type?: string;
  content_disposition?: string;
  size?: number;
  download_url?: string;
};

/** Files worth keeping: types the receipts inbox takes, not tiny inline images (logos). */
function usable(file: ResendAttachment): { contentType: string; fileName: string } | null {
  const fileName = (file.filename ?? "").trim() || "attachment";
  let contentType = (file.content_type ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (!ALLOWED_ATTACHMENT_TYPES[contentType] && /\.pdf$/i.test(fileName)) {
    contentType = "application/pdf";
  }
  if (!ALLOWED_ATTACHMENT_TYPES[contentType]) return null;
  if ((file.size ?? 0) > MAX_ATTACHMENT_BYTES) return null;
  const inline = (file.content_disposition ?? "").toLowerCase().startsWith("inline");
  if (inline && contentType.startsWith("image/") && (file.size ?? 0) < 30_000) return null;
  return { contentType, fileName: fileName.slice(0, 200) };
}

/**
 * Saves a forwarded email's files to the company's receipts inbox (unattached, ready to match
 * to a transaction). An email with none is kept by its subject instead, so a forwarding
 * confirmation code shows in the app.
 */
async function saveReceipts(orgId: string, data: ReceivedEmail, at: Date) {
  const list = data.email_id
    ? await resendGet(`/emails/receiving/${encodeURIComponent(data.email_id)}/attachments`)
    : null;
  const files = list
    ? (((await list.json().catch(() => null)) as { data?: ResendAttachment[] } | null)?.data ?? [])
    : [];
  let saved = 0;
  for (const file of files.slice(0, 10)) {
    const kind = usable(file);
    if (!kind || !file.id || !file.download_url) continue;
    const emailRef = `${data.email_id}:${file.id}`;
    if (await withOrg(getDb(), { orgId }, (tx) => hasEmailAttachment(tx, emailRef))) continue;
    const download = await fetch(file.download_url, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!download?.ok) {
      logWarn("inbound.attachment_download_failed", { orgId, status: download?.status });
      continue;
    }
    const bytes = new Uint8Array(await download.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;
    const id = randomUUID();
    const key = attachmentKey(orgId, id, kind.fileName);
    await putStoredFile({ key, bytes, contentType: kind.contentType });
    const row = await withOrg(getDb(), { orgId }, (tx) =>
      createEmailAttachment(tx, {
        id,
        orgId,
        storageKey: key,
        fileName: kind.fileName,
        contentType: kind.contentType,
        sizeBytes: bytes.byteLength,
        emailFrom: data.from ?? null,
        emailSubject: data.subject ?? null,
        emailRef,
      }),
    );
    // Saved meanwhile by a repeat delivery: drop this copy.
    if (!row) await removeStoredFile(key);
    else saved++;
  }
  await withOrg(getDb(), { orgId }, (tx) =>
    saved
      ? noteInboxReceipt(tx, at)
      : noteInboxEmail(tx, { subject: data.subject ?? null, from: data.from ?? null, at }),
  );
  if (saved) logInfo("inbound.receipts_saved", { orgId, files: saved });
  return saved;
}

export type ReceivedResult = "recorded" | "saved" | "noted" | "ignored" | "replied";

/** The full received email from Resend's API: its text, and every address in it. */
async function fullEmail(
  emailId: string | undefined,
): Promise<{ raw: string; text: string | null }> {
  if (!emailId) return { raw: "", text: null };
  const response = await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}`);
  if (!response) return { raw: "", text: null };
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { text?: unknown };
    return { raw, text: typeof parsed.text === "string" ? parsed.text : null };
  } catch {
    return { raw, text: null };
  }
}

/** A reply to a support ticket's address (support-<token>@…), or null when it isn't one. */
async function supportReply(event: unknown, data: ReceivedEmail, domain: string) {
  const inEvent = supportRecipient([JSON.stringify(event)], domain);
  if (inEvent && typeof data.text === "string") return { token: inEvent, text: data.text };
  if (inEvent || !inboxRecipient([JSON.stringify(event)], domain)) {
    const full = await fullEmail(data.email_id);
    const token = inEvent ?? supportRecipient([full.raw], domain);
    if (token) return { token, text: full.text ?? data.text ?? null };
  }
  return null;
}

/**
 * Handles one received email. A reply to a support ticket (support-…) is added to the ticket.
 * Otherwise it finds the company by its forwarding address, then records a
 * buyer's invoice request (invoices-…), or saves the files (receipts-…). Anything else to an
 * invoices address is kept by its subject (a forwarding confirmation). Emails to no company are
 * dropped.
 */
export async function handleReceivedEmail(event: unknown): Promise<ReceivedResult> {
  const domain = env().INBOUND_EMAIL_DOMAIN;
  const body = (event ?? {}) as { type?: string; data?: ReceivedEmail };
  if (!domain || body.type !== "email.received" || !body.data) return "ignored";
  const data = body.data;
  const reply = await supportReply(event, data, domain);
  if (reply) {
    const result = await handleSupportEmail({
      token: reply.token,
      emailId: data.email_id ?? null,
      from: data.from ?? null,
      text: reply.text,
    });
    return result === "added" ? "replied" : "ignored";
  }
  const recipient = await recipientOf(event, data, domain);
  const orgId = recipient ? await invoiceInboxOrg(getDb(), recipient.token) : null;
  if (!recipient || !orgId) {
    logWarn("inbound.unknown_address", { emailId: data.email_id });
    return "ignored";
  }
  const at = data.created_at ? new Date(data.created_at) : new Date();
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  return handleFor(recipient.kind, orgId, data, when);
}

async function handleFor(
  kind: InboxKind,
  orgId: string,
  data: ReceivedEmail,
  when: Date,
): Promise<ReceivedResult> {
  if (kind === "receipts") return (await saveReceipts(orgId, data, when)) ? "saved" : "noted";
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

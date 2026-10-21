import "server-only";
import { randomBytes } from "node:crypto";
import { type InboxKind, invoiceInboxAddress, isAmazonRegion } from "@bookalyze/core";
import {
  ensureInvoiceInbox,
  getChannelForSync,
  getOrder,
  getOrderInvoice,
  markOrderInvoiceSent,
  setInvoiceRequestStatus,
} from "@bookalyze/db";
import { inOrg } from "@/server/accounting";
import { AmazonError, canSendInvoice, sendInvoice } from "@/server/amazon";
import { type CommerceContext, openAmazonCredentials } from "@/server/commerce";
import { env } from "@/server/env";
import { logError } from "@/server/log";
import type { OrgContext } from "@/server/org";
import { readStoredFile } from "@/server/storage";

export type InvoiceInboxView = {
  /** Null until the app has a receiving domain (INBOUND_EMAIL_DOMAIN and the Resend webhook). */
  address: string | null;
  lastOtherSubject: string | null;
  lastOtherFrom: string | null;
  lastOtherAt: string | null;
  lastRequestAt: string | null;
  lastReceiptAt: string | null;
};

/** The company's forwarding address of that kind, made the first time it's asked for. */
export async function loadInvoiceInbox(
  ctx: OrgContext,
  kind: InboxKind = "invoices",
): Promise<InvoiceInboxView> {
  const domain = env().INBOUND_EMAIL_DOMAIN;
  const configured = Boolean(domain && env().RESEND_WEBHOOK_SECRET);
  const inbox = await inOrg(ctx, (tx) =>
    // 24 random bytes as hex: lowercase letters and digits, as the address allows.
    ensureInvoiceInbox(tx, { orgId: ctx.org.id, token: randomBytes(24).toString("hex") }),
  );
  return {
    address: configured && domain ? invoiceInboxAddress(inbox.token, domain, kind) : null,
    lastOtherSubject: inbox.lastOtherSubject,
    lastOtherFrom: inbox.lastOtherFrom,
    lastOtherAt: inbox.lastOtherAt?.toISOString() ?? null,
    lastRequestAt: inbox.lastRequestAt?.toISOString() ?? null,
    lastReceiptAt: inbox.lastReceiptAt?.toISOString() ?? null,
  };
}

const NOT_AMAZON = "Only Amazon orders can be sent from here. Upload this one on the marketplace.";
const OFFLINE =
  "The Amazon connection isn't working. Reconnect it in Commerce → Channels, or download the invoice and upload it in Seller Central.";
const NOT_OFFERED =
  "Amazon doesn't offer its invoice message for this order right now (it can be too old, or already have an invoice). Download the invoice and upload it in Seller Central instead.";

export type SendInvoiceResult =
  | { ok: true; number: string; sentAt: string }
  | { ok: false; message: string };

/**
 * Sends the order's saved invoice to the buyer with Amazon's invoice message, records when, and
 * closes the order's invoice request. Checks first that Amazon offers the message for the order.
 */
export async function sendOrderInvoiceToAmazon(
  ctx: CommerceContext,
  orderId: string,
): Promise<SendInvoiceResult> {
  const found = await inOrg(ctx, async (tx) => {
    const order = await getOrder(tx, orderId);
    if (!order) return null;
    const invoice = await getOrderInvoice(tx, orderId);
    const channel = await getChannelForSync(tx, order.channel.id);
    return { order, invoice, channel };
  });
  if (!found) return { ok: false, message: "This order is no longer here." };
  const { order, invoice, channel } = found;
  if (!invoice) return { ok: false, message: "Create the invoice first." };
  if (channel?.connection.provider !== "amazon_sp") return { ok: false, message: NOT_AMAZON };
  const region = String(channel.connection.settings.region ?? "");
  const marketplaceId = order.channel.marketplaceId;
  if (
    !channel.connection.secret ||
    channel.connection.status === "disconnected" ||
    !isAmazonRegion(region) ||
    !marketplaceId
  ) {
    return { ok: false, message: OFFLINE };
  }
  const target = { externalId: order.order.externalId, marketplaceId };
  try {
    const creds = openAmazonCredentials(
      ctx.org.id,
      channel.connection.id,
      channel.connection.secret,
    );
    if (!(await canSendInvoice(creds, region, target))) return { ok: false, message: NOT_OFFERED };
    const bytes = await readStoredFile(invoice.storageKey);
    await sendInvoice(creds, region, target, { fileName: invoice.fileName, bytes });
  } catch (error) {
    if (error instanceof AmazonError) return { ok: false, message: error.message };
    logError("invoice.send_failed", error, { orgId: ctx.org.id, orderId });
    return { ok: false, message: "The invoice couldn't be sent. Try again." };
  }
  const sentAt = new Date();
  await inOrg(ctx, async (tx) => {
    await markOrderInvoiceSent(tx, { id: invoice.id, userId: ctx.session.user.id, at: sentAt });
    await setInvoiceRequestStatus(tx, { orderId, status: "done", userId: ctx.session.user.id });
  });
  return { ok: true, number: invoice.snapshot.number, sentAt: sentAt.toISOString() };
}

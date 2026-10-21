import "server-only";
import { randomBytes } from "node:crypto";
import {
  emailAddressOf,
  emailNameOf,
  stripQuotedReply,
  supportReplyAddress,
  supportTicketLabel,
} from "@bookalyze/core";
import {
  addSupportMessage,
  getDb,
  getSupportTicket,
  type SupportTicketRow,
  supportTicketByToken,
  type Transaction,
  withSupportDesk,
} from "@bookalyze/db";
import { notFound } from "next/navigation";
import { SupportMessage } from "@/emails/support-message";
import { sendEmail } from "./email";
import { env } from "./env";
import { logError, logInfo, logWarn } from "./log";
import { requireSession } from "./session";

/** The support desk is the platform admins (PLATFORM_ADMIN_EMAILS). */
export function isSupportAgent(email: string | null | undefined): boolean {
  return Boolean(email && env().PLATFORM_ADMIN_EMAILS.includes(email.trim().toLowerCase()));
}

/** The signed-in platform admin, or a 404 for anyone else (the desk's pages don't exist for them). */
export async function requireSupportAgent(redirectTo = "/admin/support") {
  const session = await requireSession(redirectTo);
  if (!isSupportAgent(session.user.email)) notFound();
  return session;
}

/** Runs `fn` as the support desk. Only after `requireSupportAgent`, or from a checked webhook. */
export function asDesk<T>(userId: string | null, fn: (tx: Transaction) => Promise<T>) {
  return withSupportDesk(getDb(), { userId }, fn);
}

export function newSupportToken(): string {
  return randomBytes(24).toString("hex");
}

/** The ticket's reply-by-email address, when inbound email is set up. */
function replyAddress(token: string): string | undefined {
  const domain = env().INBOUND_EMAIL_DOMAIN;
  return domain && env().RESEND_WEBHOOK_SECRET ? supportReplyAddress(token, domain) : undefined;
}

type TicketForEmail = Pick<
  SupportTicketRow,
  "id" | "number" | "subject" | "token" | "orgName" | "orgSlug" | "requesterEmail" | "requesterName"
>;

/** Emails each support agent about a new ticket or a customer's reply. Never throws. */
export async function emailDesk(
  ticket: TicketForEmail,
  message: { kind: "new" | "reply"; authorName: string; body: string },
) {
  const agents = env().PLATFORM_ADMIN_EMAILS;
  const label = supportTicketLabel(ticket.number);
  const who = ticket.requesterName
    ? `${ticket.requesterName} (${ticket.requesterEmail})`
    : ticket.requesterEmail;
  for (const to of agents) {
    try {
      await sendEmail({
        to,
        subject: `[${label}] ${ticket.subject}`,
        replyTo: replyAddress(ticket.token),
        react: SupportMessage({
          ticket: label,
          subject: ticket.subject,
          authorName: message.authorName,
          body: message.body,
          kind: message.kind,
          context: ticket.orgName ? `${ticket.orgName} · ${who}` : `Website · ${who}`,
          url: `${env().BETTER_AUTH_URL}/admin/support/${ticket.id}`,
          canReplyByEmail: Boolean(replyAddress(ticket.token)),
        }),
      });
    } catch (error) {
      logError("support.email_desk_failed", error, { ticket: label });
    }
  }
}

/** Emails the customer the desk's reply. Never throws. */
export async function emailCustomer(ticket: TicketForEmail, body: string) {
  const label = supportTicketLabel(ticket.number);
  try {
    await sendEmail({
      to: ticket.requesterEmail,
      subject: `Re: [${label}] ${ticket.subject}`,
      replyTo: replyAddress(ticket.token),
      react: SupportMessage({
        ticket: label,
        subject: ticket.subject,
        authorName: "Bookalyze support",
        body,
        kind: "reply",
        url: ticket.orgSlug
          ? `${env().BETTER_AUTH_URL}/o/${ticket.orgSlug}/help/${ticket.id}`
          : null,
        canReplyByEmail: Boolean(replyAddress(ticket.token)),
      }),
    });
  } catch (error) {
    logError("support.email_customer_failed", error, { ticket: label });
  }
}

export type SupportEmailResult = "added" | "duplicate" | "ignored";

/**
 * An email reply to support-<token>@…: the new part (quoted history cut) is added to the ticket,
 * from the customer when it's from the requester's address, from the desk when it's from an
 * agent's. Anyone else's email is dropped, so a forwarded copy can't post as the customer.
 */
export async function handleSupportEmail(input: {
  token: string;
  emailId: string | null;
  from: string | null;
  text: string | null;
}): Promise<SupportEmailResult> {
  const ticket = await asDesk(null, (tx) => supportTicketByToken(tx, input.token));
  const address = emailAddressOf(input.from);
  if (!ticket || !address) {
    logWarn("support.reply_unknown", { emailId: input.emailId });
    return "ignored";
  }
  const fromSupport = isSupportAgent(address);
  if (!fromSupport && address !== ticket.requesterEmail) {
    logWarn("support.reply_from_stranger", { ticket: ticket.number });
    return "ignored";
  }
  const body = stripQuotedReply(input.text ?? "").slice(0, 20_000);
  if (!body) return "ignored";
  const message = await asDesk(null, (tx) =>
    addSupportMessage(tx, {
      ticketId: ticket.id,
      authorUserId: null,
      authorEmail: address,
      authorName: fromSupport
        ? "Bookalyze support"
        : (emailNameOf(input.from) ?? ticket.requesterName),
      fromSupport,
      body,
      via: "email",
      emailRef: input.emailId ? `email:${input.emailId}` : null,
    }),
  );
  if (!message) return "duplicate";
  logInfo("support.reply_by_email", { ticket: ticket.number, fromSupport });
  if (fromSupport) await emailCustomer(ticket, body);
  else
    await emailDesk(ticket, {
      kind: "reply",
      authorName: ticket.requesterName ?? ticket.requesterEmail,
      body,
    });
  return "added";
}

/** A ticket for the desk's page, or a 404. */
export async function deskTicket(userId: string, id: string) {
  const ticket = await asDesk(userId, (tx) => getSupportTicket(tx, id));
  if (!ticket) notFound();
  return ticket;
}

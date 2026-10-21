import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { organization, user } from "./schema/auth";
import {
  type SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  type SUPPORT_TOPICS,
  supportMessages,
  supportTickets,
} from "./schema/support";

/**
 * Support tickets and their messages. Inside `withOrg()` a company sees its own tickets, without
 * internal notes; inside `withSupportDesk()` the desk sees all of them.
 */

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export type SupportVia = "app" | "email" | "website";

export class SupportError extends Error {}

export type NewSupportTicket = {
  /** Null for a website enquiry. */
  orgId: string | null;
  requesterUserId: string | null;
  requesterEmail: string;
  requesterName: string | null;
  subject: string;
  topic: SupportTopic;
  body: string;
  source: "app" | "website";
  page?: string | null;
  /** 48 hex characters; the reply-by-email address carries it. */
  token: string;
};

/** Opens a ticket with its first message, waiting on the desk. */
export async function createSupportTicket(tx: Transaction, input: NewSupportTicket) {
  const [ticket] = await tx
    .insert(supportTickets)
    .values({
      organizationId: input.orgId,
      requesterUserId: input.requesterUserId,
      requesterEmail: input.requesterEmail.trim().toLowerCase(),
      requesterName: input.requesterName?.trim() || null,
      subject: input.subject.trim(),
      topic: input.topic,
      source: input.source,
      page: input.page?.trim() || null,
      token: input.token,
      status: "waiting_on_us",
    })
    .returning({
      id: supportTickets.id,
      number: supportTickets.number,
      token: supportTickets.token,
    });
  if (!ticket) throw new SupportError("The ticket wasn't saved.");
  await tx.insert(supportMessages).values({
    ticketId: ticket.id,
    organizationId: input.orgId,
    authorUserId: input.requesterUserId,
    authorEmail: input.requesterEmail.trim().toLowerCase(),
    authorName: input.requesterName?.trim() || null,
    body: input.body.trim(),
    via: input.source === "website" ? "website" : "app",
  });
  return ticket;
}

const ticketColumns = {
  id: supportTickets.id,
  number: supportTickets.number,
  orgId: supportTickets.organizationId,
  orgName: organization.name,
  orgSlug: organization.slug,
  requesterUserId: supportTickets.requesterUserId,
  requesterEmail: supportTickets.requesterEmail,
  requesterName: supportTickets.requesterName,
  subject: supportTickets.subject,
  topic: supportTickets.topic,
  status: supportTickets.status,
  priority: supportTickets.priority,
  assignedTo: supportTickets.assignedTo,
  source: supportTickets.source,
  page: supportTickets.page,
  token: supportTickets.token,
  lastMessageAt: supportTickets.lastMessageAt,
  createdAt: supportTickets.createdAt,
};

export type SupportTicketRow = Awaited<ReturnType<typeof listSupportTickets>>[number];

/** Tickets, latest activity first. `statuses` narrows them (e.g. the active ones). */
export async function listSupportTickets(
  tx: Transaction,
  options: { statuses?: readonly SupportStatus[]; limit?: number } = {},
) {
  return tx
    .select(ticketColumns)
    .from(supportTickets)
    .leftJoin(organization, eq(organization.id, supportTickets.organizationId))
    .where(options.statuses?.length ? inArray(supportTickets.status, options.statuses) : undefined)
    .orderBy(desc(supportTickets.lastMessageAt))
    .limit(options.limit ?? 200);
}

/** One ticket with its messages (internal notes only for the desk), or null. */
export async function getSupportTicket(tx: Transaction, id: string) {
  const [ticket] = await tx
    .select(ticketColumns)
    .from(supportTickets)
    .leftJoin(organization, eq(organization.id, supportTickets.organizationId))
    .where(eq(supportTickets.id, id))
    .limit(1);
  if (!ticket) return null;
  const messages = await tx
    .select({
      id: supportMessages.id,
      authorUserId: supportMessages.authorUserId,
      authorEmail: supportMessages.authorEmail,
      authorName: sql<string | null>`coalesce(${supportMessages.authorName}, ${user.name})`,
      fromSupport: supportMessages.fromSupport,
      internal: supportMessages.internal,
      body: supportMessages.body,
      via: supportMessages.via,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .leftJoin(user, eq(user.id, supportMessages.authorUserId))
    .where(eq(supportMessages.ticketId, id))
    .orderBy(asc(supportMessages.createdAt), asc(supportMessages.id));
  return { ...ticket, messages };
}

/** The ticket a reply-by-email token belongs to (desk only), or null. */
export async function supportTicketByToken(tx: Transaction, token: string) {
  const [row] = await tx
    .select(ticketColumns)
    .from(supportTickets)
    .leftJoin(organization, eq(organization.id, supportTickets.organizationId))
    .where(eq(supportTickets.token, token))
    .limit(1);
  return row ?? null;
}

export type NewSupportMessage = {
  ticketId: string;
  authorUserId: string | null;
  authorEmail: string | null;
  authorName: string | null;
  fromSupport: boolean;
  internal?: boolean;
  body: string;
  via?: SupportVia;
  /** For an emailed reply: Resend's email id, so a repeated webhook adds nothing. */
  emailRef?: string | null;
};

/**
 * Adds a message and moves the ticket on: a customer's message puts it back with the desk
 * (reopening a solved or closed one), the desk's reply waits on the customer, and an internal
 * note changes nothing. Returns null when the emailed reply was already added.
 */
export async function addSupportMessage(tx: Transaction, input: NewSupportMessage) {
  const internal = Boolean(input.internal);
  if (internal && !input.fromSupport) throw new SupportError("Only the support desk adds notes.");
  const [ticket] = await tx
    .select({ id: supportTickets.id })
    .from(supportTickets)
    .where(eq(supportTickets.id, input.ticketId))
    .limit(1)
    .for("update");
  if (!ticket) throw new SupportError("That ticket doesn't exist.");
  const [message] = await tx
    .insert(supportMessages)
    .values({
      ticketId: input.ticketId,
      authorUserId: input.authorUserId,
      authorEmail: input.authorEmail?.trim().toLowerCase() || null,
      authorName: input.authorName?.trim() || null,
      fromSupport: input.fromSupport,
      internal,
      body: input.body.trim(),
      via: input.via ?? "app",
      emailRef: input.emailRef ?? null,
    })
    .onConflictDoNothing({ target: supportMessages.emailRef })
    .returning({ id: supportMessages.id, createdAt: supportMessages.createdAt });
  if (!message) return null;
  if (!internal) {
    await tx
      .update(supportTickets)
      .set({
        status: input.fromSupport ? "waiting_on_you" : "waiting_on_us",
        lastMessageAt: message.createdAt,
      })
      .where(eq(supportTickets.id, input.ticketId));
  }
  return message;
}

export async function setSupportTicketStatus(tx: Transaction, id: string, status: SupportStatus) {
  const [row] = await tx
    .update(supportTickets)
    .set({ status })
    .where(eq(supportTickets.id, id))
    .returning({ id: supportTickets.id });
  if (!row) throw new SupportError("That ticket doesn't exist.");
}

/** The desk's own fields: who has it and how urgent it is. */
export async function updateSupportTicketDesk(
  tx: Transaction,
  id: string,
  input: { assignedTo?: string | null; priority?: SupportPriority },
) {
  const [row] = await tx
    .update(supportTickets)
    .set({
      ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
    })
    .where(eq(supportTickets.id, id))
    .returning({ id: supportTickets.id });
  if (!row) throw new SupportError("That ticket doesn't exist.");
}

/** How many of the company's tickets wait on it (Home's "Needs your attention"). */
export async function countSupportRepliesWaiting(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(and(eq(supportTickets.status, "waiting_on_you")));
  return row?.n ?? 0;
}

/** The desk's queue counts per status. */
export async function supportStatusCounts(tx: Transaction) {
  const rows = await tx
    .select({ status: supportTickets.status, n: sql<number>`count(*)::int` })
    .from(supportTickets)
    .groupBy(supportTickets.status);
  const counts = Object.fromEntries(SUPPORT_STATUSES.map((s) => [s, 0])) as Record<
    SupportStatus,
    number
  >;
  for (const r of rows) counts[r.status as SupportStatus] = r.n;
  return counts;
}

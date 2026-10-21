"use server";

import {
  addSupportMessage,
  createSupportTicket,
  getSupportTicket,
  setSupportTicketStatus,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getOrgContext } from "@/server/org";
import { emailDesk, newSupportToken } from "@/server/support";

export type HelpResult =
  | { ok: true; ticketId?: string; ticket?: string }
  | { ok: false; message?: string; errors?: Record<string, string> };

const newTicket = z.object({
  topic: z.enum(["question", "help", "billing", "bug", "coverage", "other"], {
    error: "Choose what it's about.",
  }),
  subject: z
    .string()
    .trim()
    .min(3, "Say in a few words what it's about.")
    .max(200, "Keep the subject under 200 characters."),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a little more, so we can help the first time.")
    .max(10000, "Keep it under 10,000 characters."),
  page: z.string().trim().max(300).optional().default(""),
});

function errorsOf(error: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

export async function openTicketAction(slug: string, input: unknown): Promise<HelpResult> {
  const ctx = await getOrgContext(slug);
  const parsed = newTicket.safeParse(input);
  if (!parsed.success) return { ok: false, errors: errorsOf(parsed.error) };
  const { topic, subject, message, page } = parsed.data;
  const user = ctx.session.user;
  // Only a path inside this company's pages is kept, as context for the desk.
  const fromPage = page.startsWith(`/o/${slug}`) ? page : null;
  const ticket = await inOrg(ctx, async (tx) => {
    const created = await createSupportTicket(tx, {
      orgId: ctx.org.id,
      requesterUserId: user.id,
      requesterEmail: user.email,
      requesterName: user.name,
      subject,
      topic,
      body: message,
      source: "app",
      page: fromPage,
      token: newSupportToken(),
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: user.id,
      action: "support_ticket.opened",
      entityType: "support_ticket",
      entityId: created.id,
    });
    return created;
  });
  await emailDesk(
    {
      ...ticket,
      subject,
      orgName: ctx.org.name,
      orgSlug: ctx.org.slug,
      requesterEmail: user.email.toLowerCase(),
      requesterName: user.name,
    },
    { kind: "new", authorName: user.name, body: message },
  );
  revalidatePath(`/o/${slug}/help`);
  return { ok: true, ticketId: ticket.id };
}

const reply = z.object({
  ticketId: z.uuid(),
  message: z
    .string()
    .trim()
    .min(1, "Write a reply first.")
    .max(10000, "Keep it under 10,000 characters."),
});

export async function replyToTicketAction(slug: string, input: unknown): Promise<HelpResult> {
  const ctx = await getOrgContext(slug);
  const parsed = reply.safeParse(input);
  if (!parsed.success) return { ok: false, errors: errorsOf(parsed.error) };
  const user = ctx.session.user;
  const ticket = await inOrg(ctx, async (tx) => {
    const found = await getSupportTicket(tx, parsed.data.ticketId);
    if (!found) return null;
    await addSupportMessage(tx, {
      ticketId: found.id,
      authorUserId: user.id,
      authorEmail: user.email,
      authorName: user.name,
      fromSupport: false,
      body: parsed.data.message,
    });
    return found;
  });
  if (!ticket) return { ok: false, message: "That ticket no longer exists." };
  await emailDesk(ticket, { kind: "reply", authorName: user.name, body: parsed.data.message });
  revalidatePath(`/o/${slug}/help`);
  revalidatePath(`/o/${slug}/help/${ticket.id}`);
  return { ok: true };
}

const status = z.object({ ticketId: z.uuid(), solved: z.boolean() });

/** The customer marks their ticket solved, or opens it again. */
export async function setTicketSolvedAction(slug: string, input: unknown): Promise<HelpResult> {
  const ctx = await getOrgContext(slug);
  const parsed = status.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Unknown ticket." };
  const done = await inOrg(ctx, async (tx) => {
    const found = await getSupportTicket(tx, parsed.data.ticketId);
    if (!found) return false;
    await setSupportTicketStatus(tx, found.id, parsed.data.solved ? "solved" : "waiting_on_us");
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: parsed.data.solved ? "support_ticket.solved" : "support_ticket.reopened",
      entityType: "support_ticket",
      entityId: found.id,
    });
    return true;
  });
  if (!done) return { ok: false, message: "That ticket no longer exists." };
  revalidatePath(`/o/${slug}/help`);
  revalidatePath(`/o/${slug}/help/${parsed.data.ticketId}`);
  return { ok: true };
}

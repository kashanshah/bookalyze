"use server";

import {
  addSupportMessage,
  getSupportTicket,
  setSupportTicketStatus,
  updateSupportTicketDesk,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asDesk, emailCustomer, requireSupportAgent } from "@/server/support";

export type DeskResult = { ok: true } | { ok: false; message: string };

const reply = z.object({
  ticketId: z.uuid(),
  message: z.string().trim().min(1).max(10000),
  internal: z.boolean(),
});

/** The desk's reply (emailed to the customer) or an internal note (never shown to them). */
export async function deskReplyAction(input: unknown): Promise<DeskResult> {
  const session = await requireSupportAgent();
  const parsed = reply.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a reply first." };
  const { ticketId, message, internal } = parsed.data;
  const ticket = await asDesk(session.user.id, async (tx) => {
    const found = await getSupportTicket(tx, ticketId);
    if (!found) return null;
    await addSupportMessage(tx, {
      ticketId,
      authorUserId: session.user.id,
      authorEmail: session.user.email,
      authorName: session.user.name,
      fromSupport: true,
      internal,
      body: message,
    });
    return found;
  });
  if (!ticket) return { ok: false, message: "That ticket no longer exists." };
  if (!internal) await emailCustomer(ticket, message);
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${ticketId}`);
  return { ok: true };
}

const update = z.object({
  ticketId: z.uuid(),
  status: z.enum(["open", "waiting_on_you", "waiting_on_us", "solved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignToMe: z.boolean().optional(),
  unassign: z.boolean().optional(),
});

export async function deskUpdateAction(input: unknown): Promise<DeskResult> {
  const session = await requireSupportAgent();
  const parsed = update.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change isn't possible." };
  const { ticketId, status, priority, assignToMe, unassign } = parsed.data;
  await asDesk(session.user.id, async (tx) => {
    if (status) await setSupportTicketStatus(tx, ticketId, status);
    if (priority || assignToMe || unassign) {
      await updateSupportTicketDesk(tx, ticketId, {
        priority,
        assignedTo: assignToMe ? session.user.id : unassign ? null : undefined,
      });
    }
  });
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${ticketId}`);
  return { ok: true };
}

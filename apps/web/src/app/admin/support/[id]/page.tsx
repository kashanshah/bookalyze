import {
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_TOPIC_LABELS,
  type SupportTopic,
  supportTicketLabel,
} from "@bookalyze/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Thread, TicketStatus } from "@/components/support/ticket-parts";
import { deskTicket, requireSupportAgent } from "@/server/support";
import { DeskControls, DeskReply } from "./desk-forms";

export const metadata: Metadata = { title: "Ticket" };

export default async function DeskTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSupportAgent();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ticket = await deskTicket(session.user.id, id);
  const facts = [
    ["Company", ticket.orgName ?? "Website enquiry (no company)"],
    [
      "From",
      ticket.requesterName
        ? `${ticket.requesterName} · ${ticket.requesterEmail}`
        : ticket.requesterEmail,
    ],
    ["Topic", SUPPORT_TOPIC_LABELS[ticket.topic as SupportTopic] ?? ticket.topic],
    [
      "Priority",
      SUPPORT_PRIORITY_LABELS[ticket.priority as keyof typeof SUPPORT_PRIORITY_LABELS] ??
        ticket.priority,
    ],
    [
      "Came from",
      ticket.page ?? (ticket.source === "website" ? "bookalyze.com contact form" : "—"),
    ],
  ] as const;

  return (
    <>
      <Link
        href="/admin/support"
        className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Tickets
      </Link>
      <PageHeader
        eyebrow={supportTicketLabel(ticket.number)}
        title={ticket.subject}
        actions={<TicketStatus status={ticket.status} desk />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid content-start gap-4">
          <Thread messages={ticket.messages} locale="en-CA" timeZone="UTC" desk />
          <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
            <DeskReply ticketId={ticket.id} customerHasAccount={Boolean(ticket.orgId)} />
          </section>
        </div>
        <aside className="grid content-start gap-4">
          <dl className="grid gap-3 rounded-2xl border bg-card p-5 text-sm shadow-xs">
            {facts.map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <DeskControls
            ticketId={ticket.id}
            status={ticket.status}
            priority={ticket.priority}
            mine={ticket.assignedTo === session.user.id}
            assigned={Boolean(ticket.assignedTo)}
          />
        </aside>
      </div>
    </>
  );
}

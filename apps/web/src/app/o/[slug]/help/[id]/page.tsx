import { SUPPORT_TOPIC_LABELS, type SupportTopic, supportTicketLabel } from "@bookalyze/core";
import { getSupportTicket } from "@bookalyze/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Thread, TicketStatus } from "@/components/support/ticket-parts";
import { inOrg } from "@/server/accounting";
import { getOrgContext } from "@/server/org";
import { SolvedButton } from "../solved-button";
import { ReplyForm } from "../support-form";

export const metadata: Metadata = { title: "Support ticket" };

export default async function TicketPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await getOrgContext(slug);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ticket = await inOrg(ctx, (tx) => getSupportTicket(tx, id));
  if (!ticket) notFound();
  const solved = ticket.status === "solved" || ticket.status === "closed";

  return (
    <div className="grid max-w-3xl gap-6">
      <Link
        href={`/o/${slug}/help`}
        className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Help & support
      </Link>
      <PageHeader
        eyebrow={`${supportTicketLabel(ticket.number)} · ${SUPPORT_TOPIC_LABELS[ticket.topic as SupportTopic] ?? "Support"}`}
        title={ticket.subject}
        actions={
          <div className="flex items-center gap-3">
            <TicketStatus status={ticket.status} />
            <SolvedButton slug={slug} ticketId={ticket.id} solved={solved} />
          </div>
        }
      />
      {ticket.status === "waiting_on_you" ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          We've replied. Answer below, or mark it solved if that sorted it.
        </p>
      ) : null}
      <Thread
        messages={ticket.messages}
        locale={ctx.profile?.locale ?? "en-CA"}
        timeZone={ctx.profile?.timezone ?? "UTC"}
      />
      <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <ReplyForm slug={slug} ticketId={ticket.id} />
        {solved ? (
          <p className="mt-3 text-muted-foreground text-xs">Replying opens the ticket again.</p>
        ) : null}
      </section>
    </div>
  );
}

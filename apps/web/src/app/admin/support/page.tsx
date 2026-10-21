import { type SupportStatus, supportTicketLabel } from "@bookalyze/core";
import { listSupportTickets, supportStatusCounts } from "@bookalyze/db";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { TicketStatus } from "@/components/support/ticket-parts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { asDesk, requireSupportAgent } from "@/server/support";

export const metadata: Metadata = { title: "Tickets" };

const TABS = [
  { key: "reply", label: "Needs a reply", statuses: ["waiting_on_us", "open"] },
  { key: "customer", label: "Waiting on the customer", statuses: ["waiting_on_you"] },
  { key: "done", label: "Solved and closed", statuses: ["solved", "closed"] },
  { key: "all", label: "All", statuses: [] },
] as const satisfies readonly { key: string; label: string; statuses: readonly SupportStatus[] }[];

export default async function SupportQueue({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSupportAgent();
  const { tab: tabKey } = await searchParams;
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];
  const [tickets, counts] = await asDesk(
    session.user.id,
    async (tx) =>
      [
        await listSupportTickets(tx, { statuses: tab.statuses }),
        await supportStatusCounts(tx),
      ] as const,
  );
  const count = (statuses: readonly SupportStatus[]) =>
    statuses.length
      ? statuses.reduce((n, s) => n + counts[s], 0)
      : Object.values(counts).reduce((n, c) => n + c, 0);
  const day = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader
        title="Tickets"
        description="Every company's tickets and the website's enquiries, latest first."
      />
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4" aria-label="Ticket status">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/support?tab=${t.key}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm",
              t.key === tab.key
                ? "bg-card font-medium shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="text-muted-foreground text-xs tabular-nums">{count(t.statuses)}</span>
          </Link>
        ))}
      </nav>
      {tickets.length ? (
        <ul className="grid gap-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/support/${t.id}`}
                className="grid gap-1.5 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/30 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
              >
                <span className="grid min-w-0 gap-1">
                  <span className="truncate font-medium text-sm">{t.subject}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {supportTicketLabel(t.number)} · {t.orgName ?? "Website"} ·{" "}
                    {t.requesterName ?? t.requesterEmail} · {day.format(t.lastMessageAt)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {t.priority === "high" || t.priority === "urgent" ? (
                    <Badge variant="destructive">
                      {t.priority === "urgent" ? "Urgent" : "High"}
                    </Badge>
                  ) : null}
                  {t.assignedTo === session.user.id ? <Badge variant="outline">Yours</Badge> : null}
                  <TicketStatus status={t.status} desk />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
          <Inbox className="size-5 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Nothing here.</p>
        </div>
      )}
    </>
  );
}

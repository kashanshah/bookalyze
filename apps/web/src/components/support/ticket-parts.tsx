import {
  SUPPORT_DESK_STATUS_LABELS,
  SUPPORT_STATUS_LABELS,
  type SupportStatus,
} from "@bookalyze/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const VARIANT: Record<SupportStatus, "warning" | "primary" | "success" | "secondary"> = {
  open: "primary",
  waiting_on_us: "primary",
  waiting_on_you: "warning",
  solved: "success",
  closed: "secondary",
};

/** A ticket's status; `desk` words it from the support side ("Needs a reply"). */
export function TicketStatus({ status, desk }: { status: string; desk?: boolean }) {
  const key = (status in SUPPORT_STATUS_LABELS ? status : "open") as SupportStatus;
  const deskVariant =
    key === "waiting_on_us" ? "warning" : key === "waiting_on_you" ? "primary" : VARIANT[key];
  return (
    <Badge variant={desk ? deskVariant : VARIANT[key]}>
      {desk ? SUPPORT_DESK_STATUS_LABELS[key] : SUPPORT_STATUS_LABELS[key]}
    </Badge>
  );
}

export type ThreadMessage = {
  id: string;
  authorName: string | null;
  authorEmail: string | null;
  fromSupport: boolean;
  internal: boolean;
  body: string;
  via: string;
  createdAt: Date;
};

/** The conversation, oldest first. The customer's side reads "Bookalyze support" for the desk. */
export function Thread({
  messages,
  locale,
  timeZone,
  desk,
}: {
  messages: ThreadMessage[];
  locale: string;
  timeZone: string;
  desk?: boolean;
}) {
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  return (
    <ol className="grid gap-3">
      {messages.map((m) => {
        const who = m.fromSupport
          ? desk
            ? `${m.authorName ?? "Support"} · support`
            : "Bookalyze support"
          : (m.authorName ?? m.authorEmail ?? "Customer");
        return (
          <li
            key={m.id}
            className={cn(
              "fade-in-0 slide-in-from-bottom-1 grid animate-in gap-2 rounded-2xl border p-4 duration-300 sm:p-5",
              m.internal
                ? "border-warning/50 border-dashed bg-warning/5"
                : m.fromSupport
                  ? "bg-primary/[0.03]"
                  : "bg-card",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">
                {who}
                {m.internal ? (
                  <span className="ms-2 text-muted-foreground text-xs">Internal note</span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs">
                {when.format(m.createdAt)}
                {m.via === "email" ? " · by email" : m.via === "website" ? " · website" : ""}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

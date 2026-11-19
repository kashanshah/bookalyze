"use client";

import { ArrowRight, Clock, Unplug, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { AssistantReminderView } from "@/server/ai-assistants";
import { dismissAssistantReminderAction } from "./reminder-actions";

/**
 * "Claude's access ends in 3 days" / "Claude can't reach your books any more", each with a
 * way to reconnect and an ×. Dismissed reminders stay hidden on this device; "ends soon"
 * and "has ended" are dismissed separately, so hiding the first still warns when it ends.
 */
export function AssistantReminders({
  reminders,
  href,
}: {
  reminders: AssistantReminderView[];
  /** Where "How to reconnect" goes; left out on the AI assistants page itself. */
  href?: string;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const shown = reminders.filter((r) => !hidden.includes(r.key));
  if (!shown.length) return null;

  function dismiss(key: string) {
    setHidden((h) => [...h, key]);
    startTransition(() => dismissAssistantReminderAction(key));
  }

  return (
    <div className="grid gap-3">
      {shown.map((r) => {
        const ended = r.kind === "ended";
        const Icon = ended ? Unplug : Clock;
        const when = r.daysLeft === 1 ? "within a day" : `in ${r.daysLeft} days`;
        return (
          <section
            key={r.key}
            aria-label={`${r.name} reminder`}
            className="fade-in-0 slide-in-from-top-1 relative flex animate-in flex-wrap items-start gap-4 rounded-2xl border border-warning/40 bg-warning/5 p-4 pe-12 duration-300 sm:p-5 sm:pe-14"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1 basis-60">
              <h2 className="font-semibold">
                {ended
                  ? `${r.name} can't reach your books any more`
                  : `${r.name}'s access to your books ends ${when}`}
              </h2>
              <p className="mt-0.5 text-muted-foreground text-sm">
                {ended
                  ? `The access you gave it ended on ${r.on}. To keep using Bookalyze in ${r.name}, open Bookalyze in its connectors and sign in again. You'll choose what it may do and for how long.`
                  : `On ${r.on}. To keep it working, disconnect Bookalyze in ${r.name}'s connectors and connect it again, choosing a longer time or “Until I disconnect”.`}
              </p>
            </div>
            {href ? (
              <Link
                href={href}
                className="inline-flex h-9 items-center gap-2 self-center rounded-lg border bg-card px-3 font-medium text-sm shadow-xs transition-colors hover:bg-muted"
              >
                How to reconnect
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => dismiss(r.key)}
              aria-label={`Dismiss the ${r.name} reminder`}
              className="absolute end-2.5 top-2.5 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </section>
        );
      })}
    </div>
  );
}

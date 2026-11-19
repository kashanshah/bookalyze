"use client";

import { SUPPORT_TOPIC_LABELS } from "@bookalyze/core";
import { BookOpen, CircleCheck, Inbox, LifeBuoy, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { openTicketAction } from "@/app/o/[slug]/help/actions";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const TOPICS = Object.entries(SUPPORT_TOPIC_LABELS).map(([value, label]) => ({ value, label }));
const GUIDES_URL = "https://bookalyze.com/guides";

/**
 * The floating "Help" button on every company page: a short form that opens a support ticket
 * (the same as Help & support → Contact support), sent to the support desk and its email, with
 * the page the person was on. Hidden on the Help pages themselves and when printing.
 *
 * Pages with an action bar fixed along the bottom (journal entry, reconciliation, unsaved
 * settings) mark it `data-action-bar`; the button then sits just above the tallest one showing,
 * so it never covers their buttons.
 */
export function HelpButton({ slug }: { slug: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const lift = useActionBarHeight();
  const help = `/o/${slug}/help`;
  if (pathname.startsWith(help)) return null;

  const reset = () => {
    setTopic("");
    setErrors({});
    setSent(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A new message each time after one was sent; a half-written one is kept.
        if (!next && sent) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          style={lift ? { bottom: lift + 12 } : undefined}
          className="fade-in-0 fixed end-4 bottom-4 z-40 flex h-11 animate-in items-center gap-2 rounded-full bg-primary ps-3.5 pe-4 font-medium text-primary-foreground text-sm shadow-lg ring-1 ring-black/5 transition-[transform,bottom] duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:end-6 sm:bottom-6 print:hidden"
        >
          <LifeBuoy className="size-4.5" />
          Help
        </button>
      </DialogTrigger>
      <DialogContent>
        {sent ? (
          <div className="grid justify-items-center gap-3 py-4 text-center">
            <CircleCheck className="size-10 text-success" />
            <DialogHeader className="items-center">
              <DialogTitle>Sent. Thank you.</DialogTitle>
              <DialogDescription>
                We'll reply by email and under Help & support. You can add to it there any time.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button asChild variant="outline">
                <Link href={`${help}/${sent}`} onClick={() => setOpen(false)}>
                  Open the conversation
                </Link>
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>How can we help?</DialogTitle>
              <DialogDescription>
                Tell us what's going on and we'll reply by email and under Help & support. We'll
                include the page you're on, so we can see what you saw.
              </DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                start(async () => {
                  const result = await openTicketAction(slug, {
                    topic,
                    subject: form.get("subject"),
                    message: form.get("message"),
                    page: pathname,
                  });
                  if (!result.ok) {
                    setErrors(result.errors ?? {});
                    if (result.message) toast.error(result.message);
                    return;
                  }
                  setErrors({});
                  setSent(result.ticketId ?? "");
                });
              }}
            >
              <Field label="What's it about?" htmlFor="help-topic" error={errors.topic}>
                <Combobox
                  id="help-topic"
                  value={topic}
                  onChange={(v) => {
                    setTopic(v);
                    setErrors((e) => ({ ...e, topic: "" }));
                  }}
                  options={TOPICS}
                  placeholder="Choose a topic"
                  invalid={Boolean(errors.topic)}
                />
              </Field>
              <Field label="Subject" htmlFor="help-subject" error={errors.subject}>
                <Input
                  id="help-subject"
                  name="subject"
                  maxLength={200}
                  placeholder="For example: My payout doesn't match the deposit"
                  aria-invalid={Boolean(errors.subject)}
                />
              </Field>
              <Field
                label="Message"
                htmlFor="help-message"
                error={errors.message}
                hint="What you tried and what happened. Leave out passwords and keys."
              >
                <Textarea
                  id="help-message"
                  name="message"
                  rows={5}
                  maxLength={10000}
                  aria-invalid={Boolean(errors.message)}
                />
              </Field>
              <Button
                type="submit"
                disabled={pending}
                className="w-full sm:w-auto sm:justify-self-start"
              >
                {pending ? <Spinner /> : <Send />}
                Send to support
              </Button>
            </form>
            <div className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-4 text-sm">
              <a
                href={GUIDES_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <BookOpen className="size-4" />
                Browse the guides
              </a>
              <Link
                href={help}
                onClick={() => setOpen(false)}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Inbox className="size-4" />
                Your conversations with us
              </Link>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The height of the tallest `data-action-bar` on the page, kept up to date (0 when none). */
function useActionBarHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let tallest = 0;
        for (const bar of document.querySelectorAll<HTMLElement>("[data-action-bar]")) {
          tallest = Math.max(tallest, Math.ceil(bar.getBoundingClientRect().height));
        }
        setHeight(tallest);
      });
    };
    measure();
    const changes = new MutationObserver(measure);
    changes.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-action-bar"],
    });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return height;
}

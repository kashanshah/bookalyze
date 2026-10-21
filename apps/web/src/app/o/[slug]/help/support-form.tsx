"use client";

import { SUPPORT_TOPIC_LABELS } from "@bookalyze/core";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { openTicketAction, replyToTicketAction } from "./actions";

const TOPICS = Object.entries(SUPPORT_TOPIC_LABELS).map(([value, label]) => ({ value, label }));

/** Contact support: a new ticket. `from` is the page the person came from, for context. */
export function SupportForm({ slug, from }: { slug: string; from: string | null }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const result = await openTicketAction(slug, {
            topic,
            subject: form.get("subject"),
            message: form.get("message"),
            page: from ?? "",
          });
          if (!result.ok) {
            setErrors(result.errors ?? {});
            if (result.message) toast.error(result.message);
            return;
          }
          setErrors({});
          toast.success("Sent. We'll reply here and by email.");
          if (result.ticketId) router.push(`/o/${slug}/help/${result.ticketId}`);
        });
      }}
    >
      <Field label="What's it about?" htmlFor="support-topic" error={errors.topic}>
        <Combobox
          id="support-topic"
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
      <Field label="Subject" htmlFor="support-subject" error={errors.subject}>
        <Input
          id="support-subject"
          name="subject"
          maxLength={200}
          placeholder="For example: My Amazon payout doesn't match the deposit"
          aria-invalid={Boolean(errors.subject)}
        />
      </Field>
      <Field
        label="Message"
        htmlFor="support-message"
        error={errors.message}
        hint="What you tried, what you expected, and what happened instead. Leave out passwords and keys."
      >
        <Textarea
          id="support-message"
          name="message"
          rows={6}
          maxLength={10000}
          aria-invalid={Boolean(errors.message)}
        />
      </Field>
      {from ? (
        <p className="text-muted-foreground text-xs">
          We'll include the page you came from so we can see what you saw.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Send />}
          Send to support
        </Button>
      </div>
    </form>
  );
}

/** A reply on the ticket's page. */
export function ReplyForm({ slug, ticketId }: { slug: string; ticketId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await replyToTicketAction(slug, { ticketId, message });
          if (!result.ok) {
            setError(result.errors?.message ?? "");
            if (result.message) toast.error(result.message);
            return;
          }
          setMessage("");
          setError("");
          toast.success("Reply sent");
          router.refresh();
        });
      }}
    >
      <Field label="Your reply" htmlFor="support-reply" error={error}>
        <Textarea
          id="support-reply"
          rows={4}
          value={message}
          maxLength={10000}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={Boolean(error)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Send />}
          Send reply
        </Button>
      </div>
    </form>
  );
}

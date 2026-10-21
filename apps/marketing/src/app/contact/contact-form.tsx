"use client";

import { CircleCheck, Send } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { buttonClass } from "@/components/button";
import { type ContactState, TOPICS } from "@/lib/contact";
import { cn, PRIVACY_URL } from "@/lib/site";
import { sendContactMessage } from "./actions";

const FIELD =
  "w-full rounded-lg border bg-background px-3.5 py-2.5 text-base shadow-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 aria-invalid:border-destructive sm:text-sm";

export function ContactForm() {
  const params = useSearchParams();
  const asked = params.get("topic");
  const initialTopic = TOPICS.some((t) => t.id === asked) ? (asked as string) : "question";
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContactMessage, {
    status: "idle",
  });
  // When the form opened: posting faster than a person can type is a bot.
  const [startedAt] = useState(() => Date.now());

  if (state.status === "sent") {
    return (
      <div
        role="status"
        className="fade-in-0 zoom-in-95 grid animate-in justify-items-center gap-3 rounded-2xl border bg-card p-10 text-center shadow-xs"
      >
        <CircleCheck className="size-10 text-success" />
        <h2 className="font-semibold text-xl">Thanks, {state.name}. We've got your message.</h2>
        <p className="max-w-md text-muted-foreground text-sm leading-6">
          A person reads every message, and we'll reply to the email address you gave.
        </p>
      </div>
    );
  }

  const errors = state.status === "error" ? (state.errors ?? {}) : {};
  const values = state.status === "error" ? (state.values ?? {}) : {};

  return (
    <form
      action={action}
      noValidate
      className="grid gap-5 rounded-2xl border bg-card p-6 shadow-xs sm:p-8"
    >
      <input type="hidden" name="startedAt" value={startedAt} />
      {/* A field people don't see; bots fill it in. */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contact-name" label="Your name" error={errors.name}>
          <input
            id="contact-name"
            name="name"
            autoComplete="name"
            defaultValue={values.name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "contact-name-error" : undefined}
            className={FIELD}
          />
        </Field>
        <Field id="contact-email" label="Email" error={errors.email} hint="We reply here.">
          <input
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={values.email}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "contact-email-error" : "contact-email-hint"}
            className={FIELD}
          />
        </Field>
      </div>
      <Field id="contact-company" label="Company (optional)" error={errors.company}>
        <input
          id="contact-company"
          name="company"
          autoComplete="organization"
          defaultValue={values.company}
          aria-invalid={errors.company ? true : undefined}
          className={FIELD}
        />
      </Field>
      <Field id="contact-topic" label="What's it about?" error={errors.topic}>
        <select
          id="contact-topic"
          name="topic"
          defaultValue={values.topic ?? initialTopic}
          aria-invalid={errors.topic ? true : undefined}
          className={cn(FIELD, "appearance-auto")}
        >
          {TOPICS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="contact-message" label="Your message" error={errors.message}>
        <textarea
          id="contact-message"
          name="message"
          rows={6}
          defaultValue={values.message}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "contact-message-error" : undefined}
          className={cn(FIELD, "resize-y")}
        />
      </Field>

      {state.status === "error" && !Object.keys(errors).length ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3.5 py-2.5 text-destructive text-sm"
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
        <button type="submit" disabled={pending} className={buttonClass({ size: "lg" })}>
          {pending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />
          ) : (
            <Send />
          )}
          {pending ? "Sending…" : "Send message"}
        </button>
        <p className="text-muted-foreground text-xs leading-5">
          We use what you send only to reply. See our{" "}
          <a href={PRIVACY_URL} className="underline underline-offset-4 hover:text-foreground">
            privacy policy
          </a>
          .
        </p>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-2">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="fade-in-0 animate-in text-destructive text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

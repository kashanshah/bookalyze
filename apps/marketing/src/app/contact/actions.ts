"use server";

import { headers } from "next/headers";
import {
  type ContactInput,
  type ContactState,
  contactSchema,
  MIN_FORM_MS,
  RATE_LIMIT,
  topicLabel,
} from "@/lib/contact";

/**
 * The contact form: checks the message, then emails it to us through Resend's REST API with the
 * visitor's address as reply-to. Never sends anything to the visitor (that would let anyone send
 * our mail to anyone). Env: RESEND_API_KEY (a sending-only key for bookalyze.com), CONTACT_TO,
 * CONTACT_FROM.
 */

const sent = new Map<string, number[]>();

function limited(ip: string, now: number): boolean {
  const recent = (sent.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    sent.set(ip, recent);
    return true;
  }
  recent.push(now);
  sent.set(ip, recent);
  // Keep the map small: forget addresses with nothing recent.
  if (sent.size > 5_000) {
    for (const [key, times] of sent) {
      if (times.every((t) => now - t >= RATE_LIMIT.windowMs)) sent.delete(key);
    }
  }
  return false;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function sendContactMessage(
  _prev: ContactState,
  form: FormData,
): Promise<ContactState> {
  const values = {
    name: text(form, "name"),
    email: text(form, "email"),
    company: text(form, "company"),
    topic: text(form, "topic"),
    message: text(form, "message"),
  };
  // A bot fills the hidden field, or posts faster than a person can type. Say nothing useful.
  const startedAt = Number(text(form, "startedAt"));
  const now = Date.now();
  if (text(form, "website") || !startedAt || now - startedAt < MIN_FORM_MS) {
    return { status: "sent", name: values.name.trim() || "there" };
  }

  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) {
    const errors: Partial<Record<keyof ContactInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof ContactInput | undefined;
      if (key && !errors[key]) errors[key] = issue.message;
    }
    return { status: "error", message: "Check the highlighted fields.", errors, values };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (limited(ip, now)) {
    return {
      status: "error",
      message: "That's a lot of messages in a short time. Try again in a few minutes.",
      values,
    };
  }

  const result = await deliver(parsed.data);
  if (!result.ok) return { status: "error", message: result.message, values };
  return { status: "sent", name: parsed.data.name };
}

async function deliver(
  input: ContactInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO || "hello@bookalyze.com";
  const from = process.env.CONTACT_FROM || "Bookalyze website <website@bookalyze.com>";
  const subject = `[Website] ${topicLabel(input.topic)}: ${input.name}`;
  const body = [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Company: ${input.company || "(not given)"}`,
    `Topic: ${topicLabel(input.topic)}`,
    "",
    input.message,
  ].join("\n");

  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      // Development: nothing is sent; the message is shown in the terminal instead.
      console.info(
        `[contact] RESEND_API_KEY isn't set, so this wasn't emailed:\n${subject}\n${body}`,
      );
      return { ok: true };
    }
    console.error("[contact] RESEND_API_KEY isn't set: a contact form message couldn't be sent.");
    return {
      ok: false,
      message: "Our contact form isn't set up yet. Please email hello@bookalyze.com instead.",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: input.email, subject, text: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[contact] Resend answered ${response.status}`);
      return { ok: false, message: "We couldn't send your message just now. Please try again." };
    }
    return { ok: true };
  } catch (error) {
    console.error("[contact] Resend couldn't be reached", error);
    return { ok: false, message: "We couldn't send your message just now. Please try again." };
  }
}

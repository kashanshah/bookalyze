import { timingSafeEqual } from "node:crypto";
import { supportTicketLabel } from "@bookalyze/core";
import { createSupportTicket } from "@bookalyze/db";
import { z } from "zod";
import { env } from "@/server/env";
import { logError, logInfo } from "@/server/log";
import { asDesk, emailDesk, newSupportToken } from "@/server/support";

/**
 * The public site's contact form: each enquiry becomes a ticket with no company, for the support
 * desk. The site sends SUPPORT_INTAKE_SECRET as a bearer token; without the variable this
 * endpoint is off. The site keeps its own spam checks; this adds a limit per address.
 */

/** The site's topics; the ticket keeps the nearest of the app's. */
const TOPICS = {
  question: { topic: "question", label: "A question about Bookalyze" },
  help: { topic: "help", label: "Help with my account" },
  coverage: { topic: "coverage", label: "A marketplace or country we don't cover yet" },
  partners: { topic: "other", label: "Partnerships and press" },
  other: { topic: "other", label: "Something else" },
} as const;

const body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  company: z.string().trim().max(160).optional().default(""),
  topic: z.enum(Object.keys(TOPICS) as [keyof typeof TOPICS, ...(keyof typeof TOPICS)[]]),
  message: z.string().trim().min(10).max(5000),
});

const WINDOW_MS = 10 * 60_000;
const PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function allowed(email: string, now = Date.now()) {
  const times = (recent.get(email) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_WINDOW) return false;
  times.push(now);
  recent.set(email, times);
  return true;
}

function authorised(request: Request, secret: string) {
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A subject from the message's first line. */
function subjectOf(message: string, fallback: string) {
  const first =
    message
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "";
  if (!first) return fallback;
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

export async function POST(request: Request) {
  const secret = env().SUPPORT_INTAKE_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  if (!authorised(request, secret)) return new Response("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const input = parsed.data;
  const email = input.email.toLowerCase();
  if (!allowed(email)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const topic = TOPICS[input.topic];
  const text = [
    input.company ? `Company: ${input.company}` : null,
    `Topic: ${topic.label}`,
    "",
    input.message,
  ]
    .filter((line) => line !== null)
    .join("\n");
  try {
    const ticket = await asDesk(null, (tx) =>
      createSupportTicket(tx, {
        orgId: null,
        requesterUserId: null,
        requesterEmail: email,
        requesterName: input.name,
        subject: subjectOf(input.message, topic.label),
        topic: topic.topic,
        body: text,
        source: "website",
        token: newSupportToken(),
      }),
    );
    const label = supportTicketLabel(ticket.number);
    logInfo("support.website_ticket", { ticket: label });
    await emailDesk(
      {
        id: ticket.id,
        number: ticket.number,
        token: ticket.token,
        subject: subjectOf(input.message, topic.label),
        orgName: null,
        orgSlug: null,
        requesterEmail: email,
        requesterName: input.name,
      },
      { kind: "new", authorName: input.name, body: text },
    );
    return Response.json({ ticket: label });
  } catch (error) {
    logError("support.intake_failed", error);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

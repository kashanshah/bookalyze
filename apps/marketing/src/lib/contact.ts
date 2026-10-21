import { z } from "zod";

/** What a visitor can write to us about (the contact form's topic). */
export const TOPICS = [
  { id: "question", label: "A question about Bookalyze" },
  { id: "help", label: "Help with my account" },
  { id: "coverage", label: "A marketplace or country you don't cover yet" },
  { id: "partners", label: "Partnerships and press" },
  { id: "other", label: "Something else" },
] as const;

export type TopicId = (typeof TOPICS)[number]["id"];

export function topicLabel(id: string): string {
  return TOPICS.find((t) => t.id === id)?.label ?? "Something else";
}

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Tell us your name.")
    .max(120, "Keep your name under 120 characters."),
  email: z
    .string()
    .trim()
    .max(200, "Keep the address under 200 characters.")
    .pipe(z.email("Enter an email address we can reply to, like you@example.com.")),
  company: z.string().trim().max(160, "Keep the company name under 160 characters."),
  topic: z.enum(TOPICS.map((t) => t.id) as [TopicId, ...TopicId[]], "Choose what it's about."),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a little more (at least 10 characters).")
    .max(5000, "Keep the message under 5,000 characters."),
});

export type ContactInput = z.infer<typeof contactSchema>;

export type ContactState =
  | { status: "idle" }
  | { status: "sent"; name: string }
  | {
      status: "error";
      message: string;
      errors?: Partial<Record<keyof ContactInput, string>>;
      values?: Partial<Record<keyof ContactInput, string>>;
    };

/** The spam checks: a form filled in faster than this was a bot. */
export const MIN_FORM_MS = 3_000;
/** At most this many messages from one address per window (per server instance, best effort). */
export const RATE_LIMIT = { max: 5, windowMs: 10 * 60_000 } as const;

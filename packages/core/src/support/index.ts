/**
 * Help & support: ticket numbers, statuses in plain words, the reply-by-email address, and
 * cutting the quoted history out of an emailed reply.
 */

export const SUPPORT_TOPIC_LABELS = {
  question: "A question about Bookalyze",
  help: "Help with my account",
  billing: "Billing and plans",
  bug: "Something isn't working",
  coverage: "A marketplace or country you don't cover yet",
  other: "Something else",
} as const;

export type SupportTopic = keyof typeof SUPPORT_TOPIC_LABELS;

export const SUPPORT_STATUS_LABELS = {
  open: "Open",
  waiting_on_us: "Waiting on us",
  waiting_on_you: "Waiting on you",
  solved: "Solved",
  closed: "Closed",
} as const;

export type SupportStatus = keyof typeof SUPPORT_STATUS_LABELS;

/** The desk's word for a status (from its side, "you" is the customer). */
export const SUPPORT_DESK_STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  waiting_on_us: "Needs a reply",
  waiting_on_you: "Waiting on the customer",
  solved: "Solved",
  closed: "Closed",
};

export const SUPPORT_PRIORITY_LABELS = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
} as const;

export type SupportPriority = keyof typeof SUPPORT_PRIORITY_LABELS;

/** Statuses still being worked on. */
export const ACTIVE_SUPPORT_STATUSES: readonly SupportStatus[] = [
  "open",
  "waiting_on_us",
  "waiting_on_you",
];

/** "T-0042". */
export function supportTicketLabel(number: number): string {
  return `T-${String(number).padStart(4, "0")}`;
}

/** Where replies to a ticket's emails go. */
export function supportReplyAddress(token: string, domain: string): string {
  return `support-${token}@${domain}`;
}

/** The ticket token of a support reply address among `texts` (recipients, headers, a whole event). */
export function supportRecipient(texts: readonly string[], domain: string): string | null {
  const escaped = domain.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\bsupport-([a-z0-9]{20,64})@${escaped}`, "i");
  for (const text of texts) {
    const match = pattern.exec(text.toLowerCase());
    if (match?.[1]) return match[1];
  }
  return null;
}

/** The address in "Name <a@b.com>" (lower case), or the text itself when it's a bare address. */
export function emailAddressOf(from: string | null | undefined): string | null {
  if (!from) return null;
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  const bare = angled?.[1] ?? /[^\s<>"]+@[^\s<>"]+/.exec(from)?.[0];
  return bare ? bare.toLowerCase() : null;
}

/** The name in "Name <a@b.com>", or null. */
export function emailNameOf(from: string | null | undefined): string | null {
  if (!from) return null;
  const name = /^\s*"?([^"<]+?)"?\s*</.exec(from)?.[1]?.trim();
  return name || null;
}

/** Lines that start the quoted history in common mail apps. */
const QUOTE_STARTS: readonly RegExp[] = [
  /^On .+wrote:\s*$/i, // Gmail, Apple Mail
  /^Le .+a écrit\s*:\s*$/i,
  /^El .+escribió:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}/i, // Outlook
  /^-{2,}\s*Forwarded message\s*-{2,}/i,
  /^From:\s.+/i, // Outlook's header block
  /^_{10,}\s*$/, // Outlook's rule
  /^Sent from my /i,
  /^--$/, // a signature ("-- ", trimmed)
];

/**
 * The new part of an emailed reply: everything above the quoted history (`>` lines, "On … wrote:",
 * Outlook's "From:" block, a signature). Trimmed; empty when the email only quoted.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Gmail wraps a long "On … wrote:" over two lines.
    const joined = `${line} ${lines[i + 1] ?? ""}`.trim();
    if (line.trimStart().startsWith(">")) break;
    if (QUOTE_STARTS.some((p) => p.test(line.trim()))) break;
    if (/^On\s/i.test(line.trim()) && /wrote:\s*$/i.test(joined)) break;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

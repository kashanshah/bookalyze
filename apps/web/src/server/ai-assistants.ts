import "server-only";
import {
  type AssistantId,
  type AssistantReminder,
  assistantFor,
  assistantReminders,
} from "@bookalyze/core";
import { getDb, listApiKeys } from "@bookalyze/db";
import { cookies } from "next/headers";
import { cache } from "react";
import { env } from "./env";

/** Reminders the person dismissed on this device (see `reminderKey` in core). */
export const DISMISSED_REMINDERS_COOKIE = "bk_ai_reminders";

/** Once per request, however many parts of the page ask. */
const keysOf = cache((userId: string) => listApiKeys(getDb(), userId));

/** An assistant (or other app) a person connected by signing in with Bookalyze. */
export type AssistantConnection = {
  id: string;
  name: string;
  assistant: AssistantId | null;
  access: "read" | "write";
  allCompanies: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

/**
 * The person's live OAuth connections (not plain API keys), newest first. Their own rows only:
 * `listApiKeys` reads through `withUser`, so RLS keeps everyone else's out.
 */
export async function loadAssistantConnections(userId: string): Promise<AssistantConnection[]> {
  const now = Date.now();
  const keys = await keysOf(userId);
  return keys
    .filter((k) => k.clientId && !k.revokedAt && (!k.expiresAt || k.expiresAt.getTime() > now))
    .map((k) => ({
      id: k.id,
      name: k.name,
      assistant: assistantFor(k.name),
      access: k.access,
      allCompanies: k.organizationIds === null,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
    }));
}

/** A reminder ready to show: the dates already worded, so server and browser agree. */
export type AssistantReminderView = Omit<AssistantReminder, "at"> & {
  assistant: AssistantId | null;
  on: string;
};

export async function dismissedReminders(): Promise<Set<string>> {
  const raw = (await cookies()).get(DISMISSED_REMINDERS_COOKIE)?.value ?? "";
  return new Set(raw.split(".").filter(Boolean));
}

/**
 * Assistants whose access ends within a week or has ended (and that the person hasn't
 * reconnected or dismissed), plus whether any ended recently at all, so the "connect an
 * assistant" card doesn't show next to (or instead of) a dismissed reconnect reminder.
 */
export async function loadAssistantReminders(
  userId: string,
  format: { locale?: string; timeZone?: string } = {},
): Promise<{ reminders: AssistantReminderView[]; recentlyEnded: boolean }> {
  const now = new Date();
  const [keys, dismissed] = await Promise.all([keysOf(userId), dismissedReminders()]);
  const day = new Intl.DateTimeFormat(format.locale ?? "en-CA", {
    month: "short",
    day: "numeric",
    timeZone: format.timeZone ?? "UTC",
  });
  return {
    reminders: assistantReminders(keys, now, dismissed).map(({ at, ...r }) => ({
      ...r,
      assistant: assistantFor(r.name),
      on: day.format(at),
    })),
    recentlyEnded: assistantReminders(keys, now).some((r) => r.kind === "ended"),
  };
}

/** Bookalyze's approved directory listings, by assistant (none until each is approved). */
export function assistantListings(): Partial<Record<AssistantId, string>> {
  const e = env();
  return Object.fromEntries(
    [
      ["claude", e.CLAUDE_DIRECTORY_URL],
      ["chatgpt", e.CHATGPT_DIRECTORY_URL],
      ["gemini", e.GEMINI_DIRECTORY_URL],
    ].filter(([, url]) => url),
  );
}

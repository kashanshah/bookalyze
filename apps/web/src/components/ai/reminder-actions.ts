"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { DISMISSED_REMINDERS_COOKIE, dismissedReminders } from "@/server/ai-assistants";
import { requireSession } from "@/server/session";

/** A connection id and which reminder: "s" (access ends soon) or "e" (it ended). */
const keySchema = z.string().regex(/^[0-9a-f-]{36}~[se]$/);

/**
 * Hides one reconnect reminder on this device. A cookie, not a database write: it's a
 * preference about a nudge, and it keeps Neon asleep. The newest 20 are kept.
 */
export async function dismissAssistantReminderAction(key: string): Promise<void> {
  await requireSession();
  const parsed = keySchema.safeParse(key);
  if (!parsed.success) return;
  const kept = [...(await dismissedReminders())].filter((k) => k !== parsed.data).slice(-19);
  (await cookies()).set(DISMISSED_REMINDERS_COOKIE, [...kept, parsed.data].join("."), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });
}

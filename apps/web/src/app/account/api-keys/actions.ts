"use server";

import { ApiKeyError, createApiKey, getDb, revokeApiKey } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentApiPrincipal } from "@/server/api/principal";
import { logInfo } from "@/server/log";
import { listUserOrgs } from "@/server/org";
import { requireSession } from "@/server/session";

const EXPIRY_DAYS = { "30": 30, "90": 90, "365": 365 } as const;

const keySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the key a name, like “Claude Code on my laptop”.")
    .max(80, "Keep the name under 80 characters."),
  access: z.enum(["read", "write"], "Choose what the key may do."),
  companies: z.enum(["all", "chosen"]),
  organizationIds: z.array(z.uuid()).max(200),
  expires: z.enum(["30", "90", "365", "never"]),
});

export type CreateKeyInput = z.input<typeof keySchema>;
export type CreateKeyResult =
  | { ok: true; secret: string; prefix: string }
  | { ok: false; message?: string; errors?: Record<string, string> };

/**
 * Only a person signed in through the browser manages keys: a key can never make, see or revoke
 * keys (so a leaked key can't give itself more reach).
 */
async function browserSession() {
  if (currentApiPrincipal()) throw new Error("API keys are managed in the browser only.");
  return requireSession("/account/api-keys");
}

export async function createApiKeyAction(input: CreateKeyInput): Promise<CreateKeyResult> {
  const session = await browserSession();
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, errors };
  }
  const value = parsed.data;
  let organizationIds: string[] | null = null;
  if (value.companies === "chosen") {
    const mine = new Set((await listUserOrgs(session.user.id)).map((o) => o.id));
    organizationIds = [...new Set(value.organizationIds)].filter((id) => mine.has(id));
    if (!organizationIds.length) {
      return { ok: false, errors: { organizationIds: "Choose at least one company." } };
    }
  }
  const days = value.expires === "never" ? null : EXPIRY_DAYS[value.expires];
  try {
    const made = await createApiKey(getDb(), {
      userId: session.user.id,
      name: value.name,
      access: value.access,
      organizationIds,
      expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
    });
    logInfo("api_key.created", { keyId: made.id, access: value.access });
    revalidatePath("/account/api-keys");
    return { ok: true, secret: made.secret, prefix: made.prefix };
  } catch (error) {
    if (error instanceof ApiKeyError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function revokeApiKeyAction(id: string): Promise<{ ok: boolean; message?: string }> {
  const session = await browserSession();
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Unknown key." };
  const revoked = await revokeApiKey(getDb(), session.user.id, id);
  if (!revoked) return { ok: false, message: "This key was already revoked." };
  logInfo("api_key.revoked", { keyId: id });
  revalidatePath("/account/api-keys");
  return { ok: true };
}

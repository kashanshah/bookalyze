import "server-only";
import { type AssistantId, assistantFor } from "@bookalyze/core";
import { getDb, listApiKeys } from "@bookalyze/db";

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
  const keys = await listApiKeys(getDb(), userId);
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

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { type Database, withUser } from "./client";
import { type ApiKeyAccess, apiKeys } from "./schema/api-keys";

/**
 * API keys (see schema/api-keys.ts). The secret looks like `bka_` + 43 URL-safe characters
 * (32 random bytes). Only its SHA-256 hash is stored: a fast hash is right for a secret with 256
 * bits of entropy (nothing to brute-force), and it lets a request find its key by an index.
 */

export const API_KEY_PREFIX = "bka_";
/** How many live (not revoked) keys one person may have. */
export const MAX_API_KEYS = 25;
const SECRET = /^bka_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): { secret: string; prefix: string; hash: string } {
  const secret = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 12), hash: hashApiKey(secret) };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** True for something shaped like a Bookalyze key (checked before touching the database). */
export function looksLikeApiKey(value: string): boolean {
  return SECRET.test(value);
}

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type ApiKeySummary = Omit<ApiKeyRow, "keyHash">;

export type ResolvedApiKey = {
  id: string;
  userId: string;
  access: ApiKeyAccess;
  /** Null: every company the person belongs to. */
  organizationIds: string[] | null;
};

export type ApiKeyRefusal = "malformed" | "unknown" | "revoked" | "expired";

/**
 * The key behind `secret`, or why it can't be used. Runs as the runtime role through
 * `api_key_lookup()`, which returns only the key with this exact hash.
 */
export async function resolveApiKey(
  db: Database,
  secret: string,
  now = new Date(),
): Promise<{ ok: true; key: ResolvedApiKey } | { ok: false; reason: ApiKeyRefusal }> {
  if (!looksLikeApiKey(secret)) return { ok: false, reason: "malformed" };
  const hash = hashApiKey(secret);
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'app_runtime', true)`);
    const result = await tx.execute<{
      id: string;
      user_id: string;
      access: string;
      organization_ids: string[] | null;
      expires_at: Date | string | null;
      revoked_at: Date | string | null;
    }>(sql`select * from api_key_lookup(${hash})`);
    return result.rows;
  });
  const row = rows[0];
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    key: {
      id: row.id,
      userId: row.user_id,
      access: row.access === "write" ? "write" : "read",
      organizationIds: row.organization_ids ?? null,
    },
  };
}

/** Notes that a key was used (at most once a minute, in the database function). */
export async function touchApiKey(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'app_runtime', true)`);
    await tx.execute(sql`select api_key_touch(${id})`);
  });
}

export async function listApiKeys(db: Database, userId: string): Promise<ApiKeySummary[]> {
  return withUser(db, { userId }, (tx) =>
    tx
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        access: apiKeys.access,
        organizationIds: apiKeys.organizationIds,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt)),
  );
}

export class ApiKeyError extends Error {}

/** Makes a key and returns its secret, which is never available again. */
export async function createApiKey(
  db: Database,
  input: {
    userId: string;
    name: string;
    access: ApiKeyAccess;
    organizationIds: string[] | null;
    expiresAt: Date | null;
  },
): Promise<{ id: string; secret: string; prefix: string }> {
  const { secret, prefix, hash } = generateApiKey();
  const id = await withUser(db, { userId: input.userId }, async (tx) => {
    const [live] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(isNull(apiKeys.revokedAt));
    if ((live?.n ?? 0) >= MAX_API_KEYS) {
      throw new ApiKeyError(
        `You have ${MAX_API_KEYS} keys already. Revoke one you no longer use first.`,
      );
    }
    const [row] = await tx
      .insert(apiKeys)
      .values({
        userId: input.userId,
        name: input.name.trim(),
        prefix,
        keyHash: hash,
        access: input.access,
        organizationIds: input.organizationIds,
        expiresAt: input.expiresAt,
      })
      .returning({ id: apiKeys.id });
    if (!row) throw new ApiKeyError("Could not create the key.");
    return row.id;
  });
  return { id, secret, prefix };
}

/** Revokes one of the person's keys. False when it isn't theirs or is already revoked. */
export async function revokeApiKey(db: Database, userId: string, id: string): Promise<boolean> {
  return withUser(db, { userId }, async (tx) => {
    const rows = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    return rows.length > 0;
  });
}

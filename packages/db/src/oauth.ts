import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { generateApiKey, hashApiKey, MAX_API_KEYS } from "./api-keys";
import { type Database, withUser } from "./client";
import { type ApiKeyAccess, apiKeys, oauthClients, oauthCodes } from "./schema/api-keys";

/**
 * OAuth 2.1 for the API and MCP server ("sign in with Bookalyze" from Claude Code and other MCP
 * clients), on top of API keys: approving an app makes a key with a `client_id` whose secret is
 * the access token. Access tokens last an hour; the refresh token swaps both for new ones, so a
 * leaked access token is short-lived and a used refresh token stops working.
 *
 * PKCE (S256) is required for every app. Most are public clients (no secret); hosted assistants
 * that register as confidential clients also get a secret, checked at the token endpoint. Codes,
 * secrets, access and refresh tokens are 256-bit random values; only SHA-256 hashes are stored.
 */

export const OAUTH_ACCESS_TOKEN_SECONDS = 60 * 60;
export const OAUTH_CODE_SECONDS = 5 * 60;
const REFRESH_PREFIX = "bkr_";
const REFRESH_TOKEN = /^bkr_[A-Za-z0-9_-]{43}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CLIENT_ID = /^bkc_[A-Za-z0-9_-]{22}$/;

export type OAuthClient = typeof oauthClients.$inferSelect;

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const random = () => randomBytes(32).toString("base64url");

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) must equal the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function isPkceChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Registers an app (RFC 7591). Also clears apps nobody approved within a day. */
export async function registerOAuthClient(
  db: Database,
  input: { name: string; redirectUris: string[]; confidential?: boolean },
): Promise<OAuthClient & { secret: string | null }> {
  await db
    .delete(oauthClients)
    .where(
      and(
        isNull(oauthClients.lastUsedAt),
        lt(oauthClients.createdAt, sql`now() - interval '1 day'`),
      ),
    );
  const secret = input.confidential ? `bks_${random()}` : null;
  const [row] = await db
    .insert(oauthClients)
    .values({
      id: `bkc_${randomBytes(16).toString("base64url")}`,
      name: input.name,
      redirectUris: input.redirectUris,
      secretHash: secret ? hash(secret) : null,
    })
    .returning();
  if (!row) throw new Error("Could not register the app.");
  return { ...row, secret };
}

/**
 * Client authentication at the token endpoint (RFC 6749 §2.3). A confidential app must send its
 * secret; a public app has none to send (PKCE protects it). Unknown apps are refused.
 */
export async function authenticateOAuthClient(
  db: Database,
  input: { clientId: string; secret: string | null },
): Promise<OAuthClient> {
  const client = await getOAuthClient(db, input.clientId);
  if (!client) throw new OAuthError("invalid_client", "This app isn't registered with Bookalyze.");
  if (client.secretHash) {
    const given = Buffer.from(hash(input.secret ?? ""));
    const expected = Buffer.from(client.secretHash);
    if (!input.secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new OAuthError("invalid_client", "The app's client secret is missing or wrong.");
    }
  }
  return client;
}

export async function getOAuthClient(db: Database, id: string): Promise<OAuthClient | null> {
  if (!CLIENT_ID.test(id)) return null;
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
  return row ?? null;
}

export type OAuthApproval = {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  access: ApiKeyAccess;
  organizationIds: string[] | null;
  /** Null: until revoked. */
  lifetimeDays: number | null;
};

/** After a person approves: a one-time code for the app, valid for five minutes. */
export async function createAuthorizationCode(db: Database, input: OAuthApproval): Promise<string> {
  const code = random();
  await db.transaction(async (tx) => {
    await tx.delete(oauthCodes).where(lt(oauthCodes.expiresAt, sql`now()`));
    await tx.insert(oauthCodes).values({
      codeHash: hash(code),
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      access: input.access,
      organizationIds: input.organizationIds,
      lifetimeDays: input.lifetimeDays,
      expiresAt: sql`now() + make_interval(secs => ${OAUTH_CODE_SECONDS})`,
    });
    await tx
      .update(oauthClients)
      .set({ lastUsedAt: new Date() })
      .where(eq(oauthClients.id, input.clientId));
  });
  return code;
}

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  access: ApiKeyAccess;
};

export class OAuthError extends Error {
  constructor(
    public readonly error: "invalid_grant" | "invalid_request" | "invalid_client",
    message: string,
  ) {
    super(message);
  }
}

function newTokens() {
  const access = generateApiKey();
  const refreshToken = `${REFRESH_PREFIX}${random()}`;
  return {
    access,
    refreshToken,
    refreshHash: hash(refreshToken),
    tokenExpiresAt: new Date(Date.now() + OAUTH_ACCESS_TOKEN_SECONDS * 1000),
  };
}

/**
 * Exchanges a code for tokens (once: the code is deleted as it's read). The app's earlier
 * connection for this person, if any, is revoked: one live connection per app and person.
 */
export async function exchangeAuthorizationCode(
  db: Database,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): Promise<OAuthTokens> {
  const invalid = () =>
    new OAuthError("invalid_grant", "The code is invalid, expired or already used.");
  if (!CODE.test(input.code)) throw invalid();
  const [grant] = await db
    .delete(oauthCodes)
    .where(eq(oauthCodes.codeHash, hash(input.code)))
    .returning();
  if (!grant || grant.expiresAt.getTime() <= Date.now()) throw invalid();
  if (grant.clientId !== input.clientId || grant.redirectUri !== input.redirectUri) throw invalid();
  if (!pkceMatches(input.codeVerifier, grant.codeChallenge)) {
    throw new OAuthError("invalid_grant", "The code_verifier doesn't match the code_challenge.");
  }
  const client = await getOAuthClient(db, grant.clientId);
  if (!client) throw invalid();

  const tokens = newTokens();
  await withUser(db, { userId: grant.userId }, async (tx) => {
    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.clientId, client.id), isNull(apiKeys.revokedAt)));
    const [live] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(isNull(apiKeys.revokedAt));
    if ((live?.n ?? 0) >= MAX_API_KEYS) {
      throw new OAuthError(
        "invalid_grant",
        `You have ${MAX_API_KEYS} API keys and connected apps already. Revoke one first.`,
      );
    }
    await tx.insert(apiKeys).values({
      userId: grant.userId,
      name: client.name,
      prefix: tokens.access.prefix,
      keyHash: tokens.access.hash,
      access: grant.access,
      organizationIds: grant.organizationIds,
      expiresAt:
        grant.lifetimeDays === null
          ? null
          : new Date(Date.now() + grant.lifetimeDays * 24 * 60 * 60 * 1000),
      clientId: client.id,
      refreshHash: tokens.refreshHash,
      tokenExpiresAt: tokens.tokenExpiresAt,
    });
  });
  return {
    accessToken: tokens.access.secret,
    refreshToken: tokens.refreshToken,
    expiresIn: OAUTH_ACCESS_TOKEN_SECONDS,
    access: grant.access,
  };
}

/** Swaps a refresh token for a new access token and refresh token (the old ones stop working). */
export async function refreshOAuthTokens(
  db: Database,
  input: { refreshToken: string; clientId: string },
): Promise<OAuthTokens> {
  const invalid = () =>
    new OAuthError("invalid_grant", "The refresh token is invalid, revoked or expired.");
  if (!REFRESH_TOKEN.test(input.refreshToken)) throw invalid();
  const tokens = newTokens();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'app_runtime', true)`);
    const result = await tx.execute<{ id: string; user_id: string; access: string }>(
      sql`select * from oauth_refresh(${hash(input.refreshToken)}, ${input.clientId}, ${tokens.access.hash}, ${tokens.access.prefix}, ${tokens.refreshHash}, ${tokens.tokenExpiresAt.toISOString()}::timestamptz)`,
    );
    return result.rows;
  });
  const row = rows[0];
  if (!row) throw invalid();
  return {
    accessToken: tokens.access.secret,
    refreshToken: tokens.refreshToken,
    expiresIn: OAUTH_ACCESS_TOKEN_SECONDS,
    access: row.access === "write" ? "write" : "read",
  };
}

/** RFC 7009: revokes the app's connection holding this access or refresh token, if any. */
export async function revokeOAuthToken(
  db: Database,
  input: { token: string; clientId: string },
): Promise<void> {
  const tokenHash = input.token.startsWith(REFRESH_PREFIX)
    ? hash(input.token)
    : hashApiKey(input.token);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'app_runtime', true)`);
    await tx.execute(sql`select oauth_revoke(${tokenHash}, ${input.clientId})`);
  });
}

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listApiKeys, resolveApiKey } from "../api-keys";
import { createDb } from "../client";
import {
  authenticateOAuthClient,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getOAuthClient,
  type OAuthApproval,
  pkceMatches,
  refreshOAuthTokens,
  registerOAuthClient,
  revokeOAuthToken,
} from "../oauth";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

const REDIRECT = "http://localhost:33418/callback";
const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

let olivia: string;
let clientId: string;

beforeAll(async () => {
  const [row] = await owner.db
    .insert(schema.user)
    .values({ name: "Olivia OAuth", email: "olivia@oauth.test" })
    .returning({ id: schema.user.id });
  olivia = row?.id ?? "";
  clientId = (await registerOAuthClient(app.db, { name: "Claude Code", redirectUris: [REDIRECT] }))
    .id;
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

async function approve(overrides: Partial<OAuthApproval> = {}) {
  const { verifier, challenge } = pkce();
  const code = await createAuthorizationCode(app.db, {
    clientId,
    userId: olivia,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    access: "read",
    organizationIds: null,
    lifetimeDays: 90,
    ...overrides,
  });
  return { code, verifier };
}

describe("PKCE", () => {
  it("accepts only the verifier behind the challenge", () => {
    const { verifier, challenge } = pkce();
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches(pkce().verifier, challenge)).toBe(false);
    expect(pkceMatches("short", challenge)).toBe(false);
  });
});

describe("OAuth connections", () => {
  it("register apps with an unguessable client id", async () => {
    const client = await getOAuthClient(app.db, clientId);
    expect(client?.name).toBe("Claude Code");
    expect(client?.redirectUris).toEqual([REDIRECT]);
    expect(clientId).toMatch(/^bkc_[A-Za-z0-9_-]{22}$/);
    expect(await getOAuthClient(app.db, "bkc_nope")).toBeNull();
  });

  it("exchange a code once, only with its verifier and redirect, for a working token", async () => {
    const orgs = ["00000000-0000-4000-8000-0000000000aa"];
    const { code, verifier } = await approve({ access: "write", organizationIds: orgs });
    // Only hashes are stored.
    const stored = await owner.db.select().from(schema.oauthCodes);
    expect(JSON.stringify(stored)).not.toContain(code);

    await expect(
      exchangeAuthorizationCode(app.db, {
        code,
        clientId,
        redirectUri: REDIRECT,
        codeVerifier: pkce().verifier,
      }),
    ).rejects.toThrow(/code_verifier/);
    // A failed attempt used the code up.
    await expect(
      exchangeAuthorizationCode(app.db, {
        code,
        clientId,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
      }),
    ).rejects.toThrow(/already used/);

    const again = await approve({ access: "write", organizationIds: orgs });
    await expect(
      exchangeAuthorizationCode(app.db, {
        code: again.code,
        clientId,
        redirectUri: "http://localhost:1/elsewhere",
        codeVerifier: again.verifier,
      }),
    ).rejects.toThrow(/invalid/);

    const fresh = await approve({ access: "write", organizationIds: orgs });
    const tokens = await exchangeAuthorizationCode(app.db, {
      code: fresh.code,
      clientId,
      redirectUri: REDIRECT,
      codeVerifier: fresh.verifier,
    });
    expect(tokens.accessToken).toMatch(/^bka_/);
    expect(tokens.refreshToken).toMatch(/^bkr_/);
    expect(tokens.expiresIn).toBe(3600);
    const resolved = await resolveApiKey(app.db, tokens.accessToken);
    expect(resolved).toMatchObject({
      ok: true,
      key: { userId: olivia, access: "write", organizationIds: orgs },
    });
    const listed = await listApiKeys(app.db, olivia);
    expect(listed.find((k) => !k.revokedAt)).toMatchObject({ name: "Claude Code", clientId });
    expect(Object.keys(listed[0] ?? {})).not.toContain("refreshHash");
  });

  it("refresh: new tokens, the old ones stop working, and access tokens expire in an hour", async () => {
    const { code, verifier } = await approve();
    const first = await exchangeAuthorizationCode(app.db, {
      code,
      clientId,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
    });
    expect(
      await resolveApiKey(app.db, first.accessToken, new Date(Date.now() + 2 * 3600_000)),
    ).toEqual({ ok: false, reason: "expired" });

    await expect(
      refreshOAuthTokens(app.db, { refreshToken: first.refreshToken, clientId: "bkc_other" }),
    ).rejects.toThrow(/invalid/);
    const second = await refreshOAuthTokens(app.db, {
      refreshToken: first.refreshToken,
      clientId,
    });
    expect(second.accessToken).not.toBe(first.accessToken);
    expect((await resolveApiKey(app.db, second.accessToken)).ok).toBe(true);
    expect(await resolveApiKey(app.db, first.accessToken)).toEqual({
      ok: false,
      reason: "unknown",
    });
    await expect(
      refreshOAuthTokens(app.db, { refreshToken: first.refreshToken, clientId }),
    ).rejects.toThrow(/invalid/);

    // Revoking (by refresh token) ends the connection.
    await revokeOAuthToken(app.db, { token: second.refreshToken, clientId });
    expect(await resolveApiKey(app.db, second.accessToken)).toEqual({
      ok: false,
      reason: "revoked",
    });
    await expect(
      refreshOAuthTokens(app.db, { refreshToken: second.refreshToken, clientId }),
    ).rejects.toThrow(/invalid/);
  });

  it("authenticate public apps by id and confidential apps by their secret", async () => {
    const pub = await authenticateOAuthClient(app.db, { clientId, secret: null });
    expect(pub.id).toBe(clientId);
    // A public app has no secret: one sent anyway is ignored, PKCE still protects the code.
    await expect(authenticateOAuthClient(app.db, { clientId, secret: "x" })).resolves.toBeTruthy();

    const hosted = await registerOAuthClient(app.db, {
      name: "ChatGPT",
      redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      confidential: true,
    });
    expect(hosted.secret).toMatch(/^bks_[A-Za-z0-9_-]{43}$/);
    const stored = await getOAuthClient(app.db, hosted.id);
    expect(stored?.secretHash).not.toContain(hosted.secret);
    await expect(
      authenticateOAuthClient(app.db, { clientId: hosted.id, secret: hosted.secret }),
    ).resolves.toMatchObject({ name: "ChatGPT" });
    for (const secret of [null, "", `bks_${"A".repeat(43)}`]) {
      await expect(
        authenticateOAuthClient(app.db, { clientId: hosted.id, secret }),
      ).rejects.toMatchObject({ error: "invalid_client" });
    }
    await expect(
      authenticateOAuthClient(app.db, { clientId: `bkc_${"A".repeat(22)}`, secret: null }),
    ).rejects.toMatchObject({ error: "invalid_client" });
  });

  it("keep one live connection per app and person", async () => {
    const connect = async () => {
      const { code, verifier } = await approve();
      return exchangeAuthorizationCode(app.db, {
        code,
        clientId,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
      });
    };
    const a = await connect();
    const b = await connect();
    expect(await resolveApiKey(app.db, a.accessToken)).toEqual({ ok: false, reason: "revoked" });
    expect((await resolveApiKey(app.db, b.accessToken)).ok).toBe(true);
    const live = (await listApiKeys(app.db, olivia)).filter(
      (k) => k.clientId === clientId && !k.revokedAt,
    );
    expect(live).toHaveLength(1);
  });

  it("clear apps nobody approved within a day", async () => {
    const stale = await registerOAuthClient(app.db, {
      name: "Never approved",
      redirectUris: [REDIRECT],
    });
    await owner.db
      .update(schema.oauthClients)
      .set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(schema.oauthClients.id, stale.id));
    await registerOAuthClient(app.db, { name: "Another", redirectUris: [REDIRECT] });
    expect(await getOAuthClient(app.db, stale.id)).toBeNull();
    expect(await getOAuthClient(app.db, clientId)).not.toBeNull();
  });
});

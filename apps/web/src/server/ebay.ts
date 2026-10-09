import "server-only";
import { createHash, createHmac, createVerify, randomBytes, timingSafeEqual } from "node:crypto";
import {
  EBAY_SCOPES,
  EBAY_TOKEN_PATH,
  EBAY_URLS,
  EBAY_USER_PATH,
  type EbayTokens,
  type EbayUser,
  ebayConsentUrl,
  ebayErrorDetail,
  ebayPublicKeyPem,
  parseEbaySignatureHeader,
  parseEbayTokens,
  parseEbayUser,
} from "@bookalyze/core";
import { connectionSecretContext, openSecret, sealSecret } from "@bookalyze/db";
import { env } from "./env";
import { logError, logWarn } from "./log";

/**
 * eBay's REST APIs through Bookalyze's one eBay developer app (keys in env vars). A company
 * connects its own seller account by consent; its refresh token is kept sealed in the vault and
 * access tokens (2 hours) are kept in memory. Responses are parsed in @bookalyze/core; this file
 * only talks HTTP and turns failures into plain words.
 */

export class EbayError extends Error {
  constructor(
    message: string,
    readonly code: "unauthorized" | "forbidden" | "throttled" | "unavailable" | "unexpected",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EbayError";
  }
}

/** The app's keys, or null when this server has none (Connect eBay is then unavailable). */
export function ebayApp() {
  const e = env();
  if (!e.EBAY_CLIENT_ID || !e.EBAY_CLIENT_SECRET || !e.EBAY_RU_NAME) return null;
  const base = EBAY_URLS[e.EBAY_ENVIRONMENT];
  return {
    clientId: e.EBAY_CLIENT_ID,
    clientSecret: e.EBAY_CLIENT_SECRET,
    ruName: e.EBAY_RU_NAME,
    environment: e.EBAY_ENVIRONMENT,
    auth: e.EBAY_AUTH_URL ?? base.auth,
    api: e.EBAY_API_URL ?? base.api,
    apiz: e.EBAY_APIZ_URL ?? base.apiz,
  };
}

type EbayApp = NonNullable<ReturnType<typeof ebayApp>>;

function requireApp(): EbayApp {
  const app = ebayApp();
  if (!app) {
    throw new EbayError(
      "eBay isn't set up on this server yet: its eBay app keys are missing.",
      "unavailable",
    );
  }
  return app;
}

export function ebayConsentLink(state: string): string {
  const app = requireApp();
  return ebayConsentUrl({
    authBase: app.auth,
    clientId: app.clientId,
    ruName: app.ruName,
    state,
  });
}

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    logError("ebay.unreachable", cause, { path: new URL(url).pathname });
    throw new EbayError("eBay couldn't be reached. Try again in a minute.", "unavailable", {
      cause,
    });
  }
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function failed(response: Response, path: string): Promise<never> {
  const body = await json(response);
  const detail = ebayErrorDetail(body);
  logWarn("ebay.request_failed", { path, status: response.status, detail });
  if (response.status === 400 || response.status === 401) {
    throw new EbayError(
      `eBay didn't accept the sign-in${detail ? ` (${detail})` : ""}. Connect eBay again.`,
      "unauthorized",
    );
  }
  if (response.status === 403) {
    throw new EbayError(
      "eBay says this account hasn't allowed that. Connect eBay again and agree to every item.",
      "forbidden",
    );
  }
  if (response.status === 429) {
    throw new EbayError("eBay asked to slow down. Try again in a few minutes.", "throttled");
  }
  throw new EbayError(
    `eBay answered with an error (${response.status})${detail ? `: ${detail}` : ""}.`,
    "unexpected",
  );
}

async function tokenRequest(body: Record<string, string>): Promise<EbayTokens> {
  const app = requireApp();
  const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
  const response = await request(`${app.api}${EBAY_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) return failed(response, EBAY_TOKEN_PATH);
  try {
    return parseEbayTokens(await json(response));
  } catch (cause) {
    throw new EbayError("eBay's answer didn't make sense. Try again.", "unexpected", { cause });
  }
}

/** The code eBay sent back after consent, for the account's tokens. */
export function exchangeEbayCode(code: string): Promise<EbayTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: requireApp().ruName,
  });
}

const accessTokens = new Map<string, { token: string; expires: number }>();
const cacheKey = (refreshToken: string) =>
  createHash("sha256").update(refreshToken).digest("base64url");

/** An access token for a connected account (kept until 5 minutes before eBay's expiry). */
export async function ebayAccessToken(refreshToken: string, fresh = false): Promise<string> {
  const key = cacheKey(refreshToken);
  const cached = accessTokens.get(key);
  if (!fresh && cached && cached.expires > Date.now()) return cached.token;
  const tokens = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: EBAY_SCOPES.join(" "),
  });
  accessTokens.set(key, {
    token: tokens.accessToken,
    expires: Date.now() + Math.max(60, tokens.expiresIn - 300) * 1000,
  });
  return tokens.accessToken;
}

/** Who the connected account is (Commerce Identity API). */
export async function getEbayUser(accessToken: string): Promise<EbayUser> {
  const app = requireApp();
  const response = await request(`${app.apiz}${EBAY_USER_PATH}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return failed(response, EBAY_USER_PATH);
  try {
    return parseEbayUser(await json(response));
  } catch (cause) {
    throw new EbayError("eBay didn't say which account this is. Try again.", "unexpected", {
      cause,
    });
  }
}

// --- Sealed credentials -------------------------------------------------------------------------

export type EbayCredentials = { refreshToken: string; refreshTokenExpiresAt: string | null };

export function sealEbayCredentials(orgId: string, connectionId: string, creds: EbayCredentials) {
  return sealSecret(
    JSON.stringify(creds),
    connectionSecretContext(orgId, connectionId),
    env().APP_ENCRYPTION_KEY,
  );
}

export function openEbayCredentials(
  orgId: string,
  connectionId: string,
  sealed: string,
): EbayCredentials {
  return JSON.parse(
    openSecret(sealed, connectionSecretContext(orgId, connectionId), env().APP_ENCRYPTION_KEY),
  ) as EbayCredentials;
}

// --- Consent state ------------------------------------------------------------------------------

/** The cookie that ties eBay's answer to the browser that asked (with the state's nonce). */
export const EBAY_STATE_COOKIE = "bk_ebay_state";
const STATE_MS = 10 * 60 * 1000;

export type EbayState = { nonce: string; slug: string; channelId: string; userId: string };

const stateMac = (payload: string) =>
  createHmac("sha256", `ebay-state:${env().BETTER_AUTH_SECRET}`)
    .update(payload)
    .digest("base64url");

/** A signed, short-lived state for eBay's consent page, and the nonce for the cookie. */
export function signEbayState(input: Omit<EbayState, "nonce">): { state: string; nonce: string } {
  const nonce = randomBytes(18).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ ...input, nonce, exp: Date.now() + STATE_MS }),
  ).toString("base64url");
  return { state: `${payload}.${stateMac(payload)}`, nonce };
}

/** The state eBay sent back, if it's ours, unaltered and not expired. */
export function readEbayState(state: string | null): EbayState | null {
  if (!state) return null;
  const [payload, mac] = state.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(stateMac(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    const { nonce, slug, channelId, userId } = data;
    if (
      typeof nonce !== "string" ||
      typeof slug !== "string" ||
      typeof channelId !== "string" ||
      typeof userId !== "string"
    ) {
      return null;
    }
    return { nonce, slug, channelId, userId };
  } catch {
    return null;
  }
}

// --- Account-deletion notices -------------------------------------------------------------------

/** Where eBay sends account-deletion notices; registered with eBay exactly like this. */
export function ebayDeletionEndpoint(): string {
  return new URL("/api/ebay/account-deletion", env().BETTER_AUTH_URL).toString();
}

/** eBay's endpoint check: sha256 of the challenge code, our verification token and the URL. */
export function ebayChallengeResponse(challengeCode: string): string | null {
  const token = env().EBAY_VERIFICATION_TOKEN;
  if (!token) return null;
  return createHash("sha256")
    .update(challengeCode)
    .update(token)
    .update(ebayDeletionEndpoint())
    .digest("hex");
}

let appToken: { token: string; expires: number } | null = null;
const publicKeys = new Map<string, string>();

/** An application token (client credentials) for eBay's Notification API. */
async function ebayAppToken(): Promise<string> {
  if (appToken && appToken.expires > Date.now()) return appToken.token;
  const tokens = await tokenRequest({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });
  appToken = {
    token: tokens.accessToken,
    expires: Date.now() + Math.max(60, tokens.expiresIn - 300) * 1000,
  };
  return tokens.accessToken;
}

/**
 * Whether a notice really comes from eBay: its `X-EBAY-SIGNATURE` names one of eBay's public
 * keys (fetched once from the Notification API) and signs the body with it (ECDSA over SHA-1,
 * as eBay does).
 */
export async function verifyEbayNotice(body: string, header: string | null): Promise<boolean> {
  const signature = parseEbaySignatureHeader(header);
  if (!signature) return false;
  try {
    let pem = publicKeys.get(signature.kid);
    if (!pem) {
      const app = requireApp();
      const path = `/commerce/notification/v1/public_key/${encodeURIComponent(signature.kid)}`;
      const response = await request(`${app.api}${path}`, {
        headers: { Authorization: `Bearer ${await ebayAppToken()}` },
      });
      if (!response.ok) return failed(response, path);
      const key = (await json(response)) as { key?: unknown } | null;
      if (!key || typeof key.key !== "string") return false;
      pem = ebayPublicKeyPem(key.key);
      publicKeys.set(signature.kid, pem);
    }
    return createVerify("sha1").update(body).verify(pem, signature.signature, "base64");
  } catch (error) {
    logWarn("ebay.notice_unverified", { kid: signature.kid }, error);
    return false;
  }
}

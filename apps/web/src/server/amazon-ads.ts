import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  type AdType,
  AMAZON_ADS_PROFILES_PATH,
  AMAZON_ADS_REGIONS,
  AMAZON_ADS_REPORTS_PATH,
  type AmazonAdsProfile,
  type AmazonAdsReportStatus,
  type AmazonAdsTokens,
  type AmazonRegion,
  amazonAdsConsentUrl,
  amazonAdsErrorDetail,
  amazonAdsReportRequest,
  duplicateAmazonAdsReportId,
  isAmazonRegion,
  parseAmazonAdsProfiles,
  parseAmazonAdsReportStatus,
  parseAmazonAdsTokens,
} from "@bookalyze/core";
import { connectionSecretContext, openSecret, sealSecret } from "@bookalyze/db";
import { env } from "./env";
import { logError, logWarn, requestIdOf } from "./log";

/**
 * The Amazon Ads API through Bookalyze's one Ads app (keys in env vars), like eBay: a company
 * connects its own ads accounts by consent on Amazon's page, one connection per Ads region; its
 * refresh token is sealed in the vault and access tokens (an hour) are kept in memory. Bookalyze
 * only reads reports. Responses are parsed in @bookalyze/core; this file talks HTTP and turns
 * failures into plain words.
 */

export class AmazonAdsError extends Error {
  constructor(
    message: string,
    readonly code: "unauthorized" | "forbidden" | "throttled" | "unavailable" | "unexpected",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AmazonAdsError";
  }
}

/** The app's keys, or null when this server has none (Connect Amazon Ads is then unavailable). */
export function amazonAdsApp() {
  const e = env();
  if (!e.AMAZON_ADS_CLIENT_ID || !e.AMAZON_ADS_CLIENT_SECRET) return null;
  return {
    clientId: e.AMAZON_ADS_CLIENT_ID,
    clientSecret: e.AMAZON_ADS_CLIENT_SECRET,
    redirectUri: new URL("/api/amazon-ads/callback", e.BETTER_AUTH_URL).toString(),
  };
}

function requireApp() {
  const app = amazonAdsApp();
  if (!app) {
    throw new AmazonAdsError(
      "Amazon Ads isn't set up on this server yet: Bookalyze's Amazon Ads app keys are missing.",
      "unavailable",
    );
  }
  return app;
}

function endpoints(region: AmazonRegion) {
  const e = env();
  const r = AMAZON_ADS_REGIONS[region];
  return {
    auth: e.AMAZON_ADS_AUTH_URL ?? r.auth,
    token: e.AMAZON_ADS_TOKEN_URL ?? r.token,
    api: e.AMAZON_ADS_API_URL ?? r.api,
  };
}

export function amazonAdsConsentLink(region: AmazonRegion, state: string): string {
  const app = requireApp();
  return amazonAdsConsentUrl({
    authBase: endpoints(region).auth,
    clientId: app.clientId,
    redirectUri: app.redirectUri,
    state,
  });
}

async function request(url: string, init: RequestInit, event: string): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    logError(event, cause, { path: new URL(url).pathname });
    throw new AmazonAdsError(
      "Amazon Ads couldn't be reached. Try again in a minute.",
      "unavailable",
      {
        cause,
      },
    );
  }
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function tokenRequest(
  region: AmazonRegion,
  body: Record<string, string>,
): Promise<AmazonAdsTokens> {
  const app = requireApp();
  const response = await request(
    endpoints(region).token,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...body,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      }).toString(),
    },
    "amazon_ads.lwa_unreachable",
  );
  const answer = (await json(response)) as {
    error?: string;
    error_description?: string;
  } | null;
  if (!response.ok) {
    // Amazon's error code and description name the problem; neither carries a credential.
    logWarn("amazon_ads.lwa_refused", {
      status: response.status,
      requestId: requestIdOf(response),
      amazonError: answer?.error,
      amazonDescription: answer?.error_description,
    });
    throw new AmazonAdsError(
      answer?.error === "invalid_client"
        ? "Amazon didn't accept Bookalyze's Amazon Ads app keys. They need checking on this server."
        : "Amazon didn't accept the sign-in to your ads account. Connect Amazon Ads again.",
      "unauthorized",
    );
  }
  try {
    return parseAmazonAdsTokens(answer);
  } catch (cause) {
    throw new AmazonAdsError(
      "Amazon's sign-in answer didn't make sense. Try again.",
      "unexpected",
      {
        cause,
      },
    );
  }
}

/** The code Amazon sent back after consent, for the account's tokens. */
export function exchangeAmazonAdsCode(region: AmazonRegion, code: string) {
  return tokenRequest(region, {
    grant_type: "authorization_code",
    code,
    redirect_uri: requireApp().redirectUri,
  });
}

const accessTokens = new Map<string, { token: string; expires: number }>();

/** An access token for a connected account (kept until 5 minutes before it expires). */
export async function amazonAdsAccessToken(
  region: AmazonRegion,
  refreshToken: string,
  fresh = false,
): Promise<string> {
  const key = createHash("sha256").update(refreshToken).digest("base64url");
  const cached = accessTokens.get(key);
  if (!fresh && cached && cached.expires > Date.now()) return cached.token;
  const tokens = await tokenRequest(region, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  accessTokens.set(key, {
    token: tokens.accessToken,
    expires: Date.now() + Math.max(60, tokens.expiresIn - 300) * 1000,
  });
  return tokens.accessToken;
}

export type AmazonAdsAccount = { region: AmazonRegion; refreshToken: string };

/**
 * A call to the Ads API for a connected account: the response, after an expired access token is
 * renewed once. Refusals become plain words; `allow` lets a caller read some statuses itself.
 */
async function call(
  account: AmazonAdsAccount,
  path: string,
  options: {
    method?: "GET" | "POST";
    profileId?: string;
    body?: unknown;
    contentType?: string;
    allow?: readonly number[];
  } = {},
): Promise<Response> {
  const app = requireApp();
  const base = endpoints(account.region).api;
  let token = await amazonAdsAccessToken(account.region, account.refreshToken);
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Amazon-Advertising-API-ClientId": app.clientId,
      Accept: "application/json",
    };
    if (options.profileId) headers["Amazon-Advertising-API-Scope"] = options.profileId;
    if (options.body !== undefined)
      headers["Content-Type"] = options.contentType ?? "application/json";
    const response = await request(
      `${base}${path}`,
      {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      },
      "amazon_ads.unreachable",
    );
    if (response.ok || options.allow?.includes(response.status)) return response;
    if (response.status === 401 && attempt === 0) {
      token = await amazonAdsAccessToken(account.region, account.refreshToken, true);
      continue;
    }
    const detail = amazonAdsErrorDetail(await json(response));
    logWarn("amazon_ads.request_failed", {
      path: path.split("?")[0],
      region: account.region,
      status: response.status,
      requestId: requestIdOf(response),
      detail,
    });
    if (response.status === 401 || response.status === 403) {
      throw new AmazonAdsError(
        `Amazon refused: this ads account hasn't allowed Bookalyze to read its reports${detail ? ` (${detail})` : ""}. Connect Amazon Ads again with a login that can see this account's ads.`,
        "forbidden",
      );
    }
    if (response.status === 429) {
      throw new AmazonAdsError("Amazon asked to slow down. The next run carries on.", "throttled");
    }
    if (response.status >= 500) {
      throw new AmazonAdsError(
        "Amazon Ads is having trouble. The next run tries again.",
        "unavailable",
      );
    }
    throw new AmazonAdsError(
      `Amazon Ads answered with an error (${response.status})${detail ? `: ${detail}` : ""}.`,
      "unexpected",
    );
  }
}

/** The account's ads profiles (one per marketplace it advertises in). */
export async function amazonAdsProfiles(account: AmazonAdsAccount): Promise<AmazonAdsProfile[]> {
  const response = await call(account, AMAZON_ADS_PROFILES_PATH);
  try {
    return parseAmazonAdsProfiles(await json(response));
  } catch (cause) {
    throw new AmazonAdsError("Amazon's list of ads accounts didn't make sense.", "unexpected", {
      cause,
    });
  }
}

/** Asks Amazon for a report; a request Amazon already has answers with the first one's ID. */
export async function createAmazonAdsReport(
  account: AmazonAdsAccount,
  profileId: string,
  adType: AdType,
  from: string,
  to: string,
): Promise<string> {
  const response = await call(account, AMAZON_ADS_REPORTS_PATH, {
    method: "POST",
    profileId,
    body: amazonAdsReportRequest(adType, from, to),
    contentType: "application/vnd.createasyncreportrequest.v3+json",
    allow: [425],
  });
  const body = await json(response);
  if (response.status === 425) {
    const id = duplicateAmazonAdsReportId(body);
    if (id) return id;
    throw new AmazonAdsError(
      "Amazon is already making this report. The next run collects it.",
      "throttled",
    );
  }
  try {
    return parseAmazonAdsReportStatus(body).reportId;
  } catch (cause) {
    throw new AmazonAdsError(
      "Amazon's answer to the report request didn't make sense.",
      "unexpected",
      {
        cause,
      },
    );
  }
}

export async function amazonAdsReportStatus(
  account: AmazonAdsAccount,
  profileId: string,
  reportId: string,
): Promise<AmazonAdsReportStatus> {
  const response = await call(
    account,
    `${AMAZON_ADS_REPORTS_PATH}/${encodeURIComponent(reportId)}`,
    { profileId },
  );
  try {
    return parseAmazonAdsReportStatus(await json(response));
  } catch (cause) {
    throw new AmazonAdsError("Amazon's report status didn't make sense.", "unexpected", { cause });
  }
}

/** A finished report's file (gzipped JSON, at a short-lived link Amazon gives), as JSON. */
export async function downloadAmazonAdsReport(url: string): Promise<unknown> {
  const response = await request(url, {}, "amazon_ads.download_unreachable");
  if (!response.ok) {
    logWarn("amazon_ads.download_failed", { status: response.status });
    throw new AmazonAdsError(
      "Amazon's report file couldn't be downloaded. The next run tries again.",
      "unavailable",
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  try {
    const text = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString(
      "utf8",
    );
    return JSON.parse(text);
  } catch (cause) {
    throw new AmazonAdsError("Amazon's report file didn't make sense.", "unexpected", { cause });
  }
}

// --- Sealed credentials -------------------------------------------------------------------------

export type AmazonAdsCredentials = { refreshToken: string };

export function sealAmazonAdsCredentials(
  orgId: string,
  connectionId: string,
  creds: AmazonAdsCredentials,
) {
  return sealSecret(
    JSON.stringify(creds),
    connectionSecretContext(orgId, connectionId),
    env().APP_ENCRYPTION_KEY,
  );
}

export function openAmazonAdsCredentials(
  orgId: string,
  connectionId: string,
  sealed: string,
): AmazonAdsCredentials {
  return JSON.parse(
    openSecret(sealed, connectionSecretContext(orgId, connectionId), env().APP_ENCRYPTION_KEY),
  ) as AmazonAdsCredentials;
}

// --- Consent state ------------------------------------------------------------------------------

/** The cookie that ties Amazon's answer to the browser that asked (with the state's nonce). */
export const AMAZON_ADS_STATE_COOKIE = "bk_amazon_ads_state";
const STATE_MS = 10 * 60 * 1000;

export type AmazonAdsState = {
  nonce: string;
  slug: string;
  channelId: string;
  userId: string;
  region: AmazonRegion;
};

const stateMac = (payload: string) =>
  createHmac("sha256", `amazon-ads-state:${env().BETTER_AUTH_SECRET}`)
    .update(payload)
    .digest("base64url");

/** A signed, short-lived state for Amazon's consent page, and the nonce for the cookie. */
export function signAmazonAdsState(input: Omit<AmazonAdsState, "nonce">) {
  const nonce = randomBytes(18).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ ...input, nonce, exp: Date.now() + STATE_MS }),
  ).toString("base64url");
  return { state: `${payload}.${stateMac(payload)}`, nonce };
}

/** The state Amazon sent back, if it's ours, unaltered and not expired. */
export function readAmazonAdsState(state: string | null): AmazonAdsState | null {
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
    const { nonce, slug, channelId, userId, region } = data;
    if (
      typeof nonce !== "string" ||
      typeof slug !== "string" ||
      typeof channelId !== "string" ||
      typeof userId !== "string" ||
      typeof region !== "string" ||
      !isAmazonRegion(region)
    ) {
      return null;
    }
    return { nonce, slug, channelId, userId, region };
  } catch {
    return null;
  }
}

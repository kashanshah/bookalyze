import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import {
  parseWalmartReconDates,
  parseWalmartToken,
  parseWalmartTokenDetail,
  WALMART_API_URL,
  WALMART_TOKEN_DETAIL_PATH,
  WALMART_TOKEN_PATH,
  type WalmartAccess,
  type WalmartCredentials,
  type WalmartScopeArea,
  walmartBasicAuth,
  walmartErrorDetail,
  walmartHeaders,
  walmartReconDatesQuery,
  walmartReconFileQuery,
  zipFirstFile,
} from "@bookalyze/core";
import { env } from "./env";
import { logError, logWarn } from "./log";

/**
 * Walmart's Marketplace API with the company's own API key (client ID and secret). The key is
 * swapped for an access token (15 minutes), kept in memory until shortly before it runs out and
 * sent on every call with Walmart's headers. Responses are parsed in @bookalyze/core; this file
 * only talks HTTP and turns failures into plain words.
 */

export class WalmartError extends Error {
  constructor(
    message: string,
    readonly code: "unauthorized" | "forbidden" | "throttled" | "unavailable" | "unexpected",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WalmartError";
  }
}

const tokens = new Map<string, { token: string; expires: number }>();
const base = () => env().WALMART_API_URL ?? WALMART_API_URL;
/** The cache key: never the secret itself. */
const cacheKey = (creds: WalmartCredentials, market: string) =>
  createHash("sha256").update(`${market}:${creds.clientId}:${creds.clientSecret}`).digest("hex");

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${base()}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    logError("walmart.unreachable", cause, { path, method: init.method ?? "GET" });
    throw new WalmartError("Walmart couldn't be reached. Try again in a minute.", "unavailable", {
      cause,
    });
  }
}

/** Walmart's own words for a failed response, logged with the call's correlation ID. */
async function detail(response: Response, path: string, correlationId: string, market: string) {
  const why = walmartErrorDetail(await response.json().catch(() => null));
  logWarn("walmart.request_failed", {
    path,
    status: response.status,
    correlationId,
    market,
    detail: why,
  });
  return why;
}

async function accessToken(creds: WalmartCredentials, market: string): Promise<string> {
  const key = cacheKey(creds, market);
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now()) return cached.token;
  const correlationId = randomUUID();
  const response = await request(WALMART_TOKEN_PATH, {
    method: "POST",
    headers: {
      ...walmartHeaders({ market, correlationId }),
      Authorization: walmartBasicAuth(creds),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    const why = await detail(response, WALMART_TOKEN_PATH, correlationId, market);
    if (response.status >= 500) {
      throw new WalmartError(
        "Walmart's sign-in service is having trouble. Try again soon.",
        "unavailable",
      );
    }
    if (response.status === 429) {
      throw new WalmartError(
        "Walmart is limiting requests right now. Try again in a minute.",
        "throttled",
      );
    }
    throw new WalmartError(
      `Walmart didn't accept this client ID and secret${why ? ` (${why})` : ""}. Check that both were copied in full from this country's seller account, and that the key hasn't been deleted or replaced in Walmart's Developer Portal.`,
      "unauthorized",
    );
  }
  let parsed: ReturnType<typeof parseWalmartToken>;
  try {
    parsed = parseWalmartToken(await response.json().catch(() => null));
  } catch (cause) {
    logWarn("walmart.no_token", { correlationId, market });
    throw new WalmartError("Walmart answered but sent no access token. Try again.", "unexpected", {
      cause,
    });
  }
  // Renew a minute early, so a call never goes out with a token about to run out.
  tokens.set(key, {
    token: parsed.accessToken,
    expires: Date.now() + Math.max(60, parsed.expiresIn - 60) * 1000,
  });
  return parsed.accessToken;
}

/** One call with a token (a GET unless a JSON body is sent). A token Walmart no longer takes is renewed once. */
async function walmartFetch(
  creds: WalmartCredentials,
  market: string,
  path: string,
  accept = "application/json",
  body?: unknown,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(creds, market);
    const correlationId = randomUUID();
    const response = await request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...walmartHeaders({ market, correlationId, accessToken: token }),
        Accept: accept,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return response;
    if (response.status === 401 && attempt === 0) {
      tokens.delete(cacheKey(creds, market));
      continue;
    }
    const why = await detail(response, path, correlationId, market);
    if (response.status === 401) {
      throw new WalmartError(
        "Walmart stopped accepting this key. Connect it again.",
        "unauthorized",
      );
    }
    if (response.status === 403) {
      throw new WalmartError(
        `Walmart refused the request${why ? ` (${why})` : ""}. In Walmart's Developer Portal, check the key's permissions.`,
        "forbidden",
      );
    }
    if (response.status === 404) {
      throw new WalmartError(
        `Walmart has nothing at this address${why ? ` (${why})` : ""}.`,
        "unexpected",
      );
    }
    if (response.status === 429) {
      throw new WalmartError(
        "Walmart is limiting requests right now. Try again in a minute.",
        "throttled",
      );
    }
    if (response.status >= 500) {
      throw new WalmartError("Walmart is having trouble. Try again soon.", "unavailable");
    }
    throw new WalmartError(
      `Walmart answered with an error (${response.status})${why ? `: ${why}` : ""}.`,
      "unexpected",
    );
  }
}

/** One GET of JSON. */
export async function walmartGet(
  creds: WalmartCredentials,
  market: string,
  path: string,
): Promise<unknown> {
  const response = await walmartFetch(creds, market, path);
  return response.json().catch(() => ({}));
}

/** One POST of JSON, answered with JSON. */
export async function walmartPost(
  creds: WalmartCredentials,
  market: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await walmartFetch(creds, market, path, "application/json", body);
  return response.json().catch(() => ({}));
}

/**
 * Checks a key for one market: a fresh token (so a replaced or deleted key shows up at once),
 * then what the key may do in each area Bookalyze reads.
 */
export async function checkWalmartKey(
  creds: WalmartCredentials,
  market: string,
): Promise<Record<WalmartScopeArea, WalmartAccess>> {
  tokens.delete(cacheKey(creds, market));
  return parseWalmartTokenDetail(await walmartGet(creds, market, WALMART_TOKEN_DETAIL_PATH));
}

/** The dates Walmart has a settlement (reconciliation) report for, newest first. */
export async function walmartSettlementDates(
  creds: WalmartCredentials,
  market: string,
): Promise<string[]> {
  return parseWalmartReconDates(await walmartGet(creds, market, walmartReconDatesQuery()));
}

/**
 * One settlement's report file, as plain bytes: unzipped (its first file) or gunzipped when
 * Walmart sends it packed.
 */
export async function downloadWalmartSettlement(
  creds: WalmartCredentials,
  market: string,
  date: string,
): Promise<Uint8Array> {
  const response = await walmartFetch(
    creds,
    market,
    walmartReconFileQuery(date),
    "application/octet-stream, text/csv, application/json",
  );
  const raw = new Uint8Array(await response.arrayBuffer());
  try {
    if (raw[0] === 0x1f && raw[1] === 0x8b) return new Uint8Array(gunzipSync(raw));
    const first = zipFirstFile(raw);
    if (first) {
      return first.method === 8 ? new Uint8Array(inflateRawSync(first.data)) : first.data;
    }
  } catch (cause) {
    throw new WalmartError("Walmart's report file couldn't be opened. Try again.", "unexpected", {
      cause,
    });
  }
  return raw;
}

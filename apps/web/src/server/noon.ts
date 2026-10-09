import "server-only";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  NOON_API_URL,
  NOON_EXPORT_CATEGORIES_PATH,
  NOON_EXPORT_CREATE_PATH,
  NOON_EXPORT_STATUS_PATH,
  NOON_LOGIN_PATH,
  type NoonCredentials,
  type NoonExportCategory,
  type NoonExportStatus,
  noonCookieHeader,
  noonErrorDetail,
  noonLoginClaims,
  parseExportCategories,
  parseExportCreated,
  parseExportStatus,
} from "@bookalyze/core";
import { env } from "./env";
import { logError, logWarn, requestIdOf } from "./log";

/**
 * Noon's partner API with the company's own service-account key. A login signs a JWT with the
 * key and gets session cookies back; they're kept in memory (for a day, though Noon keeps them
 * for 30) and sent on every call. Responses are parsed in @bookalyze/core; this file only talks
 * HTTP and turns failures into plain words.
 */

export class NoonError extends Error {
  constructor(
    message: string,
    readonly code: "unauthorized" | "forbidden" | "throttled" | "unavailable" | "unexpected",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "NoonError";
  }
}

/** Noon requires a User-Agent naming the application on every request. */
const USER_AGENT = "Bookalyze/1.0";
const SESSION_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, { cookie: string; expires: number }>();

const base = () => env().NOON_API_URL ?? NOON_API_URL;
const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** A login token signed with the key (RS256). */
export function signNoonToken(creds: NoonCredentials, now = new Date()): string {
  const { header, payload } = noonLoginClaims({ keyId: creds.keyId, now, jti: randomUUID() });
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(creds.privateKey);
  } catch {
    throw new NoonError(
      "The key file's private key can't be read. Download a new key for the service account in access.noon.partners → User & Access → API Users.",
      "unauthorized",
    );
  }
  return `${input}.${b64url(sign("RSA-SHA256", Buffer.from(input), key))}`;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${base()}${path}`, {
      ...init,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    logError("noon.unreachable", cause, { path, method: init.method ?? "GET" });
    throw new NoonError("Noon couldn't be reached. Try again in a minute.", "unavailable", {
      cause,
    });
  }
}

/** Noon's own words for a failed response, logged with its request ID (for Noon's support). */
async function detail(response: Response, path: string, projectCode: string) {
  const why = noonErrorDetail(await response.json().catch(() => null));
  logWarn("noon.request_failed", {
    path,
    status: response.status,
    requestId: requestIdOf(response),
    projectCode,
    detail: why,
  });
  return why;
}

async function login(creds: NoonCredentials): Promise<string> {
  const cached = sessions.get(creds.keyId);
  if (cached && cached.expires > Date.now()) return cached.cookie;
  const response = await request(NOON_LOGIN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: signNoonToken(creds), default_project_code: creds.projectCode }),
  });
  if (!response.ok) {
    const why = await detail(response, NOON_LOGIN_PATH, creds.projectCode);
    if (response.status >= 500) {
      throw new NoonError(
        "Noon's sign-in service is having trouble. Try again soon.",
        "unavailable",
      );
    }
    throw new NoonError(
      `Noon didn't accept this key${why ? ` (${why})` : ""}. It may have been deactivated, have expired, or be limited to other IP addresses. Add a new key for the service account in access.noon.partners → User & Access → API Users and upload it here.`,
      "unauthorized",
    );
  }
  const cookie = noonCookieHeader(response.headers.getSetCookie());
  if (!cookie) {
    logWarn("noon.no_session", {
      requestId: requestIdOf(response),
      projectCode: creds.projectCode,
    });
    throw new NoonError("Noon signed in but sent no session. Try again.", "unexpected");
  }
  sessions.set(creds.keyId, { cookie, expires: Date.now() + SESSION_MS });
  return cookie;
}

const FORBIDDEN =
  "Noon refused the request. In access.noon.partners → User & Access → API Users, give the service account a role on this project that can download reports (Project Owner or Project Admin).";

/** One call, signed in. A stale session signs in again once; throttling waits once. */
async function call(
  creds: NoonCredentials,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const cookie = await login(creds);
    const response = await request(path, {
      method: init.method ?? "GET",
      headers: {
        Cookie: cookie,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (response.status === 401 && attempt === 0) {
      sessions.delete(creds.keyId);
      continue;
    }
    if (response.status === 429 && attempt === 0) {
      const wait = Number(response.headers.get("x-ratelimit-retry-after") ?? "2");
      if (wait <= 10) {
        await new Promise((r) => setTimeout(r, Math.max(1, wait) * 1000));
        continue;
      }
    }
    if (response.ok) return response.json().catch(() => ({}));
    const why = await detail(response, path, creds.projectCode);
    if (response.status === 401) {
      sessions.delete(creds.keyId);
      throw new NoonError("Noon ended the session and didn't take the key again.", "unauthorized");
    }
    if (response.status === 403) {
      throw new NoonError(`${FORBIDDEN}${why ? ` Noon said: ${why}` : ""}`, "forbidden");
    }
    if (response.status === 429) {
      throw new NoonError(
        "Noon is limiting requests right now. Try again in a minute.",
        "throttled",
      );
    }
    if (response.status >= 500) {
      throw new NoonError("Noon is having trouble. Try again soon.", "unavailable");
    }
    throw new NoonError(
      `Noon answered with an error (${response.status})${why ? `: ${why}` : ""}.`,
      "unexpected",
    );
  }
}

/**
 * Signs in and lists the reports the key can download: proof the key and its role work.
 * Always a fresh login, so a replaced or deactivated key shows up at once.
 */
export async function checkNoonKey(creds: NoonCredentials): Promise<NoonExportCategory[]> {
  sessions.delete(creds.keyId);
  return parseExportCategories(await call(creds, NOON_EXPORT_CATEGORIES_PATH));
}

/** Asks Noon to make a report (an "export"); it's made in the background. Returns its code. */
export async function createNoonExport(
  creds: NoonCredentials,
  category: string,
  params: Record<string, string>,
): Promise<string> {
  return parseExportCreated(
    await call(creds, NOON_EXPORT_CREATE_PATH, {
      method: "POST",
      body: { export_category_code: category, params },
    }),
  );
}

export async function noonExportStatus(
  creds: NoonCredentials,
  exportCode: string,
): Promise<NoonExportStatus> {
  return parseExportStatus(
    await call(creds, NOON_EXPORT_STATUS_PATH, {
      method: "POST",
      body: { export_code: exportCode },
    }),
  );
}

/** Up to 50 MB: a year of a busy seller's transactions fits easily. */
const MAX_REPORT_BYTES = 50 * 1024 * 1024;

/**
 * Downloads a finished export. The link is usually signed (no session needed); when Noon
 * refuses it, it's tried once more with the session. Gzipped files are unpacked.
 */
export async function downloadNoonExport(
  creds: NoonCredentials,
  url: string,
): Promise<{ bytes: Uint8Array; gzip: boolean; contentType: string }> {
  const get = async (cookie?: string) => {
    try {
      return await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...(cookie ? { Cookie: cookie } : {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
    } catch (cause) {
      logError("noon.export_download_unreachable", cause, { host: new URL(url).host });
      throw new NoonError(
        "Noon's report couldn't be downloaded. Try again in a minute.",
        "unavailable",
        {
          cause,
        },
      );
    }
  };
  let response = await get();
  if (response.status === 401 || response.status === 403) response = await get(await login(creds));
  if (!response.ok) {
    logWarn("noon.export_download_failed", {
      host: new URL(url).host,
      status: response.status,
      requestId: requestIdOf(response),
      projectCode: creds.projectCode,
    });
    throw new NoonError(`Noon's report couldn't be downloaded (${response.status}).`, "unexpected");
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.length > MAX_REPORT_BYTES) {
    throw new NoonError(
      "Noon's report is too large to bring in at once. Choose fewer days.",
      "unexpected",
    );
  }
  const gzip = raw[0] === 0x1f && raw[1] === 0x8b;
  return {
    bytes: gzip ? new Uint8Array(gunzipSync(raw)) : raw,
    gzip,
    contentType: response.headers.get("content-type") ?? "",
  };
}

import "server-only";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import {
  NOON_API_URL,
  NOON_EXPORT_CATEGORIES_PATH,
  NOON_LOGIN_PATH,
  type NoonCredentials,
  type NoonExportCategory,
  noonCookieHeader,
  noonErrorDetail,
  noonLoginClaims,
  parseExportCategories,
} from "@bookalyze/core";
import { env } from "./env";

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
  ) {
    super(message);
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
  } catch {
    throw new NoonError("Noon couldn't be reached. Try again in a minute.", "unavailable");
  }
}

const detail = async (response: Response) =>
  noonErrorDetail(await response.json().catch(() => null));

async function login(creds: NoonCredentials): Promise<string> {
  const cached = sessions.get(creds.keyId);
  if (cached && cached.expires > Date.now()) return cached.cookie;
  const response = await request(NOON_LOGIN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: signNoonToken(creds), default_project_code: creds.projectCode }),
  });
  if (response.status >= 500) {
    throw new NoonError("Noon's sign-in service is having trouble. Try again soon.", "unavailable");
  }
  if (!response.ok) {
    const why = await detail(response);
    throw new NoonError(
      `Noon didn't accept this key${why ? ` (${why})` : ""}. It may have been deactivated, have expired, or be limited to other IP addresses. Add a new key for the service account in access.noon.partners → User & Access → API Users and upload it here.`,
      "unauthorized",
    );
  }
  const cookie = noonCookieHeader(response.headers.getSetCookie());
  if (!cookie) throw new NoonError("Noon signed in but sent no session. Try again.", "unexpected");
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
    const why = await detail(response);
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

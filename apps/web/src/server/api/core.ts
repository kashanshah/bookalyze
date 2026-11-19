import "server-only";
import { type ModuleKey, mayChange } from "@bookalyze/core";
import { getDb, resolveApiKey, schema, touchApiKey } from "@bookalyze/db";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { logError, logWarn } from "../log";
import { getOrgContext, type OrgContext } from "../org";
import { type ApiPrincipal, currentApiPrincipal } from "./principal";

/**
 * The shared core of the public API (/api/v1) and the MCP server (/api/mcp): authentication,
 * company scoping, the operation type, and turning failures into clear, safe errors.
 *
 * Security model:
 * - A request authenticates with `Authorization: Bearer bka_…`. Only the key's SHA-256 hash is
 *   stored; unknown, revoked and expired keys get the same 401.
 * - It then acts as the key's owner (see principal.ts): the same membership checks, roles,
 *   validation, closed periods, reconciliation locks and audit log as the browser.
 * - The key narrows that further: read-only keys can't call any write; a key limited to some
 *   companies gets 404 for every other one (as if it didn't exist).
 * - Modules the company hasn't paid for are read-only through the API too.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type Access = "read" | "write";

export type ApiCall<I> = {
  principal: ApiPrincipal;
  input: I;
  /** The request's own origin (https://app.bookalyze.com), for absolute links. */
  origin: string;
};

export type Operation<S extends z.ZodObject = z.ZodObject> = {
  /** snake_case; the MCP tool name. */
  name: string;
  /** A short human title. */
  title: string;
  /** What it does and when to use it: written for an AI agent choosing a tool. */
  description: string;
  access: Access;
  /** For writes: the module whose paid status decides whether the change is allowed. */
  module?: ModuleKey;
  /** Removes or undoes something (MCP `destructiveHint`). */
  destructive?: boolean;
  /** REST route, e.g. "GET /companies/{company}/transactions". Path names must be input keys. */
  http: string;
  input: S;
  run: (call: ApiCall<z.output<S>>) => Promise<unknown>;
};

export function defineOperation<S extends z.ZodObject>(op: Operation<S>): Operation {
  return op as unknown as Operation;
}

// --- Authentication -------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000;
/** Requests per key per minute, per server instance (a guard against runaway loops). */
export const RATE_LIMIT = 300;
const hits = new Map<string, { start: number; count: number }>();

function rateLimited(keyId: string, now = Date.now()): boolean {
  const entry = hits.get(keyId);
  if (!entry || now - entry.start >= RATE_WINDOW_MS) {
    hits.set(keyId, { start: now, count: 1 });
    if (hits.size > 10_000) hits.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

/** The bearer token in `Authorization`, if any. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/** Resolves the request's API key to the person it acts as, or throws a 401/429. */
export async function authenticate(request: Request): Promise<ApiPrincipal> {
  const token = bearerToken(request);
  if (!token) {
    throw new ApiError(
      401,
      "missing_api_key",
      "Send your Bookalyze API key as `Authorization: Bearer bka_…`. Create one in Bookalyze → Account → API keys.",
    );
  }
  const resolved = await resolveApiKey(getDb(), token);
  if (!resolved.ok) {
    logWarn("api.auth_refused", { reason: resolved.reason });
    throw new ApiError(
      401,
      "unauthorized",
      "This API key isn't valid. It may have been revoked or have expired.",
    );
  }
  const { key } = resolved;
  if (rateLimited(key.id)) {
    throw new ApiError(429, "rate_limited", `Slow down: at most ${RATE_LIMIT} requests a minute.`);
  }
  const [user] = await getDb()
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      emailVerified: schema.user.emailVerified,
      image: schema.user.image,
      createdAt: schema.user.createdAt,
      updatedAt: schema.user.updatedAt,
      twoFactorEnabled: schema.user.twoFactorEnabled,
    })
    .from(schema.user)
    .where(eq(schema.user.id, key.userId));
  if (!user) throw new ApiError(401, "unauthorized", "This API key isn't valid.");
  // Last used, at most once a minute (in the database function); never blocks the request.
  touchApiKey(getDb(), key.id).catch((error) => logWarn("api.touch_failed", {}, error));
  return { key, user };
}

// --- Company scope --------------------------------------------------------------------------

/** True when the key may reach this company at all. */
export function keyAllowsOrg(principal: ApiPrincipal, orgId: string): boolean {
  const ids = principal.key.organizationIds;
  return ids === null || ids.includes(orgId);
}

/**
 * The company `slug` names, as the key's owner sees it: 404 unless they're a member and the key
 * covers it. Writes also need a read-and-write key and the module to be paid for.
 */
export async function companyFor(
  slug: string,
  op: Pick<Operation, "access" | "module">,
): Promise<OrgContext> {
  const principal = currentApiPrincipal();
  if (!principal) throw new ApiError(401, "unauthorized", "Not authenticated.");
  const ctx = await getOrgContext(slug);
  if (!keyAllowsOrg(principal, ctx.org.id)) throw notFoundError();
  if (op.access === "write" && op.module && !mayChange(ctx.billing, op.module)) {
    throw new ApiError(
      403,
      "module_read_only",
      `${ctx.org.name}'s plan doesn't include changes in this part of Bookalyze (${op.module}). It's read-only until it's added in Settings → Billing.`,
    );
  }
  return ctx;
}

export function notFoundError(what = "company") {
  return new ApiError(
    404,
    "not_found",
    `No such ${what}, or this key can't reach it. List what you can reach with list_companies.`,
  );
}

/** Throws 403 unless the key may write. Checked before anything runs. */
export function requireAccess(principal: ApiPrincipal, access: Access) {
  if (access === "write" && principal.key.access !== "write") {
    throw new ApiError(
      403,
      "insufficient_scope",
      "This API key is read-only. Create a key with read and write access to make changes.",
    );
  }
}

// --- Results and failures -------------------------------------------------------------------

type Failure = {
  ok: false;
  message?: string;
  errors?: Record<string, string>;
  lineErrors?: Record<number, string>;
};

function isFailure(value: unknown): value is Failure {
  return Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === false);
}

/**
 * A server action's result as API data: its `{ ok: false, … }` answers (the same messages the
 * screens show next to fields) become a 422 with each field's message.
 */
export function unwrap<T>(result: T): Exclude<T, Failure> {
  if (isFailure(result)) {
    const fields = { ...(result.errors ?? {}) };
    for (const [line, message] of Object.entries(result.lineErrors ?? {})) {
      fields[`lines.${line}`] = message;
    }
    const first = Object.entries(fields)[0];
    throw new ApiError(
      422,
      "invalid_request",
      result.message ?? (first ? `${first[0]}: ${first[1]}` : "That couldn't be saved."),
      Object.keys(fields).length ? { fields } : undefined,
    );
  }
  return result as Exclude<T, Failure>;
}

/** Turns anything thrown into an ApiError, logging what isn't the caller's fault. */
export function toApiError(error: unknown, context: Record<string, unknown>): ApiError {
  if (error instanceof ApiError) return error;
  const digest = (error as { digest?: unknown })?.digest;
  if (typeof digest === "string") {
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return notFoundError("item");
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;403")) {
      return new ApiError(403, "forbidden", "You don't have access to that.");
    }
    if (digest.startsWith("NEXT_REDIRECT")) {
      return new ApiError(
        409,
        "needs_browser",
        "This step needs the Bookalyze app in a browser (it redirects to another page).",
      );
    }
  }
  const reference = crypto.randomUUID().slice(0, 8);
  logError("api.failed", error, { ...context, reference });
  return new ApiError(
    500,
    "internal_error",
    `Something went wrong on our side (reference ${reference}). Check what was saved before trying again.`,
  );
}

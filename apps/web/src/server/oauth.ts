import "server-only";

/**
 * OAuth 2.1 authorization server for the API and MCP server, so Claude Code and other MCP clients
 * can "sign in with Bookalyze" instead of pasting a key (MCP authorization spec 2025-06-18):
 *
 * - /.well-known/oauth-protected-resource[/api/mcp|/api/v1]  (RFC 9728) points at us as the issuer
 * - /.well-known/oauth-authorization-server                 (RFC 8414) lists the endpoints
 * - /oauth/register  dynamic client registration (RFC 7591), public clients only
 * - /oauth/authorize the consent screen: the person picks access, companies and how long
 * - /oauth/token     authorization_code (PKCE S256 required) and refresh_token grants
 * - /oauth/revoke    token revocation (RFC 7009)
 *
 * Everything an approved app does goes through the same API keys machinery (see
 * packages/db/src/oauth.ts), so its scope, companies, audit and revocation work the same way.
 * The issuer is the origin the request came to, so preview deployments work on their own address.
 */

export const OAUTH_SCOPES = ["read", "write"] as const;

/** Where the API and MCP server live; tokens are good for both. */
export const PROTECTED_PATHS = ["/api/mcp", "/api/v1"] as const;

export function originOf(request: Request): string {
  return new URL(request.url).origin;
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: OAUTH_SCOPES,
    authorization_response_iss_parameter_supported: true,
    service_documentation: "https://bookalyze.com/developers",
  };
}

export function protectedResourceMetadata(origin: string, path = "") {
  return {
    resource: `${origin}${path}`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: OAUTH_SCOPES,
    resource_name: "Bookalyze",
    resource_documentation: "https://bookalyze.com/developers",
  };
}

export function resourceMetadataUrl(origin: string, path: (typeof PROTECTED_PATHS)[number]) {
  return `${origin}/.well-known/oauth-protected-resource${path}`;
}

/** RFC 8707: the `resource` an app asks for must be us (the site, the API or the MCP server). */
export function isOurResource(resource: string | null | undefined, origin: string): boolean {
  if (!resource) return true;
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.search || url.hash) return false;
  const path = url.pathname.replace(/\/$/, "");
  return path === "" || PROTECTED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "vbscript:", "about:"]);

/**
 * Redirect URIs an app may register: https anywhere, http only on this computer (loopback, as
 * Claude Code and other desktop clients use), or an app's own scheme (cursor://…). No fragments.
 */
export function redirectUriProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "isn't a valid URL";
  }
  if (url.hash) return "can't have a #fragment";
  if (url.username || url.password) return "can't contain a user name or password";
  if (BLOCKED_SCHEMES.has(url.protocol)) return `can't use ${url.protocol}`;
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    return "must use https (http only for localhost)";
  }
  return null;
}

/**
 * Whether `requested` is one of the app's registered redirect URIs. Exact match, except that a
 * loopback address may use any port (RFC 8252 §7.3: desktop apps pick a free port each time).
 */
export function redirectUriAllowed(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  let want: URL;
  try {
    want = new URL(requested);
  } catch {
    return false;
  }
  if (want.protocol !== "http:" || !LOOPBACK_HOSTS.has(want.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return (
        u.protocol === "http:" &&
        u.hostname === want.hostname &&
        u.pathname === want.pathname &&
        u.search === want.search
      );
    } catch {
      return false;
    }
  });
}

/** Adds the response parameters to the app's redirect URI (keeping any query it already has). */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

/** Answers in OAuth's JSON shape, uncached, readable by browser-based clients. */
export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...CORS,
      ...extra,
    },
  });
}

export function oauthError(error: string, description: string, status = 400) {
  return oauthJson({ error, error_description: description }, status);
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Form (or JSON) body of a token, registration or revocation request, as plain strings. */
export async function readParams(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.text();
  if (text.length > 64_000) return null;
  if (type.includes("application/json")) {
    try {
      const body = JSON.parse(text) as unknown;
      return body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

// A small per-instance limit on anonymous endpoints (registration, token), per address.
const hits = new Map<string, { count: number; resetAt: number }>();
export function tooMany(request: Request, bucket: string, limit: number, windowMs: number) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const hit = hits.get(key);
  if (!hit || hit.resetAt <= now) {
    if (hits.size > 10_000) hits.clear();
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  hit.count += 1;
  return hit.count > limit;
}

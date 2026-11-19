import { getDb, registerOAuthClient } from "@bookalyze/db";
import { z } from "zod";
import { logInfo } from "@/server/log";
import {
  CLIENT_AUTH_METHODS,
  oauthError,
  oauthJson,
  preflight,
  readParams,
  redirectUriProblem,
  tooMany,
} from "@/server/oauth";

/**
 * Dynamic client registration (RFC 7591), as MCP clients do on first connect: Claude Code,
 * Claude, ChatGPT, Gemini, Cursor, VS Code… Public clients get no secret and rely on PKCE; an app
 * that asks for client_secret_post/basic also gets a secret, checked at the token endpoint. PKCE
 * is required either way. Registering grants nothing on its own: a person approves each app on
 * the consent screen.
 *
 * Lenient where it's safe (RFC 7591 §3.2.1 lets the server replace what it doesn't support):
 * unknown fields, scopes and extra grant or response types are dropped, and the response says
 * what was actually registered.
 */
const schema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
  token_endpoint_auth_method: z.string().max(100).optional(),
  grant_types: z.array(z.string().max(200)).max(20).optional(),
  response_types: z.array(z.string().max(200)).max(20).optional(),
});

export async function POST(request: Request) {
  if (tooMany(request, "oauth-register", 20, 60 * 60 * 1000)) {
    return oauthError("slow_down", "Too many apps registered from here. Try again later.", 429);
  }
  const params = await readParams(request);
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") ?? "body";
    return oauthError("invalid_client_metadata", `${field}: ${issue?.message ?? "invalid"}`);
  }
  const body = parsed.data;
  for (const uri of body.redirect_uris) {
    const problem = redirectUriProblem(uri);
    if (problem) return oauthError("invalid_redirect_uri", `${uri} ${problem}.`);
  }
  const method = body.token_endpoint_auth_method ?? "none";
  if (!(CLIENT_AUTH_METHODS as readonly string[]).includes(method)) {
    return oauthError(
      "invalid_client_metadata",
      `token_endpoint_auth_method must be one of ${CLIENT_AUTH_METHODS.join(", ")}.`,
    );
  }
  if (body.grant_types && !body.grant_types.includes("authorization_code")) {
    return oauthError(
      "invalid_client_metadata",
      "Bookalyze issues tokens with the authorization_code grant (and refresh_token).",
    );
  }
  if (body.response_types && !body.response_types.includes("code")) {
    return oauthError("invalid_client_metadata", 'Only response_type "code" is supported.');
  }
  const client = await registerOAuthClient(getDb(), {
    name: body.client_name || "An unnamed app",
    redirectUris: body.redirect_uris,
    confidential: method !== "none",
  });
  logInfo("oauth.client_registered", { clientId: client.id });
  return oauthJson(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: method,
      ...(client.secret ? { client_secret: client.secret, client_secret_expires_at: 0 } : {}),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

export const OPTIONS = preflight;

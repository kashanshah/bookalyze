import { getDb, registerOAuthClient } from "@bookalyze/db";
import { z } from "zod";
import { logInfo } from "@/server/log";
import {
  oauthError,
  oauthJson,
  preflight,
  readParams,
  redirectUriProblem,
  tooMany,
} from "@/server/oauth";

/**
 * Dynamic client registration (RFC 7591), as MCP clients do on first connect. Public clients
 * only: no secret is issued, and PKCE protects the code exchange. Registering grants nothing on
 * its own; a person approves each app on the consent screen.
 */
const schema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
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
    if (field.startsWith("token_endpoint_auth_method")) {
      return oauthError(
        "invalid_client_metadata",
        'Only public clients are supported: use token_endpoint_auth_method "none" with PKCE.',
      );
    }
    return oauthError("invalid_client_metadata", `${field}: ${issue?.message ?? "invalid"}`);
  }
  const body = parsed.data;
  for (const uri of body.redirect_uris) {
    const problem = redirectUriProblem(uri);
    if (problem) return oauthError("invalid_redirect_uri", `${uri} ${problem}.`);
  }
  const grants = body.grant_types ?? ["authorization_code", "refresh_token"];
  if (grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return oauthError(
      "invalid_client_metadata",
      "Only the authorization_code and refresh_token grants are supported.",
    );
  }
  if ((body.response_types ?? ["code"]).some((t) => t !== "code")) {
    return oauthError("invalid_client_metadata", 'Only response_type "code" is supported.');
  }
  const client = await registerOAuthClient(getDb(), {
    name: body.client_name || "An unnamed app",
    redirectUris: body.redirect_uris,
  });
  logInfo("oauth.client_registered", { clientId: client.id });
  return oauthJson(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

export const OPTIONS = preflight;

import {
  authenticateOAuthClient,
  exchangeAuthorizationCode,
  getDb,
  OAuthError,
  type OAuthTokens,
  refreshOAuthTokens,
} from "@bookalyze/db";
import { logError, logInfo } from "@/server/log";
import {
  clientCredentials,
  isOurResource,
  oauthError,
  oauthJson,
  originOf,
  preflight,
  readParams,
  tooMany,
} from "@/server/oauth";

/** The token endpoint: a code (with its PKCE verifier) or a refresh token, for new tokens. */
export async function POST(request: Request) {
  if (tooMany(request, "oauth-token", 120, 60 * 1000)) {
    return oauthError("slow_down", "Too many token requests. Try again in a minute.", 429);
  }
  const params = await readParams(request);
  if (!params) return oauthError("invalid_request", "Send the parameters as a form.");
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const credentials = clientCredentials(request, params);
  if (!credentials) return oauthError("invalid_client", "client_id is required.", 401);
  const { clientId } = credentials;
  if (!isOurResource(str("resource") || null, originOf(request))) {
    return oauthError("invalid_target", "Tokens are only issued for Bookalyze.");
  }
  const db = getDb();
  try {
    await authenticateOAuthClient(db, credentials);
    let tokens: OAuthTokens;
    const grant = str("grant_type");
    if (grant === "authorization_code") {
      if (!str("code") || !str("redirect_uri") || !str("code_verifier")) {
        return oauthError("invalid_request", "code, redirect_uri and code_verifier are required.");
      }
      tokens = await exchangeAuthorizationCode(db, {
        code: str("code"),
        clientId,
        redirectUri: str("redirect_uri"),
        codeVerifier: str("code_verifier"),
      });
      logInfo("oauth.token_issued", { clientId });
    } else if (grant === "refresh_token") {
      if (!str("refresh_token")) return oauthError("invalid_request", "refresh_token is required.");
      tokens = await refreshOAuthTokens(db, { refreshToken: str("refresh_token"), clientId });
    } else {
      return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
    }
    return oauthJson({
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.access === "write" ? "read write" : "read",
    });
  } catch (error) {
    if (error instanceof OAuthError) {
      if (error.error === "invalid_client") {
        return oauthError(error.error, error.message, 401, {
          "WWW-Authenticate": 'Basic realm="Bookalyze"',
        });
      }
      return oauthError(error.error, error.message);
    }
    logError("oauth.token_failed", error, { clientId });
    return oauthError("server_error", "Something went wrong on our side.", 500);
  }
}

export const OPTIONS = preflight;

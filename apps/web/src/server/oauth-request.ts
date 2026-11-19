import "server-only";
import { getDb, getOAuthClient, isPkceChallenge, type OAuthClient } from "@bookalyze/db";
import { headers } from "next/headers";
import { isOurResource, redirectUriAllowed, redirectWith } from "./oauth";

/** The parameters of an authorization request (/oauth/authorize?…). */
export type AuthorizeParams = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
};

export type CheckedRequest =
  | {
      ok: true;
      client: OAuthClient;
      redirectUri: string;
      codeChallenge: string;
      state: string | undefined;
      /** The app asked to write (scope "write"); the person still chooses. */
      wantsWrite: boolean;
      origin: string;
    }
  /** Can't safely send the person back to the app: show this on the page. */
  | { ok: false; show: string }
  /** The app made a mistake it should hear about: send the person back with this error. */
  | { ok: false; redirect: string };

/** This site's origin as the person's browser sees it (the issuer, like the metadata routes). */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "app.bookalyze.com";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Checks an authorization request. The app and its redirect URI are checked first: until both are
 * known good, nothing redirects anywhere (no open redirects). After that, mistakes go back to the
 * app as OAuth errors.
 */
export async function checkAuthorizeRequest(params: AuthorizeParams): Promise<CheckedRequest> {
  const client = params.client_id ? await getOAuthClient(getDb(), params.client_id) : null;
  if (!client) {
    return {
      ok: false,
      show: "The app that sent you here isn't registered with Bookalyze. Start connecting again from the app.",
    };
  }
  const redirectUri = params.redirect_uri ?? "";
  if (!redirectUri || !redirectUriAllowed(redirectUri, client.redirectUris)) {
    return {
      ok: false,
      show: "The app asked to send you back to an address it didn't register. Start connecting again from the app.",
    };
  }
  const origin = await requestOrigin();
  const back = (error: string, description: string) => ({
    ok: false as const,
    redirect: redirectWith(redirectUri, {
      error,
      error_description: description,
      state: params.state,
      iss: origin,
    }),
  });
  if (params.response_type !== "code") {
    return back("unsupported_response_type", 'Only response_type "code" is supported.');
  }
  if (params.code_challenge_method !== "S256" || !isPkceChallenge(params.code_challenge ?? "")) {
    return back("invalid_request", "PKCE with code_challenge_method S256 is required.");
  }
  if (!isOurResource(params.resource, origin)) {
    return back("invalid_target", "Tokens are only issued for Bookalyze.");
  }
  // Scopes we don't know (openid, profile…) are ignored, not refused: the person chooses the
  // access on the consent screen, and the token response says what was granted.
  const scopes = (params.scope ?? "").split(/\s+/).filter(Boolean);
  return {
    ok: true,
    client,
    redirectUri,
    codeChallenge: params.code_challenge ?? "",
    state: params.state,
    wantsWrite: scopes.includes("write"),
    origin,
  };
}

/** Where the person goes back to, for the consent screen ("localhost:33418", "cursor://"). */
export function returnPlace(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === "http:" || url.protocol === "https:" ? url.host : `${url.protocol}//`;
}

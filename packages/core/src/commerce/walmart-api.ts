/**
 * Walmart Marketplace API (developer.walmart.com). A seller makes API keys in Walmart's
 * Developer Portal (signed in with their Seller Center account): a client ID and a client
 * secret. Each key belongs to one Walmart seller account, and a seller's US, Canada and Mexico
 * accounts are separate, so a key works for one market. Bookalyze swaps the key for an access
 * token (client credentials grant, 15 minutes) and sends it on every call with Walmart's other
 * headers. The HTTP side lives in the web app (server/walmart.ts); this file only shapes data.
 */

export const WALMART_API_URL = "https://marketplace.walmartapis.com";
export const WALMART_TOKEN_PATH = "/v3/token";
export const WALMART_TOKEN_DETAIL_PATH = "/v3/token/detail";
/** Walmart names the calling service on every request. */
export const WALMART_SERVICE_NAME = "Walmart Marketplace";

/** What Bookalyze keeps (sealed) for a Walmart seller account. */
export type WalmartCredentials = { clientId: string; clientSecret: string };

const KEY_HELP =
  "Copy them from Walmart's Developer Portal (developer.walmart.com), signed in with your Seller Center account, where you manage API keys.";

/** Checks a pasted client ID and secret; throws, in plain words, when they can't be right. */
export function parseWalmartCredentials(input: {
  clientId: string;
  clientSecret: string;
}): WalmartCredentials {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!clientId || !clientSecret) {
    throw new Error(`Enter both the client ID and the client secret. ${KEY_HELP}`);
  }
  if (/\s/.test(clientId) || /\s/.test(clientSecret)) {
    throw new Error(`The client ID and secret have no spaces in them. ${KEY_HELP}`);
  }
  if (clientId.length > 200 || clientSecret.length > 500) {
    throw new Error(`That's too long to be a Walmart API key. ${KEY_HELP}`);
  }
  return { clientId, clientSecret };
}

/** The headers every Walmart call carries. `market` is us, ca or mx. */
export function walmartHeaders(input: {
  market: string;
  correlationId: string;
  accessToken?: string;
}): Record<string, string> {
  return {
    Accept: "application/json",
    "WM_SVC.NAME": WALMART_SERVICE_NAME,
    "WM_QOS.CORRELATION_ID": input.correlationId,
    WM_MARKET: input.market,
    ...(input.accessToken ? { "WM_SEC.ACCESS_TOKEN": input.accessToken } : {}),
  };
}

/** The Basic authorization for the token call: the client ID and secret, base64. */
export function walmartBasicAuth(creds: WalmartCredentials): string {
  const raw = `${creds.clientId}:${creds.clientSecret}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

/** Reads the token call's answer: the access token and how many seconds it lasts. */
export function parseWalmartToken(json: unknown): { accessToken: string; expiresIn: number } {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("Walmart's answer had no access token.");
  const seconds = Number(body.expires_in);
  return { accessToken, expiresIn: Number.isFinite(seconds) && seconds > 0 ? seconds : 900 };
}

/** How much a key may do in one area of the API. */
export type WalmartAccess = "full_access" | "view_only" | "no_access";

/** The areas Bookalyze reads, in the words shown to people ("For bringing in orders"). */
export const WALMART_SCOPE_AREAS = [
  { key: "orders", label: "Orders", needed: "bringing in orders" },
  { key: "reports", label: "Reports", needed: "bringing in settlements and fees" },
  { key: "inventory", label: "Inventory", needed: "seeing your stock at Walmart" },
] as const;

export type WalmartScopeArea = (typeof WALMART_SCOPE_AREAS)[number]["key"];

/**
 * Reads the token-detail answer: what the key may do in each area (scopes, keyed by area in
 * lower case). Areas Walmart leaves out count as no access.
 */
export function parseWalmartTokenDetail(json: unknown): Record<WalmartScopeArea, WalmartAccess> {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const raw =
    body.scopes && typeof body.scopes === "object" ? (body.scopes as Record<string, unknown>) : {};
  const scopes: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") scopes[k.toLowerCase()] = v.toLowerCase();
  }
  const access = (...keys: string[]): WalmartAccess => {
    for (const k of keys) {
      const v = scopes[k];
      if (v === "full_access" || v === "view_only" || v === "no_access") return v;
    }
    return "no_access";
  };
  return {
    orders: access("orders", "order"),
    reports: access("reports", "report"),
    inventory: access("inventory"),
  };
}

/** The areas a key can't read but Bookalyze needs, in people's words. */
export function missingWalmartAccess(scopes: Record<WalmartScopeArea, WalmartAccess>) {
  return WALMART_SCOPE_AREAS.filter((a) => scopes[a.key] === "no_access");
}

/**
 * Walmart's own words for a failed call. Its errors come as `{ error: [{ code, description,
 * info }] }`, sometimes `{ errors: { error: [...] } }` or OAuth's `{ error, error_description }`.
 */
export function walmartErrorDetail(json: unknown): string | null {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (!body) return null;
  if (typeof body.error_description === "string") return body.error_description;
  const nested =
    body.errors && typeof body.errors === "object"
      ? (body.errors as Record<string, unknown>).error
      : undefined;
  const list = Array.isArray(body.error) ? body.error : Array.isArray(nested) ? nested : [];
  const first = list.find((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object");
  if (first) {
    const text = [first.description, first.info, first.code].find(
      (v): v is string => typeof v === "string" && v.trim() !== "",
    );
    if (text) return text.trim();
  }
  if (typeof body.error === "string") return body.error;
  return null;
}

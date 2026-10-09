/**
 * eBay's REST APIs, the parts that don't talk HTTP: where to send a seller to agree, what eBay's
 * answers mean, and how to answer eBay's account-deletion check. Bookalyze is one eBay developer
 * app; each company connects its own seller account by consent (OAuth 2 authorization code grant)
 * and gets its own refresh token.
 */

export type EbayEnvironment = "production" | "sandbox";

export const EBAY_URLS: Record<EbayEnvironment, { auth: string; api: string; apiz: string }> = {
  production: {
    auth: "https://auth.ebay.com",
    api: "https://api.ebay.com",
    apiz: "https://apiz.ebay.com",
  },
  sandbox: {
    auth: "https://auth.sandbox.ebay.com",
    api: "https://api.sandbox.ebay.com",
    apiz: "https://apiz.sandbox.ebay.com",
  },
};

export const EBAY_CONSENT_PATH = "/oauth2/authorize";
export const EBAY_TOKEN_PATH = "/identity/v1/oauth2/token";
export const EBAY_USER_PATH = "/commerce/identity/v1/user/";

/**
 * What a company agrees to: reading its orders, its money (transactions and payouts), its
 * account settings, and who it is. Nothing that changes a listing or an order.
 */
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
] as const;

/** eBay's consent page for a seller. `ruName` is the app's redirect name, not a URL. */
export function ebayConsentUrl(input: {
  authBase: string;
  clientId: string;
  ruName: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(EBAY_CONSENT_PATH, input.authBase);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (input.scopes ?? EBAY_SCOPES).join(" "));
  url.searchParams.set("state", input.state);
  return url.toString();
}

export type EbayTokens = {
  accessToken: string;
  /** Seconds. */
  expiresIn: number;
  /** Only when a code is exchanged (refreshing keeps the same refresh token). */
  refreshToken: string | null;
  refreshTokenExpiresIn: number | null;
};

/** The token endpoint's answer. */
export function parseEbayTokens(json: unknown): EbayTokens {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("eBay didn't send an access token.");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    accessToken,
    expiresIn: num(body.expires_in) ?? 7200,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    refreshTokenExpiresIn: num(body.refresh_token_expires_in),
  };
}

export type EbayUser = {
  /** eBay's immutable user id (what account-deletion notices name). */
  userId: string;
  username: string;
  accountType: string | null;
  /** The eBay site the account was registered on, e.g. EBAY_CA. */
  registrationMarketplaceId: string | null;
};

/** Commerce Identity API `getUser`. */
export function parseEbayUser(json: unknown): EbayUser {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const userId = str(body.userId);
  const username = str(body.username);
  if (!userId || !username) throw new Error("eBay didn't say which account this is.");
  return {
    userId,
    username,
    accountType: str(body.accountType),
    registrationMarketplaceId: str(body.registrationMarketplaceId),
  };
}

/**
 * eBay's reason for refusing, in its words: OAuth errors (`error`, `error_description`) or REST
 * errors (`errors[].longMessage` / `message`).
 */
export function ebayErrorDetail(json: unknown): string | null {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (typeof body.error === "string") {
    const description =
      typeof body.error_description === "string" ? body.error_description.trim() : "";
    return description ? `${body.error}: ${description}` : body.error;
  }
  if (Array.isArray(body.errors)) {
    const first = body.errors[0] && typeof body.errors[0] === "object" ? body.errors[0] : {};
    const e = first as Record<string, unknown>;
    const text = [e.longMessage, e.message].find((v) => typeof v === "string" && v.trim());
    return typeof text === "string" ? text.trim().slice(0, 300) : null;
  }
  return null;
}

/** An account-deletion notice's subject: the eBay user to forget. */
export function parseEbayDeletionNotice(
  json: unknown,
): { userId: string; username: string | null } | null {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const metadata =
    body.metadata && typeof body.metadata === "object"
      ? (body.metadata as Record<string, unknown>)
      : {};
  if (metadata.topic !== "MARKETPLACE_ACCOUNT_DELETION") return null;
  const notification =
    body.notification && typeof body.notification === "object"
      ? (body.notification as Record<string, unknown>)
      : {};
  const data =
    notification.data && typeof notification.data === "object"
      ? (notification.data as Record<string, unknown>)
      : {};
  if (typeof data.userId !== "string" || !data.userId) return null;
  return {
    userId: data.userId,
    username: typeof data.username === "string" ? data.username : null,
  };
}

/** The `X-EBAY-SIGNATURE` header: base64 JSON naming the key and holding the signature. */
export function parseEbaySignatureHeader(
  header: string | null,
): { kid: string; signature: string; alg: string | null } | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(atob(header.trim())) as Record<string, unknown>;
    if (typeof decoded.kid !== "string" || typeof decoded.signature !== "string") return null;
    return {
      kid: decoded.kid,
      signature: decoded.signature,
      alg: typeof decoded.alg === "string" ? decoded.alg : null,
    };
  } catch {
    return null;
  }
}

/**
 * eBay's public keys come as one line ("-----BEGIN PUBLIC KEY-----MFkw…-----END PUBLIC KEY-----");
 * PEM readers want the body on lines of its own.
 */
export function ebayPublicKeyPem(key: string): string {
  const body = key
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

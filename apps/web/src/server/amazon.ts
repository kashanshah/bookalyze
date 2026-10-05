import "server-only";
import {
  AMAZON_LWA_TOKEN_URL,
  AMAZON_REGIONS,
  type AmazonRegion,
  type MarketplaceParticipation,
  parseMarketplaceParticipations,
} from "@bookalyze/core";
import { env } from "./env";

/**
 * Amazon's Selling Partner API, with the company's own developer app ("bring your own app"):
 * the app's LWA client ID and secret plus the seller's refresh token. Each call exchanges the
 * refresh token for a short-lived access token (kept in memory until it expires). Responses are
 * parsed in @bookalyze/core; this file only talks HTTP and turns failures into plain words.
 */

export type AmazonCredentials = { clientId: string; clientSecret: string; refreshToken: string };

export class AmazonError extends Error {
  constructor(
    message: string,
    readonly code: "unauthorized" | "forbidden" | "unavailable" | "unexpected",
  ) {
    super(message);
  }
}

const tokens = new Map<string, { token: string; expires: number }>();

async function accessToken(creds: AmazonCredentials): Promise<string> {
  const cached = tokens.get(creds.refreshToken);
  if (cached && cached.expires > Date.now()) return cached.token;
  let response: Response;
  try {
    response = await fetch(env().AMAZON_LWA_URL ?? AMAZON_LWA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AmazonError("Amazon couldn't be reached. Try again in a minute.", "unavailable");
  }
  if (response.status >= 500) {
    throw new AmazonError(
      "Amazon's sign-in service is having trouble. Try again soon.",
      "unavailable",
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new AmazonError(
      body.error === "invalid_client"
        ? "Amazon didn't accept the app's client ID or client secret. Copy them again from Seller Central → Develop Apps."
        : "Amazon didn't accept the refresh token. Authorize the app again in Seller Central and paste the new token.",
      "unauthorized",
    );
  }
  tokens.set(creds.refreshToken, {
    token: body.access_token,
    expires: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000,
  });
  return body.access_token;
}

async function call(
  creds: AmazonCredentials,
  region: AmazonRegion,
  path: string,
): Promise<unknown> {
  const token = await accessToken(creds);
  const base =
    env().AMAZON_SPAPI_URL ?? AMAZON_REGIONS.find((r) => r.key === region)?.endpoint ?? "";
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      headers: { "x-amz-access-token": token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AmazonError("Amazon couldn't be reached. Try again in a minute.", "unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    throw new AmazonError(
      "Amazon refused the request. Check the app is authorized for this seller account and region, and has the roles it needs (Selling Partner Insights, Inventory and Order Tracking, Buyer Communication).",
      "forbidden",
    );
  }
  if (response.status === 429 || response.status >= 500) {
    throw new AmazonError("Amazon is busy right now. We'll try again shortly.", "unavailable");
  }
  if (!response.ok) {
    throw new AmazonError(`Amazon answered with an error (${response.status}).`, "unexpected");
  }
  return response.json();
}

/** The marketplaces the seller account is registered in, and whether it can sell there. */
export async function marketplaceParticipations(
  creds: AmazonCredentials,
  region: AmazonRegion,
): Promise<MarketplaceParticipation[]> {
  return parseMarketplaceParticipations(
    await call(creds, region, "/sellers/v1/marketplaceParticipations"),
  );
}

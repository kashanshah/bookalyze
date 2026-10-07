import "server-only";
import { gunzipSync } from "node:zlib";
import {
  AMAZON_LWA_TOKEN_URL,
  AMAZON_REGIONS,
  type AmazonOrder,
  type AmazonOrderItem,
  type AmazonRefund,
  type AmazonRegion,
  amazonErrorDetail,
  type MarketplaceParticipation,
  parseMarketplaceParticipations,
  parseOrderItemsPage,
  parseOrdersPage,
  parseRefundEventsPage,
  parseReportDocument,
  parseReportsPage,
  parseSolicitationActions,
  REVIEW_ACTION,
  SETTLEMENT_REPORT_TYPE,
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
    readonly code: "unauthorized" | "forbidden" | "throttled" | "unavailable" | "unexpected",
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

const FORBIDDEN =
  "Amazon refused the request. Check the app is authorized for this seller account and region, and has the roles it needs (Selling Partner Insights, Inventory and Order Tracking, Buyer Communication).";
const roleMissing = (role: string) =>
  `Amazon refused the request. In Seller Central → Develop Apps, give the app the ${role} role, then authorize it again and paste the new refresh token in Commerce → Channels.`;

type CallOptions = {
  method?: "GET" | "POST";
  /** What to say when Amazon refuses (401 or 403). */
  forbidden?: string;
  /** Answer these statuses instead of throwing. */
  allow?: readonly number[];
};

async function send(
  creds: AmazonCredentials,
  region: AmazonRegion,
  path: string,
  query: Record<string, string> | undefined,
  options: CallOptions,
): Promise<Response> {
  const token = await accessToken(creds);
  const base =
    env().AMAZON_SPAPI_URL ?? AMAZON_REGIONS.find((r) => r.key === region)?.endpoint ?? "";
  let response: Response;
  try {
    const search = query ? `?${new URLSearchParams(query)}` : "";
    response = await fetch(`${base}${path}${search}`, {
      method: options.method ?? "GET",
      headers: { "x-amz-access-token": token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AmazonError("Amazon couldn't be reached. Try again in a minute.", "unavailable");
  }
  if (options.allow?.includes(response.status)) return response;
  if (response.status === 401 || response.status === 403) {
    throw new AmazonError(options.forbidden ?? FORBIDDEN, "forbidden");
  }
  if (response.status === 429) {
    throw new AmazonError("Amazon asked us to slow down. We'll carry on shortly.", "throttled");
  }
  if (response.status >= 500) {
    throw new AmazonError("Amazon is busy right now. We'll try again shortly.", "unavailable");
  }
  if (!response.ok) {
    // Amazon says what it didn't like (a date, a marketplace…): keep its words.
    const detail = amazonErrorDetail(await response.json().catch(() => null));
    throw new AmazonError(
      `Amazon answered with an error (${response.status})${detail ? `: ${detail}` : "."}`,
      "unexpected",
    );
  }
  return response;
}

async function call(
  creds: AmazonCredentials,
  region: AmazonRegion,
  path: string,
  query?: Record<string, string>,
  options: CallOptions = {},
): Promise<unknown> {
  return (await send(creds, region, path, query, options)).json();
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

/**
 * One page of orders changed in a window (or the next page of a query, by its token), for the
 * given marketplaces. Amazon answers 100 at a time.
 */
export async function ordersPage(
  creds: AmazonCredentials,
  region: AmazonRegion,
  query:
    | { marketplaceIds: readonly string[]; after: string; before: string }
    | { marketplaceIds: readonly string[]; nextToken: string },
): Promise<{ orders: AmazonOrder[]; nextToken: string | null }> {
  const params: Record<string, string> = { MarketplaceIds: query.marketplaceIds.join(",") };
  if ("nextToken" in query) params.NextToken = query.nextToken;
  else {
    params.LastUpdatedAfter = query.after;
    params.LastUpdatedBefore = query.before;
    params.MaxResultsPerPage = "100";
  }
  return parseOrdersPage(await call(creds, region, "/orders/v0/orders", params));
}

/**
 * Whether the order is the seller account's own: Amazon only answers a seller's own orders, so
 * it tells whether new credentials are for the same account as orders brought in before.
 */
export async function ownsOrder(
  creds: AmazonCredentials,
  region: AmazonRegion,
  orderId: string,
): Promise<boolean> {
  const response = await send(
    creds,
    region,
    `/orders/v0/orders/${encodeURIComponent(orderId)}`,
    undefined,
    { allow: [400, 404] },
  );
  return response.ok;
}

/** Every item of an order (following Amazon's pages). */
export async function orderItems(
  creds: AmazonCredentials,
  region: AmazonRegion,
  orderId: string,
): Promise<AmazonOrderItem[]> {
  const items: AmazonOrderItem[] = [];
  let nextToken: string | null = null;
  const path = `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`;
  do {
    const page = parseOrderItemsPage(
      await call(creds, region, path, nextToken ? { NextToken: nextToken } : undefined),
    );
    items.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

const SOLICITATIONS = roleMissing("Buyer Solicitation");

/** Whether Amazon offers its "Request a Review" for the order right now. */
export async function canRequestReview(
  creds: AmazonCredentials,
  region: AmazonRegion,
  order: { externalId: string; marketplaceId: string },
): Promise<boolean> {
  const response = await send(
    creds,
    region,
    `/solicitations/v1/orders/${encodeURIComponent(order.externalId)}`,
    { marketplaceIds: order.marketplaceId },
    { forbidden: SOLICITATIONS },
  );
  return parseSolicitationActions(await response.json().catch(() => null));
}

/**
 * Sends Amazon's "Request a Review" for the order. "refused" when Amazon won't (it answers 403
 * once the order has been asked, by us or from Seller Central).
 */
export async function requestReview(
  creds: AmazonCredentials,
  region: AmazonRegion,
  order: { externalId: string; marketplaceId: string },
): Promise<"sent" | "refused"> {
  const response = await send(
    creds,
    region,
    `/solicitations/v1/orders/${encodeURIComponent(order.externalId)}/solicitations/${REVIEW_ACTION}`,
    { marketplaceIds: order.marketplaceId },
    { method: "POST", forbidden: SOLICITATIONS, allow: [403] },
  );
  return response.status === 403 ? "refused" : "sent";
}

/**
 * One order's own financial events (refunds, A-to-z claims, chargebacks), as Amazon answers
 * them: read with core `refundReason`, `buyerClaim` and `parseRefundEventsPage`.
 */
export async function orderFinancialEvents(
  creds: AmazonCredentials,
  region: AmazonRegion,
  externalId: string,
): Promise<unknown> {
  return call(
    creds,
    region,
    `/finances/v0/orders/${encodeURIComponent(externalId)}/financialEvents`,
    undefined,
    { forbidden: roleMissing("Finance and Accounting") },
  );
}

/**
 * One page of the seller account's refunds posted in a window (or the next page, by its token).
 * Amazon answers financial events of every kind; only refunds are read here.
 */
export async function refundsPage(
  creds: AmazonCredentials,
  region: AmazonRegion,
  query: { after: string; before: string } | { nextToken: string },
): Promise<{ refunds: AmazonRefund[]; nextToken: string | null }> {
  const params: Record<string, string> =
    "nextToken" in query
      ? { NextToken: query.nextToken }
      : { PostedAfter: query.after, PostedBefore: query.before, MaxResultsPerPage: "100" };
  return parseRefundEventsPage(
    await call(creds, region, "/finances/v0/financialEvents", params, {
      forbidden: roleMissing("Finance and Accounting"),
    }),
  );
}

const FINANCE_ROLE = roleMissing("Finance and Accounting");

/**
 * One page of the seller account's settlement reports created since a time (or the next page,
 * by its token). Amazon makes these on its own, one per settlement; they can't be requested.
 */
export async function settlementReportsPage(
  creds: AmazonCredentials,
  region: AmazonRegion,
  query: { createdSince: string } | { nextToken: string },
) {
  const params: Record<string, string> =
    "nextToken" in query
      ? { nextToken: query.nextToken }
      : {
          reportTypes: SETTLEMENT_REPORT_TYPE,
          processingStatuses: "DONE",
          createdSince: query.createdSince,
          pageSize: "100",
        };
  return parseReportsPage(
    await call(creds, region, "/reports/2021-06-30/reports", params, { forbidden: FINANCE_ROLE }),
  );
}

/** Downloads a report's document (unzipped) as text. */
export async function downloadReport(
  creds: AmazonCredentials,
  region: AmazonRegion,
  reportDocumentId: string,
): Promise<string> {
  const doc = parseReportDocument(
    await call(
      creds,
      region,
      `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
      undefined,
      { forbidden: FINANCE_ROLE },
    ),
  );
  let response: Response;
  try {
    // A short-lived signed link: no Amazon token goes with it.
    response = await fetch(doc.url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new AmazonError(
      "Amazon's report couldn't be downloaded. Try again in a minute.",
      "unavailable",
    );
  }
  if (!response.ok) {
    throw new AmazonError(
      `Amazon's report couldn't be downloaded (${response.status}).`,
      "unexpected",
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return new TextDecoder("utf-8").decode(doc.gzip ? gunzipSync(bytes) : bytes);
}

const CATALOG_ROLE = roleMissing("Product Listing");
const PRICING_ROLE = roleMissing("Pricing");

/** A product's words, photos and best seller rank on one marketplace. */
export async function catalogItem(
  creds: AmazonCredentials,
  region: AmazonRegion,
  asin: string,
  marketplaceId: string,
): Promise<unknown> {
  return call(
    creds,
    region,
    `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
    { marketplaceIds: marketplaceId, includedData: "summaries,attributes,images,salesRanks" },
    { forbidden: CATALOG_ROLE },
  );
}

/** New offers for a product, including the featured offer (the Buy Box). */
export async function itemOffers(
  creds: AmazonCredentials,
  region: AmazonRegion,
  asin: string,
  marketplaceId: string,
): Promise<unknown> {
  return call(
    creds,
    region,
    `/products/pricing/v0/items/${encodeURIComponent(asin)}/offers`,
    { MarketplaceId: marketplaceId, ItemCondition: "New" },
    { forbidden: PRICING_ROLE },
  );
}

/**
 * What buyers mention in reviews, for a brand the seller owns. Amazon refuses this for other
 * brands; the caller treats that as "not shared" rather than a broken watch.
 */
export async function reviewTopics(
  creds: AmazonCredentials,
  region: AmazonRegion,
  asin: string,
  marketplaceId: string,
): Promise<{ body: unknown | null; unavailable: boolean }> {
  const response = await send(
    creds,
    region,
    `/customerFeedback/2024-06-01/items/${encodeURIComponent(asin)}/reviews/topics`,
    { marketplaceId },
    { allow: [400, 403, 404], forbidden: roleMissing("Brand Analytics") },
  );
  if (response.status === 400 || response.status === 403 || response.status === 404) {
    return { body: null, unavailable: true };
  }
  return { body: await response.json(), unavailable: false };
}

import "server-only";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  AMAZON_LWA_TOKEN_URL,
  AMAZON_REGIONS,
  type AmazonListing,
  type AmazonOrder,
  type AmazonOrderItem,
  type AmazonRefund,
  type AmazonRegion,
  amazonErrorDetail,
  type FeesEstimate,
  type ListingPatchResult,
  type MarketplaceParticipation,
  messagingAllowsInvoice,
  parseBuyerInfo,
  parseFbaInventoryPage,
  parseFeesEstimate,
  parseListingItem,
  parseListingPatchResult,
  parseMarketplaceParticipations,
  parseMyOfferSellerId,
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
import { logError, logWarn, requestIdOf } from "./log";

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
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AmazonError";
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
  } catch (cause) {
    logError("amazon.lwa_unreachable", cause);
    throw new AmazonError("Amazon couldn't be reached. Try again in a minute.", "unavailable", {
      cause,
    });
  }
  if (response.status >= 500) {
    logWarn("amazon.lwa_failed", { status: response.status, requestId: requestIdOf(response) });
    throw new AmazonError(
      "Amazon's sign-in service is having trouble. Try again soon.",
      "unavailable",
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    // Amazon's error code and description name the problem; neither carries a credential.
    logWarn("amazon.lwa_refused", {
      status: response.status,
      requestId: requestIdOf(response),
      amazonError: body.error,
      amazonDescription: body.error_description,
    });
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
/** Amazon requires this shape on every call. A bare client name is refused with 403. */
const USER_AGENT = "Bookalyze/1.0 (Language=TypeScript; Platform=Node.js)";
const PARTICIPATIONS_DENIED =
  "Amazon refused the marketplace list. That call needs the Selling Partner Insights role. It is also refused when the app includes a role your developer profile does not have yet, such as Tax Invoicing: remove that role or get it approved, then authorize the app again and paste the new refresh token in Commerce → Channels.";
const roleMissing = (role: string) =>
  `Amazon refused the request. In Seller Central → Develop Apps, give the app the ${role} role, then authorize it again and paste the new refresh token in Commerce → Channels.`;

/** Amazon's `x-amz-date` value, `YYYYMMDDTHHMMSSZ`. */
function amzDate(now = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

type CallOptions = {
  method?: "GET" | "POST" | "PATCH";
  /** JSON body for a POST. */
  body?: unknown;
  /** Use this instead of the login token (a restricted-data token). */
  token?: string;
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
  const token = options.token ?? (await accessToken(creds));
  const base =
    env().AMAZON_SPAPI_URL ?? AMAZON_REGIONS.find((r) => r.key === region)?.endpoint ?? "";
  let response: Response;
  try {
    const search = query ? `?${new URLSearchParams(query)}` : "";
    const headers: Record<string, string> = {
      "x-amz-access-token": token,
      "x-amz-date": amzDate(),
      "user-agent": USER_AGENT,
      Accept: "application/json",
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    response = await fetch(`${base}${path}${search}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    logError("amazon.unreachable", cause, { path, region, method: options.method ?? "GET" });
    throw new AmazonError("Amazon couldn't be reached. Try again in a minute.", "unavailable", {
      cause,
    });
  }
  if (options.allow?.includes(response.status)) return response;
  if (!response.ok) {
    // Path, status, Amazon's request ID and own words only: the access token stays in the header.
    const detail = amazonErrorDetail(
      await response
        .clone()
        .json()
        .catch(() => null),
    );
    logWarn("amazon.request_failed", {
      path,
      region,
      method: options.method ?? "GET",
      status: response.status,
      requestId: requestIdOf(response),
      detail,
    });
  }
  if (response.status === 401 || response.status === 403) {
    const detail = amazonErrorDetail(await response.json().catch(() => null));
    const base = options.forbidden ?? FORBIDDEN;
    throw new AmazonError(detail ? `${base} Amazon said: ${detail}` : base, "forbidden");
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
    await call(creds, region, "/sellers/v1/marketplaceParticipations", undefined, {
      forbidden: PARTICIPATIONS_DENIED,
    }),
  );
}

/**
 * The region these credentials belong to. A seller account lives in one region: the same token
 * is refused (403) by the others, which looks like a missing role. Try the chosen region first,
 * then the others, and use the one Amazon accepts.
 */
export async function resolveAmazonAccount(
  creds: AmazonCredentials,
  preferred: AmazonRegion,
): Promise<{ region: AmazonRegion; marketplaces: MarketplaceParticipation[] }> {
  const regions = [
    preferred,
    ...AMAZON_REGIONS.map((r) => r.key).filter((key) => key !== preferred),
  ];
  let denied: AmazonError | null = null;
  for (const region of regions) {
    try {
      return { region, marketplaces: await marketplaceParticipations(creds, region) };
    } catch (error) {
      if (!(error instanceof AmazonError) || error.code !== "forbidden") throw error;
      denied ??= error;
    }
  }
  throw denied ?? new AmazonError(PARTICIPATIONS_DENIED, "forbidden");
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

const FBA_INVENTORY_DENIED =
  "Amazon didn't let us read your FBA inventory. Give the app the Amazon Fulfillment role in Seller Central → Develop Apps, then authorize it again.";

/**
 * One page of the marketplace's FBA inventory: every seller SKU Amazon holds stock for (sold or
 * not), with what can be sold now. Amazon answers up to 50 at a time.
 */
export async function fbaInventoryPage(
  creds: AmazonCredentials,
  region: AmazonRegion,
  query: { marketplaceId: string; nextToken?: string | null },
) {
  const params: Record<string, string> = {
    details: "true",
    granularityType: "Marketplace",
    granularityId: query.marketplaceId,
    marketplaceIds: query.marketplaceId,
  };
  if (query.nextToken) params.nextToken = query.nextToken;
  return parseFbaInventoryPage(
    await call(creds, region, "/fba/inventory/v1/summaries", params, {
      forbidden: FBA_INVENTORY_DENIED,
    }),
  );
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

const TAX_INVOICING = roleMissing("Tax Invoicing");

/**
 * The buyer's name, company and tax number for one order. Asks Amazon for buyerInfo only, and
 * the parser drops any email Amazon includes. Needs the Tax Invoicing role.
 */
export async function orderBuyerIdentity(
  creds: AmazonCredentials,
  region: AmazonRegion,
  orderId: string,
) {
  const path = `/orders/v0/orders/${encodeURIComponent(orderId)}`;
  const tokenJson = await call(creds, region, "/tokens/2021-03-01/restrictedDataToken", undefined, {
    method: "POST",
    body: { restrictedResources: [{ method: "GET", path, dataElements: ["buyerInfo"] }] },
    forbidden: TAX_INVOICING,
  });
  const raw =
    typeof tokenJson === "object" && tokenJson && "restrictedDataToken" in tokenJson
      ? (tokenJson as { restrictedDataToken?: unknown }).restrictedDataToken
      : null;
  const token = typeof raw === "string" ? raw : "";
  if (!token) {
    throw new AmazonError(
      "Amazon didn't return a token for the buyer's name and tax number.",
      "unexpected",
    );
  }
  return parseBuyerInfo(
    await call(creds, region, path, undefined, { token, forbidden: TAX_INVOICING }),
  );
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
  forbidden: string = FINANCE_ROLE,
): Promise<string> {
  const doc = parseReportDocument(
    await call(
      creds,
      region,
      `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
      undefined,
      { forbidden },
    ),
  );
  let response: Response;
  try {
    // A short-lived signed link: no Amazon token goes with it.
    response = await fetch(doc.url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  } catch (cause) {
    logError("amazon.report_download_unreachable", cause, { reportDocumentId, region });
    throw new AmazonError(
      "Amazon's report couldn't be downloaded. Try again in a minute.",
      "unavailable",
      { cause },
    );
  }
  if (!response.ok) {
    logWarn("amazon.report_download_failed", {
      reportDocumentId,
      region,
      status: response.status,
      requestId: requestIdOf(response),
    });
    throw new AmazonError(
      `Amazon's report couldn't be downloaded (${response.status}).`,
      "unexpected",
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return new TextDecoder("utf-8").decode(doc.gzip ? gunzipSync(bytes) : bytes);
}

const LEDGER_REPORT_TYPE = "GET_LEDGER_DETAIL_VIEW_DATA";
export const LEDGER_DENIED =
  "Amazon didn't let us read your FBA inventory ledger. Give the app the Amazon Fulfillment role in Seller Central → Develop Apps, then authorize it again.";

/** Asks Amazon for its FBA inventory ledger (detailed view) for [from, to], whole days. */
export async function requestLedgerReport(
  creds: AmazonCredentials,
  region: AmazonRegion,
  query: { marketplaceId: string; from: string; to: string },
): Promise<string> {
  const body = await call(creds, region, "/reports/2021-06-30/reports", undefined, {
    method: "POST",
    body: {
      reportType: LEDGER_REPORT_TYPE,
      marketplaceIds: [query.marketplaceId],
      dataStartTime: `${query.from}T00:00:00Z`,
      dataEndTime: `${query.to}T23:59:59Z`,
    },
    forbidden: LEDGER_DENIED,
  });
  const id = (body as { reportId?: unknown })?.reportId;
  if (typeof id !== "string" || !id) {
    throw new AmazonError("Amazon didn't start the inventory ledger report.", "unexpected");
  }
  return id;
}

/** Where a requested report stands: still being made, ready (with its document), or not. */
export async function reportStatus(
  creds: AmazonCredentials,
  region: AmazonRegion,
  reportId: string,
): Promise<{ status: string; documentId: string | null }> {
  const body = (await call(
    creds,
    region,
    `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
    undefined,
    { forbidden: LEDGER_DENIED },
  )) as { processingStatus?: unknown; reportDocumentId?: unknown };
  return {
    status: typeof body?.processingStatus === "string" ? body.processingStatus : "UNKNOWN",
    documentId: typeof body?.reportDocumentId === "string" ? body.reportDocumentId : null,
  };
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

const LISTINGS_PATH = (sellerId: string, sku: string) =>
  `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`;

/** One of the seller's listings in a marketplace: its price, offer and status. Null if unknown. */
export async function listingItem(
  creds: AmazonCredentials,
  region: AmazonRegion,
  input: { sellerId: string; sku: string; marketplaceId: string },
): Promise<AmazonListing | null> {
  const response = await send(
    creds,
    region,
    LISTINGS_PATH(input.sellerId, input.sku),
    {
      marketplaceIds: input.marketplaceId,
      includedData: "summaries,attributes,offers,issues",
    },
    { forbidden: CATALOG_ROLE, allow: [404] },
  );
  if (response.status === 404) return null;
  return parseListingItem(await response.json(), input.marketplaceId);
}

/**
 * Sends a listing change (a JSON patch) to Amazon. "ACCEPTED" means Amazon applies it within
 * minutes; "INVALID" comes with Amazon's reasons. A 400 is a refusal too, in Amazon's words.
 */
export async function patchListing(
  creds: AmazonCredentials,
  region: AmazonRegion,
  input: { sellerId: string; sku: string; marketplaceId: string; body: unknown },
): Promise<ListingPatchResult> {
  const response = await send(
    creds,
    region,
    LISTINGS_PATH(input.sellerId, input.sku),
    { marketplaceIds: input.marketplaceId },
    { method: "PATCH", body: input.body, forbidden: CATALOG_ROLE, allow: [400] },
  );
  const json = await response.json().catch(() => null);
  if (response.status === 400) {
    const detail = amazonErrorDetail(json);
    return {
      status: "INVALID",
      submissionId: null,
      problems: [detail || "Amazon refused the change."],
    };
  }
  return parseListingPatchResult(json);
}

/** Amazon's fees for one sale of a listing at a price (referral, FBA…). */
export async function feesEstimate(
  creds: AmazonCredentials,
  region: AmazonRegion,
  input: {
    sku: string;
    marketplaceId: string;
    price: string;
    currency: string;
    fulfilledByAmazon: boolean;
  },
): Promise<FeesEstimate | { error: string }> {
  const json = await call(
    creds,
    region,
    `/products/fees/v0/listings/${encodeURIComponent(input.sku)}/feesEstimate`,
    undefined,
    {
      method: "POST",
      forbidden: PRICING_ROLE,
      body: {
        FeesEstimateRequest: {
          MarketplaceId: input.marketplaceId,
          IsAmazonFulfilled: input.fulfilledByAmazon,
          // Amazon reads amounts as JSON numbers; the price is already rounded to cents.
          PriceToEstimateFees: {
            ListingPrice: { CurrencyCode: input.currency, Amount: Number(input.price) },
          },
          Identifier: `bookalyze-${input.sku}-${input.price}`,
        },
      },
    },
  );
  return parseFeesEstimate(json);
}

/**
 * The seller's own ID, from the offers on one of their listings (the one marked as theirs).
 * Null when Amazon doesn't show an offer of theirs for that SKU right now.
 */
export async function sellerIdFromListing(
  creds: AmazonCredentials,
  region: AmazonRegion,
  input: { sku: string; marketplaceId: string },
): Promise<string | null> {
  const response = await send(
    creds,
    region,
    `/products/pricing/v0/listings/${encodeURIComponent(input.sku)}/offers`,
    { MarketplaceId: input.marketplaceId, ItemCondition: "New" },
    { forbidden: PRICING_ROLE, allow: [400, 404] },
  );
  if (!response.ok) return null;
  return parseMyOfferSellerId(await response.json().catch(() => null));
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
 * What buyers mention in reviews, plus how that moves the star rating and a few quotes.
 * `sortBy` is required; without it Amazon answers 400. A seller app needs Selling Partner
 * Insights, and Amazon only answers for a child ASIN. The caller treats a refusal as
 * "not shared" rather than a broken watch.
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
    { marketplaceId, sortBy: "MENTIONS" },
    { allow: [400, 403, 404], forbidden: roleMissing("Selling Partner Insights") },
  );
  // 204 is a real answer: not enough reviews to name topics.
  if (response.status === 204) return { body: null, unavailable: false };
  if (response.status === 400 || response.status === 403 || response.status === 404) {
    return { body: null, unavailable: true };
  }
  return { body: await response.json(), unavailable: false };
}

const BUYER_COMMUNICATION = roleMissing("Buyer Communication");

/** Whether Amazon offers its invoice message for the order right now (Messaging API). */
export async function canSendInvoice(
  creds: AmazonCredentials,
  region: AmazonRegion,
  order: { externalId: string; marketplaceId: string },
): Promise<boolean> {
  const body = await call(
    creds,
    region,
    `/messaging/v1/orders/${encodeURIComponent(order.externalId)}`,
    { marketplaceIds: order.marketplaceId },
    { forbidden: BUYER_COMMUNICATION },
  );
  return messagingAllowsInvoice(body);
}

/**
 * Sends a PDF to the buyer with Amazon's invoice message: asks the Uploads API where to put the
 * file, puts it there, then sends the message with it attached. Amazon shows it to the buyer in
 * their order and messages, and it answers the buyer's invoice request.
 */
export async function sendInvoice(
  creds: AmazonCredentials,
  region: AmazonRegion,
  order: { externalId: string; marketplaceId: string },
  file: { fileName: string; bytes: Uint8Array },
): Promise<void> {
  const id = encodeURIComponent(order.externalId);
  const contentType = "application/pdf";
  const contentMD5 = createHash("md5").update(file.bytes).digest("base64");
  const destination = (await call(
    creds,
    region,
    `/uploads/2020-11-01/uploadDestinations/messaging/v1/orders/${id}/messages/invoice`,
    { marketplaceIds: order.marketplaceId, contentMD5, contentType },
    { method: "POST", forbidden: BUYER_COMMUNICATION },
  )) as {
    payload?: { uploadDestinationId?: string; url?: string; headers?: Record<string, string> };
  };
  const target = destination.payload;
  if (!target?.uploadDestinationId || !target.url) {
    throw new AmazonError(
      "Amazon didn't say where to upload the invoice. Try again.",
      "unexpected",
    );
  }
  let upload: Response;
  try {
    upload = await fetch(target.url, {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-MD5": contentMD5, ...target.headers },
      body: new Uint8Array(file.bytes),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (cause) {
    logError("amazon.invoice_upload_unreachable", cause, { region });
    throw new AmazonError("The invoice couldn't be uploaded to Amazon. Try again.", "unavailable", {
      cause,
    });
  }
  if (!upload.ok) {
    logWarn("amazon.invoice_upload_failed", { region, status: upload.status });
    throw new AmazonError(
      `Amazon didn't take the invoice file (${upload.status}). Try again.`,
      "unexpected",
    );
  }
  await send(
    creds,
    region,
    `/messaging/v1/orders/${id}/messages/invoice`,
    { marketplaceIds: order.marketplaceId },
    {
      method: "POST",
      body: {
        attachments: [{ uploadDestinationId: target.uploadDestinationId, fileName: file.fileName }],
      },
      forbidden: BUYER_COMMUNICATION,
    },
  );
}

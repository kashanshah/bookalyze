import { formatDecimal, parseDecimal } from "../money";
import type { AdMetricRow, AdType } from "./ads";
import type { AmazonRegion } from "./amazon";

/**
 * The Amazon Ads API (advertising-api.amazon.com), for what ads cost per SKU per day: Login with
 * Amazon consent through Bookalyze's one Ads app, the advertiser's profiles (one per marketplace),
 * and the v3 asynchronous reports. Only spend and attributed sales: no keywords, search terms or
 * placements (docs/ADS.md). The HTTP side lives in the web app (server/amazon-ads.ts).
 */

/** Each Ads region's consent page, token endpoint and API host. */
export const AMAZON_ADS_REGIONS: Record<
  AmazonRegion,
  { auth: string; token: string; api: string; label: string }
> = {
  na: {
    label: "North America",
    auth: "https://www.amazon.com/ap/oa",
    token: "https://api.amazon.com/auth/o2/token",
    api: "https://advertising-api.amazon.com",
  },
  eu: {
    label: "Europe, Middle East and India",
    auth: "https://eu.account.amazon.com/ap/oa",
    token: "https://api.amazon.co.uk/auth/o2/token",
    api: "https://advertising-api-eu.amazon.com",
  },
  fe: {
    label: "Far East",
    auth: "https://apac.account.amazon.com/ap/oa",
    token: "https://api.amazon.co.jp/auth/o2/token",
    api: "https://advertising-api-fe.amazon.com",
  },
};

/** The one scope the Ads API needs (it covers reports; Bookalyze only reads). */
export const AMAZON_ADS_SCOPE = "advertising::campaign_management";
export const AMAZON_ADS_PROFILES_PATH = "/v2/profiles";
export const AMAZON_ADS_REPORTS_PATH = "/reporting/reports";
/** Amazon's v3 reports take at most 31 days each. */
export const AMAZON_ADS_MAX_REPORT_DAYS = 31;
/** Attribution can change for 14 days after a click, so the last 15 days are fetched again. */
export const AMAZON_ADS_LOOKBACK_DAYS = 15;
/** How far back the first sync goes (Sponsored Brands' reports keep about 60 days). */
export const AMAZON_ADS_BACKFILL_DAYS = 60;
/** A report still pending after this long is given up on and asked again. */
export const AMAZON_ADS_PENDING_LIMIT_MS = 6 * 60 * 60 * 1000;

/** The URL of Amazon's consent page for an Ads region. */
export function amazonAdsConsentUrl(input: {
  authBase: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(input.authBase);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", AMAZON_ADS_SCOPE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
const count = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
/** A number Amazon sends (12.34 or "12.34") as an exact 4-place decimal string. */
function money(v: unknown): string {
  const raw = typeof v === "number" ? (Number.isFinite(v) ? v.toFixed(4) : "0") : text(v);
  if (!raw) return "0.0000";
  try {
    return formatDecimal(parseDecimal(raw.replace(/(\.\d{4})\d+$/, "$1")));
  } catch {
    return "0.0000";
  }
}

export type AmazonAdsTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
};

/** Login with Amazon's token answer. */
export function parseAmazonAdsTokens(json: unknown): AmazonAdsTokens {
  const body = record(json);
  const accessToken = text(body.access_token);
  if (!accessToken) throw new Error("Amazon didn't send an access token.");
  return {
    accessToken,
    refreshToken: text(body.refresh_token) || null,
    expiresIn: count(body.expires_in) || 3600,
  };
}

export type AmazonAdsProfile = {
  profileId: string;
  countryCode: string;
  currency: string;
  timezone: string;
  /** Amazon's marketplace ID (e.g. A2EUQ1WTGCTBG2): how a profile finds its channel. */
  marketplaceId: string;
  accountName: string;
  /** "seller", "vendor" or "agency": only seller profiles map to channels. */
  accountType: string;
};

/** GET /v2/profiles: the advertiser's profiles, one per marketplace. */
export function parseAmazonAdsProfiles(json: unknown): AmazonAdsProfile[] {
  if (!Array.isArray(json)) throw new Error("Amazon's list of ads accounts didn't make sense.");
  return json.flatMap((raw): AmazonAdsProfile[] => {
    const p = record(raw);
    const info = record(p.accountInfo);
    const profileId = text(p.profileId);
    if (!profileId) return [];
    return [
      {
        profileId,
        countryCode: text(p.countryCode).toUpperCase(),
        currency: text(p.currencyCode).toUpperCase(),
        timezone: text(p.timezone),
        marketplaceId: text(info.marketplaceStringId),
        accountName: text(info.name),
        accountType: text(info.type).toLowerCase(),
      },
    ];
  });
}

/** The ad types Bookalyze asks Amazon for, and each one's v3 report. */
export const AMAZON_ADS_REPORTS: readonly {
  adType: AdType;
  adProduct: string;
  reportTypeId: string;
  groupBy: readonly string[];
  columns: readonly string[];
  window: string;
}[] = [
  {
    adType: "sponsored_products",
    adProduct: "SPONSORED_PRODUCTS",
    reportTypeId: "spAdvertisedProduct",
    groupBy: ["advertiser"],
    columns: [
      "date",
      "campaignId",
      "campaignName",
      "advertisedAsin",
      "advertisedSku",
      "impressions",
      "clicks",
      "cost",
      "sales7d",
      "purchases7d",
      "unitsSoldClicks7d",
    ],
    window: "7d",
  },
  {
    adType: "sponsored_brands",
    adProduct: "SPONSORED_BRANDS",
    reportTypeId: "sbCampaigns",
    groupBy: ["campaign"],
    columns: [
      "date",
      "campaignId",
      "campaignName",
      "impressions",
      "clicks",
      "cost",
      "sales",
      "purchases",
      "unitsSold",
    ],
    window: "14d",
  },
];

/** The body of POST /reporting/reports for one ad type and days. */
export function amazonAdsReportRequest(adType: AdType, from: string, to: string) {
  const spec = AMAZON_ADS_REPORTS.find((r) => r.adType === adType);
  if (!spec) throw new Error(`No Amazon report for ${adType}.`);
  return {
    name: `Bookalyze ${spec.reportTypeId} ${from} to ${to}`,
    startDate: from,
    endDate: to,
    configuration: {
      adProduct: spec.adProduct,
      groupBy: [...spec.groupBy],
      columns: [...spec.columns],
      reportTypeId: spec.reportTypeId,
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

/** Amazon refuses a second identical request with 425 and names the first report's ID. */
export function duplicateAmazonAdsReportId(json: unknown): string | null {
  const detail = text(record(json).detail);
  return /duplicate of\s*:?\s*([0-9a-f-]{36})/i.exec(detail)?.[1] ?? null;
}

export type AmazonAdsReportStatus = {
  reportId: string;
  status: "pending" | "done" | "failed";
  url: string | null;
  failure: string | null;
};

/** POST /reporting/reports and GET /reporting/reports/{id}. */
export function parseAmazonAdsReportStatus(json: unknown): AmazonAdsReportStatus {
  const body = record(json);
  const reportId = text(body.reportId);
  if (!reportId) throw new Error("Amazon's report answer didn't make sense.");
  const status = text(body.status).toUpperCase();
  return {
    reportId,
    status: status === "COMPLETED" ? "done" : status === "FAILURE" ? "failed" : "pending",
    url: text(body.url) || null,
    failure: text(body.failureReason) || null,
  };
}

/**
 * A finished report's rows (the downloaded JSON array) as ad metric rows. Sponsored Products'
 * rows are per advertised SKU; Sponsored Brands' per campaign (no SKU). Rows outside the asked
 * days, or without a day, are dropped.
 */
export function parseAmazonAdsReport(
  adType: AdType,
  json: unknown,
  range: { from: string; to: string },
): AdMetricRow[] {
  if (!Array.isArray(json)) throw new Error("Amazon's ads report didn't make sense.");
  const spec = AMAZON_ADS_REPORTS.find((r) => r.adType === adType);
  const products = adType === "sponsored_products";
  return json.flatMap((raw): AdMetricRow[] => {
    const r = record(raw);
    const date = text(r.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < range.from || date > range.to) return [];
    return [
      {
        date,
        adType,
        campaignId: text(r.campaignId),
        campaignName: text(r.campaignName) || null,
        sku: products ? text(r.advertisedSku) || null : null,
        listingRef: products ? text(r.advertisedAsin) || null : null,
        spend: money(r.cost ?? r.spend),
        impressions: count(r.impressions),
        clicks: count(r.clicks),
        attributedSales: money(products ? r.sales7d : r.sales),
        attributedOrders: count(products ? r.purchases7d : r.purchases),
        attributedUnits: count(products ? r.unitsSoldClicks7d : r.unitsSold),
        attributionWindow: spec?.window ?? "",
      },
    ];
  });
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The days to ask Amazon for next, for one channel and ad type: on first sync from 60 days back,
 * then on from where the last report ended, but always the last 15 days again (attribution
 * changes for 14). At most 31 days; null when there's nothing to ask (today's report is in).
 */
export function nextAmazonAdsWindow(input: {
  /** Today in the ads account's time zone. */
  today: string;
  /** The last day of the latest finished report, or null. */
  doneThrough: string | null;
  /** When that report finished, as a day in the same time zone. */
  doneOn: string | null;
}): { from: string; to: string } | null {
  const yesterday = addDays(input.today, -1);
  const earliest = addDays(input.today, -AMAZON_ADS_BACKFILL_DAYS);
  // Caught up and already refreshed today: nothing to ask until tomorrow.
  if (input.doneThrough && input.doneThrough >= yesterday && input.doneOn === input.today) {
    return null;
  }
  let from = input.doneThrough ? addDays(input.doneThrough, 1) : earliest;
  const lookback = addDays(input.today, -AMAZON_ADS_LOOKBACK_DAYS);
  if (from > lookback) from = lookback;
  if (from < earliest) from = earliest;
  const last = addDays(from, AMAZON_ADS_MAX_REPORT_DAYS - 1);
  const to = last < yesterday ? last : yesterday;
  return from <= to ? { from, to } : null;
}

/** Amazon's own words from an Ads API error body ({ code, details } or { message }). */
export function amazonAdsErrorDetail(json: unknown): string | null {
  const body = record(json);
  const detail = text(body.details) || text(body.detail) || text(body.message);
  const code = text(body.code);
  if (!detail && !code) return null;
  return [code, detail].filter(Boolean).join(": ").slice(0, 300);
}

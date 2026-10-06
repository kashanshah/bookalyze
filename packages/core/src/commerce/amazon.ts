/**
 * Amazon Selling Partner API (SP-API) reference data and response parsing. Calls are made with a
 * Login with Amazon (LWA) access token, exchanged from the seller's refresh token; the HTTP side
 * lives in the web app (server/amazon.ts).
 */

export const AMAZON_LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

export const AMAZON_REGIONS = [
  {
    key: "na",
    label: "North America",
    hint: "Amazon.ca, Amazon.com, Mexico and Brazil.",
    endpoint: "https://sellingpartnerapi-na.amazon.com",
  },
  {
    key: "eu",
    label: "Europe, Middle East and India",
    hint: "Amazon.ae, Saudi Arabia, the UK, the EU, Turkey, Egypt and India.",
    endpoint: "https://sellingpartnerapi-eu.amazon.com",
  },
  {
    key: "fe",
    label: "Far East",
    hint: "Japan, Australia and Singapore.",
    endpoint: "https://sellingpartnerapi-fe.amazon.com",
  },
] as const;
export type AmazonRegion = (typeof AMAZON_REGIONS)[number]["key"];

export const isAmazonRegion = (value: string): value is AmazonRegion =>
  AMAZON_REGIONS.some((r) => r.key === value);

export type AmazonMarketplace = {
  id: string;
  name: string;
  country: string;
  currency: string;
  region: AmazonRegion;
};

/** Amazon's marketplace IDs (they're public and fixed). */
export const AMAZON_MARKETPLACES: readonly AmazonMarketplace[] = [
  { id: "A2EUQ1WTGCTBG2", name: "Amazon.ca", country: "CA", currency: "CAD", region: "na" },
  { id: "ATVPDKIKX0DER", name: "Amazon.com", country: "US", currency: "USD", region: "na" },
  { id: "A1AM78C64UM0Y8", name: "Amazon.com.mx", country: "MX", currency: "MXN", region: "na" },
  { id: "A2Q3Y263D00KWC", name: "Amazon.com.br", country: "BR", currency: "BRL", region: "na" },
  { id: "A2VIGQ35RCS4UG", name: "Amazon.ae", country: "AE", currency: "AED", region: "eu" },
  { id: "A17E79C6D8DWNP", name: "Amazon.sa", country: "SA", currency: "SAR", region: "eu" },
  { id: "A1F83G8C2ARO7P", name: "Amazon.co.uk", country: "GB", currency: "GBP", region: "eu" },
  { id: "A1PA6795UKMFR9", name: "Amazon.de", country: "DE", currency: "EUR", region: "eu" },
  { id: "A13V1IB3VIYZZH", name: "Amazon.fr", country: "FR", currency: "EUR", region: "eu" },
  { id: "APJ6JRA9NG5V4", name: "Amazon.it", country: "IT", currency: "EUR", region: "eu" },
  { id: "A1RKKUPIHCS9HS", name: "Amazon.es", country: "ES", currency: "EUR", region: "eu" },
  { id: "A1805IZSGTT6HS", name: "Amazon.nl", country: "NL", currency: "EUR", region: "eu" },
  { id: "A2NODRKZP88ZB9", name: "Amazon.se", country: "SE", currency: "SEK", region: "eu" },
  { id: "A1C3SOZRARQ6R3", name: "Amazon.pl", country: "PL", currency: "PLN", region: "eu" },
  { id: "A33AVAJ2PDY3EV", name: "Amazon.com.tr", country: "TR", currency: "TRY", region: "eu" },
  { id: "ARBP9OOSHTCHU", name: "Amazon.eg", country: "EG", currency: "EGP", region: "eu" },
  { id: "A21TJRUUN4KGV", name: "Amazon.in", country: "IN", currency: "INR", region: "eu" },
  { id: "A1VC38T7YXB528", name: "Amazon.co.jp", country: "JP", currency: "JPY", region: "fe" },
  { id: "A39IBJ37TRP1C6", name: "Amazon.com.au", country: "AU", currency: "AUD", region: "fe" },
  { id: "A19VAU5U5O7RUS", name: "Amazon.sg", country: "SG", currency: "SGD", region: "fe" },
];

export function amazonMarketplace(id: string): AmazonMarketplace | undefined {
  return AMAZON_MARKETPLACES.find((m) => m.id === id);
}

/** The region a company most likely sells in, from its country. */
export function defaultAmazonRegion(country: string): AmazonRegion {
  return (
    AMAZON_MARKETPLACES.find((m) => m.country === country)?.region ??
    (["GB", "AE", "SA", "IN", "EG", "TR"].includes(country) ? "eu" : "na")
  );
}

export type MarketplaceParticipation = {
  marketplaceId: string;
  name: string;
  country: string;
  currency: string;
  /** The seller can sell there (not just registered). */
  participating: boolean;
  hasSuspendedListings: boolean;
  storeName: string | null;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Parses GET /sellers/v1/marketplaceParticipations. Unknown marketplaces keep Amazon's own name
 * and currency; non-Amazon "marketplaces" (e.g. Amazon's test or non-retail ones) are left out.
 */
export function parseMarketplaceParticipations(json: unknown): MarketplaceParticipation[] {
  const payload = record(json).payload;
  if (!Array.isArray(payload)) throw new Error("Unexpected response from Amazon.");
  return payload.flatMap((item) => {
    const marketplace = record(record(item).marketplace);
    const participation = record(record(item).participation);
    const id = text(marketplace.id);
    const known = amazonMarketplace(id);
    const name = known?.name ?? text(marketplace.name);
    if (!id || !name || (!known && !/^Amazon\./i.test(name))) return [];
    return [
      {
        marketplaceId: id,
        name,
        country: known?.country ?? text(marketplace.countryCode),
        currency: known?.currency ?? text(marketplace.defaultCurrencyCode),
        participating: participation.isParticipating === true,
        hasSuspendedListings: participation.hasSuspendedListings === true,
        storeName: text(record(item).storeName) || null,
      },
    ];
  });
}

/**
 * Amazon's own explanation of a failed call ({"errors":[{"code","message","details"}]}), as one
 * short line, or null when the answer doesn't carry one.
 */
export function amazonErrorDetail(json: unknown): string | null {
  const errors = record(json).errors;
  const first = record(Array.isArray(errors) ? errors[0] : null);
  const parts = [text(first.message), text(first.details)]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const line = parts.join(" ");
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}

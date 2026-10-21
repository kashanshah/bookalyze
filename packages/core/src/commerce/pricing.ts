import { minorUnits } from "../currency";
import {
  AMOUNT_SCALE,
  divideDecimals,
  formatDecimal,
  parseDecimal,
  RATE_SCALE,
  roundUnits,
} from "../money";

/**
 * Changing a listing's price on Amazon: the Listings Items API (2021-08-01) reads a listing and
 * patches its `purchasable_offer`, the Product Fees API estimates Amazon's fees at a price, and
 * Product Pricing's listing offers tell the seller ID (the offer marked as the seller's own).
 */

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A price as Amazon writes it (a number or a string), as an exact decimal string, or null. */
function amount(v: unknown): string | null {
  const raw = typeof v === "number" ? String(v) : text(v);
  if (!raw) return null;
  try {
    return formatDecimal(parseDecimal(raw));
  } catch {
    return null;
  }
}

export type ListingIssue = { severity: string; message: string };

export type AmazonListing = {
  sku: string;
  /** Needed to patch the listing. */
  productType: string | null;
  itemName: string | null;
  asin: string | null;
  /** Amazon's words for it, e.g. ["BUYABLE", "DISCOVERABLE"]. */
  status: string[];
  /** The price buyers pay (Amazon's "our price"), or null when the listing has none. */
  price: string | null;
  currency: string | null;
  /** The listing's current offer for the marketplace, kept whole so a patch only changes the price. */
  offer: Record<string, unknown> | null;
  /** Amazon ships it (FBA), which changes its fees. */
  fulfilledByAmazon: boolean;
  issues: ListingIssue[];
};

/** The offer for everyone (not the business-only one) in a marketplace. */
function offerFor(attributes: Record<string, unknown>, marketplaceId: string) {
  const offers = list(attributes.purchasable_offer).map(record);
  const inMarketplace = offers.filter(
    (o) => !text(o.marketplace_id) || text(o.marketplace_id) === marketplaceId,
  );
  return (
    inMarketplace.find((o) => {
      const audience = text(o.audience);
      return !audience || audience === "ALL";
    }) ?? null
  );
}

function ourPrice(offer: Record<string, unknown> | null): string | null {
  if (!offer) return null;
  const schedule = record(list(record(list(offer.our_price)[0]).schedule)[0]);
  return amount(schedule.value_with_tax);
}

/**
 * Parses GET /listings/2021-08-01/items/{sellerId}/{sku} with summaries, attributes, offers and
 * issues. The price is the offer Amazon reports for buyers, else the listing's own "our price".
 */
export function parseListingItem(json: unknown, marketplaceId: string): AmazonListing {
  const body = record(json);
  const summaries = list(body.summaries).map(record);
  const summary =
    summaries.find((s) => text(s.marketplaceId) === marketplaceId) ?? summaries[0] ?? {};
  const attributes = record(body.attributes);
  const offer = offerFor(attributes, marketplaceId);
  const offers = list(body.offers).map(record);
  const b2c =
    offers.find(
      (o) =>
        (!text(o.marketplaceId) || text(o.marketplaceId) === marketplaceId) &&
        (!text(o.offerType) || text(o.offerType) === "B2C"),
    ) ?? null;
  const offerPrice = b2c ? record(b2c.price) : null;
  const price = amount(offerPrice?.amount) ?? ourPrice(offer);
  const currency = text(offerPrice?.currency) || text(offer?.currency) || null;
  return {
    sku: text(body.sku),
    productType: text(summary.productType) || null,
    itemName: text(summary.itemName) || null,
    asin: text(summary.asin) || null,
    status: list(summary.status).map(text).filter(Boolean),
    price,
    currency,
    offer,
    // FBA listings name Amazon's fulfilment network (AMAZON_NA, AMAZON_EU…); seller-fulfilled
    // ones say DEFAULT.
    fulfilledByAmazon: list(attributes.fulfillment_availability)
      .map(record)
      .some((f) => text(f.fulfillment_channel_code).startsWith("AMAZON")),
    issues: list(body.issues)
      .map(record)
      .map((i) => ({ severity: text(i.severity) || "ERROR", message: text(i.message) }))
      .filter((i) => i.message),
  };
}

/**
 * The JSON number Amazon wants for a price. Prices are exact decimal strings everywhere else;
 * this is the one place a price leaves as a number, already rounded to the currency's cents.
 */
function priceNumber(price: string, currency: string): number {
  const units = roundUnits(parseDecimal(price), minorUnits(currency));
  return Number(formatDecimal(units, AMOUNT_SCALE));
}

/**
 * The PATCH body that sets a listing's price in one marketplace. The current offer is kept as it
 * is (sale price, minimum and maximum prices…) and only "our price" changes, because replacing
 * `purchasable_offer` replaces all of it.
 */
export function buildPricePatch(input: {
  productType: string;
  marketplaceId: string;
  currency: string;
  price: string;
  offer: Record<string, unknown> | null;
}) {
  const base = input.offer ? structuredClone(input.offer) : {};
  const value = {
    ...base,
    marketplace_id: input.marketplaceId,
    currency: input.currency,
    our_price: [{ schedule: [{ value_with_tax: priceNumber(input.price, input.currency) }] }],
  };
  return {
    productType: input.productType,
    patches: [{ op: "replace", path: "/attributes/purchasable_offer", value: [value] }],
  };
}

export type ListingPatchResult = {
  /** Amazon's answer: "ACCEPTED" (it applies within minutes) or "INVALID" (refused). */
  status: string;
  submissionId: string | null;
  /** What Amazon objected to, in its words (errors first). */
  problems: string[];
};

/** Parses the answer to PATCH /listings/2021-08-01/items/{sellerId}/{sku}. */
export function parseListingPatchResult(json: unknown): ListingPatchResult {
  const body = record(json);
  const issues = list(body.issues).map(record);
  const errors = issues.filter((i) => text(i.severity) !== "WARNING");
  return {
    status: text(body.status) || "INVALID",
    submissionId: text(body.submissionId) || null,
    problems: (errors.length ? errors : [])
      .map((i) => text(i.message))
      .filter(Boolean)
      .slice(0, 5),
  };
}

export type FeesEstimate = {
  total: string;
  currency: string;
  /** Each fee, e.g. ReferralFee, FBAFees. */
  fees: { type: string; amount: string }[];
};

/**
 * Parses POST /products/fees/v0/listings/{sku}/feesEstimate, or Amazon's reason when it couldn't
 * estimate (e.g. a listing it doesn't know yet).
 */
export function parseFeesEstimate(json: unknown): FeesEstimate | { error: string } {
  const result = record(record(record(json).payload).FeesEstimateResult);
  const estimate = record(result.FeesEstimate);
  const total = record(estimate.TotalFeesEstimate);
  const value = amount(total.Amount);
  if (text(result.Status) !== "Success" || value === null) {
    const error = record(result.Error);
    return { error: text(error.Message) || "Amazon couldn't estimate the fees for this listing." };
  }
  return {
    total: value,
    currency: text(total.CurrencyCode),
    fees: list(estimate.FeeDetailList)
      .map(record)
      .map((f) => ({ type: text(f.FeeType), amount: amount(record(f.FinalFee).Amount) ?? "0" }))
      .filter((f) => f.type),
  };
}

/** The seller's own ID from GET /products/pricing/v0/listings/{sku}/offers (their offer). */
export function parseMyOfferSellerId(json: unknown): string | null {
  const offers = list(record(record(json).payload).Offers).map(record);
  const mine = offers.find((o) => o.MyOffer === true);
  return text(mine?.SellerId) || null;
}

/** Amazon seller IDs (merchant tokens) are 10 to 20 capital letters and digits. */
export function isAmazonSellerId(value: string): boolean {
  return /^[A-Z0-9]{10,20}$/.test(value.trim());
}

export type PriceProfit = {
  /** price − fees − cost, in the marketplace's currency. */
  profit: string;
  /** Profit over price, in percent with one decimal ("23.5"), or null without a price. */
  margin: string | null;
};

/**
 * What one sale earns at a price: the price less Amazon's fees and the cost of what's in the
 * listing (all in the marketplace's currency), rounded to its cents.
 */
export function priceProfit(input: {
  price: string;
  fees: string;
  cost: string;
  currency: string;
}): PriceProfit {
  const decimals = minorUnits(input.currency);
  const profitUnits = roundUnits(
    parseDecimal(input.price) - parseDecimal(input.fees) - parseDecimal(input.cost),
    decimals,
  );
  const profit = formatDecimal(profitUnits);
  const price = parseDecimal(input.price);
  if (price <= 0n) return { profit, margin: null };
  return { profit, margin: divideDecimals(formatDecimal(profitUnits * 100n), input.price, 1) };
}

/**
 * How far a new price is from the current one, in percent (one decimal, signed), or null without
 * a current price. Big moves get a second look before they go to Amazon.
 */
export function priceChangePercent(current: string | null, next: string): string | null {
  if (!current || parseDecimal(current) <= 0n) return null;
  const diff = parseDecimal(next) - parseDecimal(current);
  return divideDecimals(formatDecimal(diff * 100n), current, 1);
}

/** A change this large (either way) asks for a confirmation first. */
export const LARGE_PRICE_CHANGE_PERCENT = 30;

/**
 * What the contents of one listing cost, in the marketplace's currency: each product's next unit
 * cost times how many the listing holds. Costs are in the main currency; `rate` is the main
 * currency per one unit of the marketplace's (as exchange rates are kept), needed only when they
 * differ. Null cost when a product has no cost yet or there's no rate, with the products missing.
 */
export function listingCost(input: {
  components: readonly { productId: string; productName: string; units: number }[];
  unitCosts: ReadonlyMap<string, { cost: string; currency: string }>;
  currency: string;
  rate: string | null;
}): { cost: string | null; missing: string[]; needsRate: boolean } {
  const missing = input.components
    .filter((c) => !input.unitCosts.has(c.productId))
    .map((c) => c.productName);
  if (missing.length || !input.components.length) {
    return { cost: null, missing, needsRate: false };
  }
  let total = 0n;
  for (const c of input.components) {
    const unit = input.unitCosts.get(c.productId);
    if (!unit) continue;
    let units = parseDecimal(unit.cost) * BigInt(c.units);
    if (unit.currency !== input.currency) {
      if (!input.rate || parseDecimal(input.rate, RATE_SCALE) <= 0n) {
        return { cost: null, missing: [], needsRate: true };
      }
      units = parseDecimal(divideDecimals(formatDecimal(units), input.rate, AMOUNT_SCALE));
    }
    total += units;
  }
  return {
    cost: formatDecimal(roundUnits(total, minorUnits(input.currency))),
    missing: [],
    needsRate: false,
  };
}

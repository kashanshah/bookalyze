import { formatMoney, minorUnits } from "../currency";
import { formatDecimal, parseDecimal } from "../money";
import { AMAZON_MARKETPLACES } from "./amazon";

/**
 * Watching an Amazon product for changes Amazon will actually report: price, the featured
 * offer, how many sellers, photos, the words on the page, best seller rank, and (for a brand
 * you own) what buyers mention in reviews, how that moves the star rating, and short quotes.
 * The overall star average, the total number of reviews, Amazon's Choice and the "bought in
 * the past month" tag are not in Amazon's API, so they are not offered.
 */

export const LISTING_CHECKS = [
  {
    key: "price",
    label: "Price",
    hint: "The price shoppers pay, including shipping.",
  },
  {
    key: "featured",
    label: "Featured offer",
    hint: "Who has the Buy Box, and whether that offer is Prime.",
  },
  {
    key: "offers",
    label: "Other sellers",
    hint: "How many sellers offer it new.",
  },
  {
    key: "content",
    label: "Title and description",
    hint: "The title, bullet points, and description.",
  },
  {
    key: "images",
    label: "Photos",
    hint: "The main photo and the rest of the gallery.",
  },
  {
    key: "rank",
    label: "Best seller rank",
    hint: "The ranking in each category, when it moves by about 10% or more. This is the number, not the Best Seller badge.",
  },
  {
    key: "reviews",
    label: "Review topics",
    hint: "What buyers mention, how it moves the star rating, and a few quotes. Amazon shares this for a child product of a brand you sell. The overall star average stays on Amazon.",
  },
] as const;

export type ListingCheck = (typeof LISTING_CHECKS)[number]["key"];

export const LISTING_CHECK_KEYS: readonly ListingCheck[] = LISTING_CHECKS.map((c) => c.key);

/**
 * Stores where Amazon answers review topics. Amazon.ae, Saudi Arabia, Canada and the rest
 * are not in this list: the call is refused there no matter which role the app has.
 * https://developer-docs.amazon.com/sp-api/docs/role-mappings
 */
export const REVIEW_TOPIC_MARKETPLACES: ReadonlySet<string> = new Set([
  "ATVPDKIKX0DER",
  "A1F83G8C2ARO7P",
  "A1PA6795UKMFR9",
  "A13V1IB3VIYZZH",
  "APJ6JRA9NG5V4",
  "A1RKKUPIHCS9HS",
  "A1VC38T7YXB528",
]);

export function reviewTopicsAvailable(marketplaceId: string): boolean {
  return REVIEW_TOPIC_MARKETPLACES.has(marketplaceId);
}

/** Whether this store's name is one Amazon will answer review topics for. Unknown names are left open. */
export function reviewTopicsAvailableFor(channelName: string): boolean {
  const market = AMAZON_MARKETPLACES.find((item) => item.name === channelName);
  return market ? reviewTopicsAvailable(market.id) : true;
}

export function reviewTopicsUnavailableNote(channelName: string): string {
  return `Amazon doesn't share review topics on ${channelName}. It only shares them for Amazon.com, Amazon.co.uk, Amazon.de, Amazon.fr, Amazon.it, Amazon.es, and Amazon.co.jp.`;
}

/** Hourly checks are only these. Photos, words, rank and review topics move too slowly to ask every hour. */
export const HOURLY_CHECKS: readonly ListingCheck[] = ["price", "featured", "offers"];

export const LISTING_CADENCES = [
  {
    key: "daily",
    label: "Daily",
    hint: "A good default. Most listing changes are caught within a day.",
  },
  {
    key: "weekly",
    label: "Weekly",
    hint: "For products you only need a glance at.",
  },
  {
    key: "hourly",
    label: "Hourly",
    hint: "Price, the featured offer, and other sellers. Limited to a short list, because Amazon rations these questions.",
  },
] as const;

export type ListingCadence = (typeof LISTING_CADENCES)[number]["key"];

export const MAX_LISTING_WATCHES = 200;
export const MAX_HOURLY_WATCHES = 25;

const ASIN = /^[A-Z0-9]{10}$/;

/** "b0abc12345" → "B0ABC12345", or null when it isn't an ASIN. */
export function normalizeAsin(value: string): string | null {
  const asin = value.trim().toUpperCase().replace(/\s+/g, "");
  return ASIN.test(asin) ? asin : null;
}

export function listingCheck(key: string): (typeof LISTING_CHECKS)[number] | undefined {
  return LISTING_CHECKS.find((c) => c.key === key);
}

/** Why this combination can't be saved, in words a seller can act on. */
export function listingWatchIssue(input: {
  checks: readonly ListingCheck[];
  cadence: ListingCadence;
}): string | null {
  if (input.checks.length === 0) return "Choose at least one thing to watch.";
  if (input.cadence === "hourly" && input.checks.some((c) => !HOURLY_CHECKS.includes(c))) {
    return "Hourly checks are only for price, the featured offer, and other sellers. Photos, words, rank, and review topics are checked daily or weekly.";
  }
  return null;
}

const HOUR = 60 * 60 * 1000;

/** When to look again after a successful check. */
export function checkAgainAt(cadence: ListingCadence, from: Date): Date {
  const ms = cadence === "hourly" ? HOUR : cadence === "weekly" ? 7 * 24 * HOUR : 24 * HOUR;
  return new Date(from.getTime() + ms);
}

/** The product page shoppers see. */
export function amazonProductUrl(channelName: string, asin: string): string | null {
  if (!/^Amazon\.[a-z.]+$/i.test(channelName) || !ASIN.test(asin)) return null;
  return `https://www.${channelName.toLowerCase()}/dp/${asin}`;
}

export type ListingImage = { variant: string; url: string };

export type FeaturedOffer = {
  sellerId: string | null;
  price: string | null;
  currency: string | null;
  prime: boolean;
};

export type SalesRank = { category: string; rank: number };

export type ReviewTopic = {
  topic: string;
  sentiment: "positive" | "negative";
  /** Share of reviews that mention it, e.g. "12.5", or null when Amazon didn't say. */
  share: string | null;
  /** How many reviews mention it, or null when Amazon didn't say. */
  mentions: number | null;
  /** How this topic moves the star rating. Positive lifts it. Null when Amazon didn't say. */
  starImpact: string | null;
  /** Up to three short quotes from reviews that mention it. */
  snippets: string[];
};

/** The comparable snapshot of a product. Stored as JSON; every field is plain data. */
export type ListingObservation = {
  title: string | null;
  bullets: string[];
  description: string | null;
  images: ListingImage[];
  price: string | null;
  currency: string | null;
  featured: FeaturedOffer | null;
  offerCount: number | null;
  ranks: SalesRank[];
  reviewTopics: ReviewTopic[];
  /** Set when review topics were asked for and Amazon wouldn't share them. */
  reviewNote: string | null;
};

export type ListingChange = {
  field: ListingCheck;
  summary: string;
  before: string | null;
  after: string | null;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function plain(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max = 160): string {
  const clean = plain(value);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function jsonMoney(value: unknown): { currency: string; amount: string } | null {
  const row = record(value);
  const currency = text(row.CurrencyCode).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const amount = row.Amount;
  const raw =
    typeof amount === "number" && Number.isFinite(amount)
      ? amount.toFixed(Math.min(minorUnits(currency), 4))
      : typeof amount === "string"
        ? amount
        : null;
  if (!raw) return null;
  try {
    return { currency, amount: formatDecimal(parseDecimal(raw)) };
  } catch {
    return null;
  }
}

function attributeValues(attributes: Record<string, unknown>, key: string, marketplaceId: string) {
  const list = attributes[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const row = record(item);
    const marketplace = text(row.marketplace_id);
    if (marketplace && marketplace !== marketplaceId) return [];
    const value = plain(text(row.value));
    return value ? [value] : [];
  });
}

function largestImages(groups: unknown, marketplaceId: string): ListingImage[] {
  if (!Array.isArray(groups)) return [];
  const byVariant = new Map<string, { url: string; height: number }>();
  for (const group of groups) {
    const row = record(group);
    if (text(row.marketplaceId) && text(row.marketplaceId) !== marketplaceId) continue;
    const images = row.images;
    if (!Array.isArray(images)) continue;
    for (const image of images) {
      const item = record(image);
      const variant = text(item.variant) || "MAIN";
      const url = text(item.link);
      const height = typeof item.height === "number" ? item.height : 0;
      if (!url) continue;
      const current = byVariant.get(variant);
      if (!current || height > current.height) byVariant.set(variant, { url, height });
    }
  }
  return [...byVariant.entries()]
    .map(([variant, image]) => ({ variant, url: image.url }))
    .sort((a, b) => a.variant.localeCompare(b.variant));
}

function ranksOf(salesRanks: unknown, marketplaceId: string): SalesRank[] {
  if (!Array.isArray(salesRanks)) return [];
  const ranks: SalesRank[] = [];
  for (const group of salesRanks) {
    const row = record(group);
    if (text(row.marketplaceId) && text(row.marketplaceId) !== marketplaceId) continue;
    for (const key of ["displayGroupRanks", "classificationRanks"] as const) {
      const list = row[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const rank = record(item);
        const category = plain(text(rank.title));
        const place = rank.rank;
        if (!category || typeof place !== "number" || !Number.isInteger(place) || place < 1)
          continue;
        ranks.push({ category, rank: place });
      }
    }
  }
  const seen = new Set<string>();
  return ranks.filter((rank) => {
    const key = rank.category.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Reads GET /catalog/2022-04-01/items/{asin}. */
export function parseCatalogItem(
  json: unknown,
  marketplaceId: string,
): Pick<ListingObservation, "title" | "bullets" | "description" | "images" | "ranks"> {
  const body = record(json);
  const summaries = Array.isArray(body.summaries) ? body.summaries.map(record) : [];
  const summary =
    summaries.find((s) => text(s.marketplaceId) === marketplaceId) ?? summaries[0] ?? {};
  const attributes = record(body.attributes);
  const names = attributeValues(attributes, "item_name", marketplaceId);
  const bullets = attributeValues(attributes, "bullet_point", marketplaceId);
  const descriptions = attributeValues(attributes, "product_description", marketplaceId);
  return {
    title: names[0] ?? (plain(text(summary.itemName)) || null),
    bullets,
    description: descriptions[0] ?? null,
    images: largestImages(body.images, marketplaceId),
    ranks: ranksOf(body.salesRanks, marketplaceId),
  };
}

/** Reads GET /products/pricing/v0/items/{asin}/offers. */
export function parseItemOffers(
  json: unknown,
): Pick<ListingObservation, "price" | "currency" | "featured" | "offerCount"> {
  const payload = record(record(json).payload ?? json);
  const summary = record(payload.Summary);
  const offers = Array.isArray(payload.Offers) ? payload.Offers.map(record) : [];
  const winner = offers.find((o) => o.IsBuyBoxWinner === true) ?? null;
  const buyBox = Array.isArray(summary.BuyBoxPrices)
    ? jsonMoney(record(summary.BuyBoxPrices[0]).LandedPrice)
    : null;
  const winnerPrice = winner
    ? (jsonMoney(winner.LandedPrice) ?? jsonMoney(winner.ListingPrice))
    : null;
  const lowest = Array.isArray(summary.LowestPrices)
    ? summary.LowestPrices.map(record).find(
        (p) => text(p.condition) === "New" || !text(p.condition),
      )
    : undefined;
  const lowestPrice = lowest ? jsonMoney(lowest.LandedPrice) : null;
  const price = buyBox ?? winnerPrice ?? lowestPrice;
  const count = summary.TotalOfferCount;
  const prime = record(winner?.PrimeInformation);
  return {
    price: price?.amount ?? null,
    currency: price?.currency ?? null,
    featured: winner
      ? {
          sellerId: text(winner.SellerId) || null,
          price: (winnerPrice ?? buyBox)?.amount ?? null,
          currency: (winnerPrice ?? buyBox)?.currency ?? null,
          prime: prime.IsPrime === true || winner.IsPrime === true,
        }
      : buyBox
        ? { sellerId: null, price: buyBox.amount, currency: buyBox.currency, prime: false }
        : null,
    offerCount:
      typeof count === "number" && Number.isFinite(count)
        ? Math.max(0, Math.round(count))
        : offers.length || null,
  };
}

const TOPIC_CAP = 8;

function oneDecimal(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : null;
}

function snippetsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const snippet = clip(text(item), 180);
      return snippet ? [snippet] : [];
    })
    .slice(0, 3);
}

function topicsOf(list: unknown, sentiment: ReviewTopic["sentiment"]): ReviewTopic[] {
  if (!Array.isArray(list)) return [];
  const topics = list.flatMap((item) => {
    const row = record(item);
    const topic = plain(text(row.topic));
    if (!topic) return [];
    const metrics = record(row.asinMetrics);
    const mentions = metrics.numberOfMentions;
    return [
      {
        topic,
        sentiment,
        share: oneDecimal(metrics.occurrencePercentage),
        mentions:
          typeof mentions === "number" && Number.isFinite(mentions) ? Math.round(mentions) : null,
        starImpact: oneDecimal(metrics.starRatingImpact),
        snippets: snippetsOf(row.reviewSnippets),
      },
    ];
  });
  return topics
    .sort((a, b) => Number(b.share ?? -1) - Number(a.share ?? -1) || a.topic.localeCompare(b.topic))
    .slice(0, TOPIC_CAP);
}

/** Reads the Customer Feedback API's review topics. An empty list is a real answer. */
export function parseReviewTopics(json: unknown): ReviewTopic[] {
  const topics = record(record(json).topics);
  return [
    ...topicsOf(topics.positiveTopics, "positive"),
    ...topicsOf(topics.negativeTopics, "negative"),
  ];
}

export type ListingValue = { label: string; value: string };

/**
 * The latest look, as short labeled values. Price, the featured offer, how many sellers,
 * each best seller rank, and a short note of the words on the page when `content` is set.
 */
export function listingValues(
  observed: ListingObservation,
  locale: string,
  options?: { content?: boolean },
): ListingValue[] {
  const values: ListingValue[] = [];
  if (observed.price && observed.currency) {
    values.push({
      label: "Price",
      value: moneyLabel(observed.price, observed.currency, locale),
    });
  }
  if (observed.featured) {
    const amount =
      observed.featured.price && observed.featured.currency
        ? moneyLabel(observed.featured.price, observed.featured.currency, locale)
        : null;
    const parts = [amount, observed.featured.prime ? "Prime" : null].filter(
      (part): part is string => Boolean(part),
    );
    values.push({ label: "Featured offer", value: parts.length ? parts.join(" · ") : "Listed" });
  } else if (observed.price || observed.offerCount !== null) {
    values.push({ label: "Featured offer", value: "None right now" });
  }
  if (observed.offerCount !== null) {
    values.push({
      label: "Other sellers",
      value: observed.offerCount === 1 ? "1 seller" : `${observed.offerCount} sellers`,
    });
  }
  const number = new Intl.NumberFormat(locale);
  for (const rank of observed.ranks ?? []) {
    values.push({
      label: "Best seller rank",
      value: `#${number.format(rank.rank)} in ${rank.category}`,
    });
  }
  if (options?.content) {
    const words = contentValue(observed);
    if (words) values.push({ label: "Title and description", value: words });
  }
  const topics = observed.reviewTopics ?? [];
  if (topics.length) {
    values.push({
      label: "Reviews",
      value: topics
        .slice(0, 3)
        .map((topic) => topic.topic)
        .join(", "),
    });
  }
  return values;
}

function contentValue(observed: ListingObservation): string | null {
  const parts: string[] = [];
  if (observed.bullets?.length === 1) parts.push("1 bullet");
  else if (observed.bullets?.length) parts.push(`${observed.bullets.length} bullets`);
  const description = observed.description ? clip(observed.description, 80) : "";
  if (description) parts.push(description);
  return parts.length ? parts.join(" · ") : null;
}

export const EMPTY_OBSERVATION: ListingObservation = {
  title: null,
  bullets: [],
  description: null,
  images: [],
  price: null,
  currency: null,
  featured: null,
  offerCount: null,
  ranks: [],
  reviewTopics: [],
  reviewNote: null,
};

function moneyLabel(amount: string, currency: string, locale: string): string {
  try {
    return formatMoney(amount, currency, locale);
  } catch {
    return amount;
  }
}

function sameMoney(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  try {
    return parseDecimal(a) === parseDecimal(b);
  } catch {
    return false;
  }
}

function rankMoved(before: number, after: number): boolean {
  const delta = Math.abs(after - before);
  if (delta < 5) return false;
  return delta / Math.max(before, 1) >= 0.1;
}

function photoSummary(before: ListingImage[], after: ListingImage[]): string | null {
  const previous = new Map(before.map((image) => [image.variant, image.url]));
  const next = new Map(after.map((image) => [image.variant, image.url]));
  const mainChanged =
    previous.get("MAIN") !== next.get("MAIN") && (previous.has("MAIN") || next.has("MAIN"));
  let added = 0;
  let removed = 0;
  let replaced = 0;
  for (const [variant, url] of next) {
    if (!previous.has(variant)) added += 1;
    else if (previous.get(variant) !== url && variant !== "MAIN") replaced += 1;
  }
  for (const variant of previous.keys()) if (!next.has(variant)) removed += 1;
  if (!mainChanged && added === 0 && removed === 0 && replaced === 0) return null;
  if (mainChanged && (added || removed)) {
    return `The main photo changed, and there are now ${after.length} photos (was ${before.length}).`;
  }
  if (mainChanged) return "The main photo changed.";
  if (added && !removed && !replaced) {
    return added === 1 ? "A photo was added." : `${added} photos were added.`;
  }
  if (removed && !added && !replaced) {
    return removed === 1 ? "A photo was removed." : `${removed} photos were removed.`;
  }
  return "The photos changed.";
}

function contentSummary(
  before: ListingObservation,
  after: ListingObservation,
): ListingChange | null {
  const parts: string[] = [];
  if ((before.title ?? "") !== (after.title ?? "")) parts.push("title");
  if (before.bullets.join("\n") !== after.bullets.join("\n")) parts.push("bullet points");
  if ((before.description ?? "") !== (after.description ?? "")) parts.push("description");
  if (!parts.length) return null;
  const summary =
    parts.length === 1
      ? parts[0] === "title"
        ? "The title changed."
        : parts[0] === "bullet points"
          ? "The bullet points changed."
          : "The description changed."
      : `The ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)} changed.`;
  const titleOnly = parts.length === 1 && parts[0] === "title";
  return {
    field: "content",
    summary,
    before: titleOnly ? clip(before.title ?? "") || null : null,
    after: titleOnly ? clip(after.title ?? "") || null : null,
  };
}

function featuredSummary(before: FeaturedOffer | null, after: FeaturedOffer | null): string | null {
  if (!before && after) return "A featured offer is available.";
  if (before && !after) return "There's no featured offer right now.";
  if (!before || !after) return null;
  const sellerMoved =
    before.sellerId !== null && after.sellerId !== null && before.sellerId !== after.sellerId;
  if (sellerMoved) return "The featured offer moved to another seller.";
  if (before.prime !== after.prime) {
    return after.prime
      ? "The featured offer is now Prime."
      : "The featured offer is no longer Prime.";
  }
  return null;
}

/**
 * One change per category whose best seller rank moved (at most three). `before` and `after`
 * are the plain rank numbers ("1234"), so a list or an email can show which way it went.
 */
function rankChanges(before: SalesRank[], after: SalesRank[], locale: string): ListingChange[] {
  const previous = new Map(before.map((rank) => [rank.category.toLowerCase(), rank]));
  const next = new Map(after.map((rank) => [rank.category.toLowerCase(), rank]));
  const changes: ListingChange[] = [];
  const place = (n: number) => `#${new Intl.NumberFormat(locale).format(n)}`;
  for (const rank of after) {
    const old = previous.get(rank.category.toLowerCase());
    if (!old) {
      changes.push({
        field: "rank",
        summary: `Now ranked ${place(rank.rank)} in ${rank.category}.`,
        before: null,
        after: String(rank.rank),
      });
      continue;
    }
    if (rankMoved(old.rank, rank.rank)) {
      const verb = rank.rank < old.rank ? "Climbed" : "Fell";
      changes.push({
        field: "rank",
        summary: `${verb} from ${place(old.rank)} to ${place(rank.rank)} in ${rank.category}.`,
        before: String(old.rank),
        after: String(rank.rank),
      });
    }
  }
  for (const rank of before) {
    if (!next.has(rank.category.toLowerCase())) {
      changes.push({
        field: "rank",
        summary: `No longer ranked in ${rank.category} (was ${place(rank.rank)}).`,
        before: String(rank.rank),
        after: null,
      });
    }
  }
  return changes.slice(0, 3);
}

/**
 * Which way a best seller rank went. A lower number is better, so "up" means it climbed. Null
 * for anything that isn't a rank move with both numbers (and for rank changes saved before the
 * numbers were kept).
 */
export function rankTrend(change: {
  field: string;
  before: string | null;
  after: string | null;
}): { direction: "up" | "down"; places: number } | null {
  if (change.field !== "rank" || !change.before || !change.after) return null;
  const before = Number(change.before);
  const after = Number(change.after);
  if (!Number.isInteger(before) || !Number.isInteger(after) || before === after) return null;
  return { direction: after < before ? "up" : "down", places: Math.abs(before - after) };
}

/** "Best seller rank", "Price"…: the name of what a change is about. */
export function listingCheckLabel(field: string): string {
  return LISTING_CHECKS.find((check) => check.key === field)?.label ?? "Listing";
}

function reviewSummary(before: ReviewTopic[], after: ReviewTopic[]): string | null {
  const key = (topic: ReviewTopic) => `${topic.sentiment}:${topic.topic.toLowerCase()}`;
  const previous = new Map(before.map((topic) => [key(topic), topic]));
  const next = new Map(after.map((topic) => [key(topic), topic]));
  const lines: string[] = [];
  for (const topic of after) {
    const old = previous.get(key(topic));
    const name = topic.sentiment === "negative" ? `${topic.topic} (a complaint)` : topic.topic;
    if (!old) {
      lines.push(`Buyers are mentioning “${name}”.`);
      continue;
    }
    if (topic.share === null || old.share === null) continue;
    const delta = Math.abs(Number(topic.share) - Number(old.share));
    if (delta < 1) continue;
    const direction = Number(topic.share) > Number(old.share) ? "More" : "Fewer";
    lines.push(
      `${direction} buyers mention “${name}” (${topic.share}% of reviews, was ${old.share}%).`,
    );
  }
  for (const topic of before) {
    if (!next.has(key(topic))) lines.push(`Buyers stopped mentioning “${topic.topic}”.`);
  }
  if (!lines.length) return null;
  return lines.slice(0, 3).join(" ");
}

/**
 * What changed since the last look, for the checks that are switched on. The first look (no
 * previous snapshot) is the baseline and reports nothing.
 */
export function diffListing(
  previous: ListingObservation | null,
  next: ListingObservation,
  checks: readonly ListingCheck[],
  locale = "en-CA",
): ListingChange[] {
  if (!previous) return [];
  const on = new Set(checks);
  const changes: ListingChange[] = [];
  if (on.has("price") && !sameMoney(previous.price, next.price)) {
    const currency = next.currency ?? previous.currency ?? "USD";
    const label = (amount: string | null) =>
      amount ? moneyLabel(amount, currency, locale) : "no price";
    changes.push({
      field: "price",
      summary:
        previous.price && next.price
          ? `Price went from ${label(previous.price)} to ${label(next.price)}.`
          : next.price
            ? `A price is listed again: ${label(next.price)}.`
            : "The price is no longer listed.",
      before: previous.price,
      after: next.price,
    });
  }
  if (on.has("featured")) {
    const summary = featuredSummary(previous.featured, next.featured);
    if (summary) {
      changes.push({ field: "featured", summary, before: null, after: null });
    }
  }
  if (on.has("offers") && previous.offerCount !== next.offerCount) {
    const summary =
      previous.offerCount === null
        ? `${next.offerCount} sellers offer it new.`
        : next.offerCount === null
          ? "Amazon didn't say how many sellers offer it."
          : next.offerCount === 1
            ? `1 seller offers it new (was ${previous.offerCount}).`
            : `${next.offerCount} sellers offer it new (was ${previous.offerCount}).`;
    changes.push({
      field: "offers",
      summary,
      before: previous.offerCount === null ? null : String(previous.offerCount),
      after: next.offerCount === null ? null : String(next.offerCount),
    });
  }
  if (on.has("content")) {
    const change = contentSummary(previous, next);
    if (change) changes.push(change);
  }
  if (on.has("images")) {
    const summary = photoSummary(previous.images, next.images);
    if (summary) {
      changes.push({
        field: "images",
        summary,
        before: `${previous.images.length} photos`,
        after: `${next.images.length} photos`,
      });
    }
  }
  if (on.has("rank")) changes.push(...rankChanges(previous.ranks, next.ranks, locale));
  if (on.has("reviews")) {
    const summary = reviewSummary(previous.reviewTopics, next.reviewTopics);
    if (summary) changes.push({ field: "reviews", summary, before: null, after: null });
  }
  return changes;
}

/** One line for a list: the first change, and how many others arrived with it. */
export function changeHeadline(changes: readonly { summary: string }[]): string | null {
  const first = changes[0];
  if (!first) return null;
  if (changes.length === 1) return first.summary;
  const more = changes.length - 1;
  return `${first.summary} ${more} more ${more === 1 ? "change" : "changes"}.`;
}

/** The main photo, for the list. */
export function mainImageUrl(observation: ListingObservation | null): string | null {
  return (
    observation?.images.find((image) => image.variant === "MAIN")?.url ??
    observation?.images[0]?.url ??
    null
  );
}

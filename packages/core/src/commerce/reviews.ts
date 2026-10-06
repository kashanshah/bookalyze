import { addDaysIso } from "../entity/compliance";
import { parseDecimal } from "../money";

/**
 * Amazon review requests: when to ask, which orders to leave out, and reading Amazon's answers.
 * Requests go through Amazon's own "Request a Review" (the Solicitations API): one standard
 * message asking for a product review and seller feedback, in the buyer's language. Amazon allows
 * one per order, from 5 days after the earliest delivery date to 30 days after the latest.
 *
 * Amazon gives delivery dates only for orders the seller ships. For orders it ships itself (FBA)
 * the dates are estimated from the purchase day, and Amazon's own answer (whether it offers
 * "Request a Review" for the order now) decides; that answer is kept on the order.
 */

/** Amazon's window, in days after delivery. */
export const REVIEW_WINDOW_OPENS_DAYS = 5;
export const REVIEW_WINDOW_CLOSES_DAYS = 30;
/** The delay people can choose, in days after the latest delivery date. */
export const REVIEW_DELAY_MIN = 5;
export const REVIEW_DELAY_MAX = 25;
/**
 * Without Amazon's delivery dates (FBA), delivery is taken as 1 to 7 days after the purchase
 * day: the window shown is an estimate, and Amazon is asked before anything is sent.
 */
export const ESTIMATED_DELIVERY_FROM_DAYS = 1;
export const ESTIMATED_DELIVERY_TO_DAYS = 7;

export const REVIEW_FULFILLMENT = ["all", "amazon", "merchant"] as const;
export type ReviewFulfillment = (typeof REVIEW_FULFILLMENT)[number];

export type ReviewSettings = {
  enabled: boolean;
  /** Days after the latest delivery date. */
  daysAfterDelivery: number;
  /** Hour of the day (0–23) in the company's timezone. */
  sendHour: number;
  /** Days of the week requests may go out on (0 = Sunday). */
  sendDays: number[];
  /** Only these marketplaces (sales channel IDs); null means all of them. */
  channelIds: string[] | null;
  fulfillment: ReviewFulfillment;
  skipRefunded: boolean;
  skipReplacements: boolean;
  skipBusiness: boolean;
  skipPromotions: boolean;
  /** Orders with any of these SKUs aren't asked. */
  excludedSkus: string[];
  /** Orders delivered (latest delivery date) before this day aren't asked automatically. */
  startsFrom: string | null;
};

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  enabled: false,
  daysAfterDelivery: 7,
  sendHour: 10,
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  channelIds: null,
  fulfillment: "all",
  skipRefunded: true,
  skipReplacements: true,
  skipBusiness: false,
  skipPromotions: false,
  excludedSkus: [],
  startsFrom: null,
};

export const REVIEW_STATUSES = ["scheduled", "sent", "skipped", "not_eligible", "failed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_SOURCES = ["auto", "manual", "bulk"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, { label: string; hint: string }> = {
  scheduled: { label: "Scheduled", hint: "Will be sent at the time shown." },
  sent: { label: "Requested", hint: "Amazon sent the buyer its review request." },
  skipped: { label: "Skipped", hint: "Left out on purpose." },
  not_eligible: { label: "Not eligible", hint: "Amazon wouldn't take a request for this order." },
  failed: { label: "Didn't go through", hint: "Something went wrong; it can be tried again." },
};

/** The facts about an order that review requests depend on. */
export type ReviewOrder = {
  status: string;
  channelId: string;
  fulfillment: "amazon" | "merchant";
  isBusiness: boolean;
  isReplacement: boolean;
  earliestDelivery: string | null;
  latestDelivery: string | null;
  /** The purchase day (YYYY-MM-DD, UTC), for estimating delivery when Amazon gives no dates. */
  purchasedOn: string | null;
  skus: readonly string[];
  /** Any item bought with a promotion. */
  hasPromotion: boolean;
};

const SHIPPED = ["Shipped", "InvoiceUnconfirmed"];
const CANCELLED = ["Canceled", "Unfulfillable"];

export type DeliveryFacts = Pick<ReviewOrder, "earliestDelivery" | "latestDelivery"> & {
  purchasedOn?: string | null;
};

/**
 * When the order arrives: Amazon's delivery dates, or (when Amazon gives none, as for FBA
 * orders) an estimate from the purchase day. Null when neither is known.
 */
export function deliveryDates(
  order: DeliveryFacts,
): { earliest: string; latest: string; estimated: boolean } | null {
  if (order.latestDelivery) {
    return {
      earliest: order.earliestDelivery ?? order.latestDelivery,
      latest: order.latestDelivery,
      estimated: false,
    };
  }
  if (!order.purchasedOn) return null;
  return {
    earliest: addDaysIso(order.purchasedOn, ESTIMATED_DELIVERY_FROM_DAYS),
    latest: addDaysIso(order.purchasedOn, ESTIMATED_DELIVERY_TO_DAYS),
    estimated: true,
  };
}

/**
 * First and last day Amazon takes a request for the order (`estimated` without Amazon's delivery
 * dates), or null when nothing is known.
 */
export function reviewWindow(order: DeliveryFacts) {
  const delivery = deliveryDates(order);
  if (!delivery) return null;
  return {
    opens: addDaysIso(delivery.earliest, REVIEW_WINDOW_OPENS_DAYS),
    closes: addDaysIso(delivery.latest, REVIEW_WINDOW_CLOSES_DAYS),
    estimated: delivery.estimated,
  };
}

/**
 * Why an order can't be asked yet or won't be asked automatically (plain words), or null when it
 * can. `waiting` means it may become possible later (not shipped, no delivery date yet).
 */
export function reviewHold(
  order: ReviewOrder,
  settings: ReviewSettings | null,
): { reason: string; waiting: boolean } | null {
  if (CANCELLED.includes(order.status)) return { reason: "Cancelled", waiting: false };
  if (!SHIPPED.includes(order.status)) return { reason: "Not shipped yet", waiting: true };
  const delivery = deliveryDates(order);
  if (!delivery) {
    return { reason: "Amazon hasn't given a delivery date yet", waiting: true };
  }
  if (!settings) return null;
  if (settings.channelIds && !settings.channelIds.includes(order.channelId)) {
    return { reason: "Its marketplace is left out of automatic requests", waiting: false };
  }
  if (settings.fulfillment !== "all" && settings.fulfillment !== order.fulfillment) {
    return {
      reason:
        order.fulfillment === "amazon"
          ? "Shipped by Amazon (FBA): automatic requests are for your own shipments only"
          : "Shipped by you: automatic requests are for Amazon (FBA) orders only",
      waiting: false,
    };
  }
  if (settings.skipReplacements && order.isReplacement) {
    return { reason: "Replacement order", waiting: false };
  }
  if (settings.skipBusiness && order.isBusiness) {
    return { reason: "Business order", waiting: false };
  }
  if (settings.skipPromotions && order.hasPromotion) {
    return { reason: "Bought with a promotion", waiting: false };
  }
  const excluded = order.skus.find((s) => settings.excludedSkus.includes(s));
  if (excluded) return { reason: `Includes ${excluded}, which is left out`, waiting: false };
  if (settings.startsFrom && delivery.latest < settings.startsFrom) {
    return { reason: "Delivered before automatic requests started", waiting: false };
  }
  return null;
}

/**
 * The day to ask: the chosen number of days after the latest (or latest estimated) delivery date, no earlier than
 * Amazon's window opens, moved on to an allowed weekday. Null once the window has closed (the
 * last day is kept free, so Amazon's clock never sees it late).
 */
export function reviewSendDay(
  order: DeliveryFacts,
  settings: Pick<ReviewSettings, "daysAfterDelivery" | "sendDays">,
  today: string,
): string | null {
  const window = reviewWindow(order);
  const delivery = deliveryDates(order);
  if (!window || !delivery) return null;
  const last = addDaysIso(window.closes, -1);
  let day = addDaysIso(delivery.latest, settings.daysAfterDelivery);
  if (day < window.opens) day = window.opens;
  if (day < today) day = today;
  const days = settings.sendDays.length ? settings.sendDays : [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 7 && day <= last; i++) {
    if (days.includes(weekday(day))) return day;
    day = addDaysIso(day, 1);
  }
  return null;
}

/** 0 = Sunday. */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The instant `hour`:00 on `day` in `timeZone` (handles daylight saving). */
export function zonedInstant(day: string, hour: number, timeZone: string): Date {
  const target = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hour);
  let guess = target;
  for (let i = 0; i < 2; i++) guess = target - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

function offsetMs(at: Date, timeZone: string): number {
  const parts: Record<string, string> = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const n = (type: string) => Number(parts[type] ?? 0);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

// --- Amazon's answers ----------------------------------------------------------------------

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const REVIEW_ACTION = "productReviewAndSellerFeedback";

/** GET /solicitations/v1/orders/{id}: whether Amazon offers a review request for the order now. */
export function parseSolicitationActions(json: unknown): boolean {
  const body = record(json);
  const linked = list(record(body._links).actions).map((a) => record(a).name);
  const embedded = list(record(body._embedded).actions).flatMap((a) => {
    const action = record(a);
    return [action.name, record(record(action._links).self).name];
  });
  return [...linked, ...embedded].includes(REVIEW_ACTION);
}

/**
 * GET /finances/v0/orders/{id}/financialEvents: why the order shouldn't be asked (refunded,
 * an A-to-z claim or a chargeback), or null.
 */
export function refundReason(json: unknown): string | null {
  const events = record(record(record(json).payload).FinancialEvents);
  const has = (key: string) => list(events[key]).length > 0;
  if (has("RefundEventList")) return "Refunded or returned";
  if (has("GuaranteeClaimEventList")) return "The buyer filed an A-to-z claim";
  if (has("ChargebackEventList")) return "The buyer's bank reversed the payment";
  return null;
}

/** Whether any item carried a promotion discount (for "skip promotions"). */
export const hasPromotion = (discounts: readonly (string | null)[]) =>
  discounts.some((d) => d !== null && parseDecimal(d) !== 0n);

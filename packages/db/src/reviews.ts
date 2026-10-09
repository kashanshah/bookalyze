import {
  DEFAULT_REVIEW_SETTINGS,
  ESTIMATED_DELIVERY_FROM_DAYS,
  ESTIMATED_DELIVERY_TO_DAYS,
  REVIEW_WINDOW_CLOSES_DAYS,
  REVIEW_WINDOW_OPENS_DAYS,
  type ReviewSettings,
  type ReviewSource,
  type ReviewStatus,
} from "@bookalyze/core";
import { and, asc, desc, eq, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import {
  orderItems,
  orders,
  reviewRequests,
  reviewSettings,
  salesChannels,
} from "./schema/commerce";

/**
 * Amazon review requests: the company's automatic settings, and one request row per order
 * (scheduled, sent, skipped, not eligible or failed). Orders without a row haven't been asked.
 */

export async function getReviewSettings(tx: Transaction): Promise<ReviewSettings> {
  const [row] = await tx.select().from(reviewSettings).limit(1);
  if (!row) return DEFAULT_REVIEW_SETTINGS;
  return {
    enabled: row.enabled,
    daysAfterDelivery: row.daysAfterDelivery,
    sendHour: row.sendHour,
    sendDays: row.sendDays,
    channelIds: row.channelIds,
    fulfillment: row.fulfillment,
    skipRefunded: row.skipRefunded,
    skipReplacements: row.skipReplacements,
    skipBusiness: row.skipBusiness,
    skipPromotions: row.skipPromotions,
    excludedSkus: row.excludedSkus,
    startsFrom: row.startsFrom,
  };
}

/**
 * Saves the settings and clears what the automation had planned (scheduled and auto-skipped
 * orders), so the next run plans again under the new rules. Returns how many were cleared.
 */
export async function saveReviewSettings(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settings: ReviewSettings },
) {
  const values = { ...input.settings, updatedBy: input.userId, updatedAt: new Date() };
  await tx
    .insert(reviewSettings)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: reviewSettings.organizationId, set: values });
  const cleared = await tx
    .delete(reviewRequests)
    .where(
      and(
        eq(reviewRequests.source, "auto"),
        inArray(reviewRequests.status, ["scheduled", "skipped"]),
      ),
    )
    .returning({ id: reviewRequests.id });
  return cleared.length;
}

/** The purchase day (UTC), which delivery is estimated from when Amazon gives no dates (FBA). */
const purchasedOn = sql<string>`((${orders.purchasedAt} at time zone 'UTC')::date)::text`;
/** Delivery dates as core `deliveryDates` reads them: Amazon's, or estimated from the purchase. */
const earliestDelivery = sql`(case when ${orders.latestDelivery} is null then (${orders.purchasedAt} at time zone 'UTC')::date + ${ESTIMATED_DELIVERY_FROM_DAYS}::int else coalesce(${orders.earliestDelivery}, ${orders.latestDelivery}) end)`;
const latestDelivery = sql`coalesce(${orders.latestDelivery}, (${orders.purchasedAt} at time zone 'UTC')::date + ${ESTIMATED_DELIVERY_TO_DAYS}::int)`;
const opens = sql<string>`(${earliestDelivery} + ${REVIEW_WINDOW_OPENS_DAYS}::int)::text`;
const closes = sql<string>`(${latestDelivery} + ${REVIEW_WINDOW_CLOSES_DAYS}::int)::text`;
const shipped = inArray(orders.status, ["Shipped", "InvoiceUnconfirmed"]);
/** The window hasn't closed (its last day is kept free). */
const windowOpenUntil = (today: string) =>
  sql`${latestDelivery} + ${REVIEW_WINDOW_CLOSES_DAYS - 1}::int >= ${today}::date`;
/** The (possibly estimated) window has opened. */
const windowOpened = (today: string) => sql`${opens}::date <= ${today}::date`;
/**
 * Ready to ask today: Amazon offered a request when last checked, or (not checked yet) the window
 * has opened. Amazon is asked again before anything is sent.
 */
const readyToday = (today: string) =>
  and(
    windowOpenUntil(today),
    or(eq(orders.reviewEligible, true), and(isNull(orders.reviewEligible), windowOpened(today))),
  );
/** Review requests are Amazon's: orders on other marketplaces (Noon) are never asked. */
const onAmazon = sql<boolean>`exists (select 1 from sales_channels rc where rc.id = ${orders.channelId} and rc.kind = 'amazon')`;
const unasked = notExists(sql`(select 1 from ${reviewRequests} r where r.order_id = ${orders.id})`);
const skus = sql<
  string[]
>`array(select i.sku from ${orderItems} i where i.order_id = ${orders.id} and i.sku is not null)`;
const promoted = sql<boolean>`exists (select 1 from ${orderItems} i where i.order_id = ${orders.id} and coalesce(i.promotion_discount, 0) <> 0)`;
const firstTitle = sql<
  string | null
>`(select coalesce(i.title, i.sku) from ${orderItems} i where i.order_id = ${orders.id} order by i.item_price desc nulls last, i.external_id limit 1)`;

/**
 * Shipped orders nobody has asked or planned for, whose window hasn't closed: what the planner
 * looks at. With `needsItems`, only orders whose items are in (to check SKUs and promotions).
 */
export async function reviewCandidates(
  tx: Transaction,
  input: { today: string; needsItems: boolean; limit: number },
) {
  return (
    tx
      .select({
        id: orders.id,
        status: orders.status,
        channelId: orders.channelId,
        fulfillment: orders.fulfillment,
        isBusiness: orders.isBusiness,
        isReplacement: orders.isReplacement,
        earliestDelivery: orders.earliestDelivery,
        latestDelivery: orders.latestDelivery,
        purchasedOn,
        skus,
        hasPromotion: promoted,
      })
      .from(orders)
      // The join makes Drizzle qualify column names, which the item subqueries rely on.
      .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
      .where(
        and(
          shipped,
          onAmazon,
          windowOpenUntil(input.today),
          unasked,
          input.needsItems ? sql`${orders.itemsSyncedAt} is not null` : undefined,
        ),
      )
      .orderBy(asc(latestDelivery), asc(orders.id))
      .limit(input.limit)
  );
}

export type PlannedReview = {
  orderId: string;
  status: Extract<ReviewStatus, "scheduled" | "skipped">;
  dueAt: Date | null;
  reason: string | null;
};

/** Plans automatic requests. Orders that already have a request are left alone. */
export async function planReviewRequests(
  tx: Transaction,
  orgId: string,
  planned: readonly PlannedReview[],
) {
  if (!planned.length) return 0;
  const saved = await tx
    .insert(reviewRequests)
    .values(planned.map((p) => ({ organizationId: orgId, source: "auto" as const, ...p })))
    .onConflictDoNothing({ target: reviewRequests.orderId })
    .returning({ id: reviewRequests.id });
  return saved.length;
}

/** What sending a request needs: the order, its marketplace and the connection. */
const sendable = {
  orderId: orders.id,
  externalId: orders.externalId,
  status: orders.status,
  earliestDelivery: orders.earliestDelivery,
  latestDelivery: orders.latestDelivery,
  purchasedOn,
  refunded: orders.refunded,
  financeCheckedAt: orders.financeCheckedAt,
  channelId: salesChannels.id,
  marketplaceId: salesChannels.marketplaceId,
};

/** Scheduled requests that are due, oldest first. */
export async function dueReviewRequests(tx: Transaction, input: { now: Date; limit: number }) {
  return tx
    .select({
      id: reviewRequests.id,
      source: reviewRequests.source,
      attempts: reviewRequests.attempts,
      ...sendable,
    })
    .from(reviewRequests)
    .innerJoin(orders, eq(orders.id, reviewRequests.orderId))
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(
      and(
        eq(reviewRequests.status, "scheduled"),
        sql`${reviewRequests.dueAt} <= ${input.now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(reviewRequests.dueAt), asc(reviewRequests.id))
    .limit(input.limit);
}

/** Orders to ask by hand, with whatever request they already have. */
export async function reviewTargets(tx: Transaction, orderIds: readonly string[]) {
  if (!orderIds.length) return [];
  return tx
    .select({ ...sendable, request: reviewRequests.status })
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .leftJoin(reviewRequests, eq(reviewRequests.orderId, orders.id))
    .where(and(inArray(orders.id, [...orderIds]), onAmazon));
}

/** Orders whose window is open today and nobody asked: "Ask all". */
export async function readyToAsk(
  tx: Transaction,
  input: { today: string; channelId?: string | null; limit: number },
) {
  const rows = await tx
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(
      and(
        shipped,
        onAmazon,
        unasked,
        readyToday(input.today),
        input.channelId ? eq(orders.channelId, input.channelId) : undefined,
      ),
    )
    .orderBy(asc(closes), asc(orders.id))
    .limit(input.limit);
  return rows.map((r) => r.id);
}

/**
 * Orders whose eligibility is worth asking Amazon about: shipped, inside the (possibly estimated)
 * window, not asked or left out yet, and not checked since `checkedBefore`. Never checked first.
 */
export async function ordersToCheckEligibility(
  tx: Transaction,
  input: { today: string; checkedBefore: Date; limit: number },
) {
  return tx
    .select(sendable)
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .leftJoin(reviewRequests, eq(reviewRequests.orderId, orders.id))
    .where(
      and(
        shipped,
        onAmazon,
        windowOpened(input.today),
        windowOpenUntil(input.today),
        or(isNull(reviewRequests.status), eq(reviewRequests.status, "scheduled")),
        or(
          isNull(orders.reviewCheckedAt),
          sql`${orders.reviewCheckedAt} < ${input.checkedBefore.toISOString()}::timestamptz`,
        ),
      ),
    )
    .orderBy(sql`${orders.reviewCheckedAt} asc nulls first`, asc(closes), asc(orders.id))
    .limit(input.limit);
}

/**
 * Keeps Amazon's answer: whether it offers "Request a Review" for the order now (null: it
 * couldn't be asked, e.g. no connection; the check still counts, so it isn't retried at once).
 */
export async function saveReviewEligibility(
  tx: Transaction,
  orderId: string,
  eligible: boolean | null,
  at = new Date(),
) {
  await tx
    .update(orders)
    .set({ reviewEligible: eligible, reviewCheckedAt: at })
    .where(eq(orders.id, orderId));
}

/**
 * Records what happened to an order's request (sent, skipped, not eligible, failed, or
 * rescheduled). A request that went out is never overwritten.
 */
export async function recordReviewOutcome(
  tx: Transaction,
  input: {
    orgId: string;
    orderId: string;
    source: ReviewSource;
    status: ReviewStatus;
    reason?: string | null;
    dueAt?: Date | null;
    userId?: string | null;
    /** Count this as a try (talked to Amazon). */
    attempted?: boolean;
  },
) {
  const now = new Date();
  const values = {
    status: input.status,
    source: input.source,
    reason: input.reason ?? null,
    dueAt: input.status === "scheduled" ? (input.dueAt ?? null) : null,
    sentAt: input.status === "sent" ? now : null,
    requestedBy: input.userId ?? null,
  };
  const [row] = await tx
    .insert(reviewRequests)
    .values({
      organizationId: input.orgId,
      orderId: input.orderId,
      attempts: input.attempted ? 1 : 0,
      ...values,
    })
    .onConflictDoUpdate({
      target: reviewRequests.orderId,
      set: {
        ...values,
        requestedBy:
          input.userId === undefined ? sql`${reviewRequests.requestedBy}` : values.requestedBy,
        attempts: input.attempted
          ? sql`${reviewRequests.attempts} + 1`
          : sql`${reviewRequests.attempts}`,
        updatedAt: now,
      },
      setWhere: ne(reviewRequests.status, "sent"),
    })
    .returning({ id: reviewRequests.id });
  return Boolean(row);
}

/** Puts orders back in "To ask" (undoing "Don't ask", or after a failure). Not sent ones only. */
export async function clearReviewRequests(tx: Transaction, orderIds: readonly string[]) {
  if (!orderIds.length) return 0;
  const cleared = await tx
    .delete(reviewRequests)
    .where(and(inArray(reviewRequests.orderId, [...orderIds]), ne(reviewRequests.status, "sent")))
    .returning({ id: reviewRequests.id });
  return cleared.length;
}

export const REVIEW_TABS = ["ask", "scheduled", "sent", "other"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

/** Orders on the review requests page, with the count for each tab. */
export async function listReviewOrders(
  tx: Transaction,
  input: {
    tab: ReviewTab;
    today: string;
    channelId?: string | null;
    limit: number;
    offset: number;
  },
) {
  const channel = and(
    onAmazon,
    input.channelId ? eq(orders.channelId, input.channelId) : undefined,
  );
  const ask = and(shipped, unasked, windowOpenUntil(input.today));
  const byTab = {
    ask,
    scheduled: eq(reviewRequests.status, "scheduled"),
    sent: eq(reviewRequests.status, "sent"),
    other: inArray(reviewRequests.status, ["skipped", "not_eligible", "failed"]),
  } satisfies Record<ReviewTab, unknown>;

  const rows = await tx
    .select({
      id: orders.id,
      externalId: orders.externalId,
      channelName: salesChannels.name,
      purchasedAt: orders.purchasedAt,
      status: orders.status,
      fulfillment: orders.fulfillment,
      opens,
      closes,
      estimated: sql<boolean>`${orders.latestDelivery} is null`,
      ready: sql<boolean>`coalesce(${readyToday(input.today)}, false)`,
      reviewEligible: orders.reviewEligible,
      reviewCheckedAt: orders.reviewCheckedAt,
      firstTitle,
      request: {
        status: reviewRequests.status,
        source: reviewRequests.source,
        dueAt: reviewRequests.dueAt,
        sentAt: reviewRequests.sentAt,
        reason: reviewRequests.reason,
      },
    })
    .from(orders)
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .leftJoin(reviewRequests, eq(reviewRequests.orderId, orders.id))
    .where(and(byTab[input.tab], channel))
    .orderBy(
      ...(input.tab === "ask"
        ? [asc(closes), asc(orders.id)]
        : input.tab === "scheduled"
          ? [asc(reviewRequests.dueAt), asc(orders.id)]
          : [desc(reviewRequests.updatedAt), asc(orders.id)]),
    )
    .limit(input.limit)
    .offset(input.offset);

  const [counts] = await tx
    .select({
      ask: sql<number>`(count(*) filter (where ${ask}))::int`,
      ready: sql<number>`(count(*) filter (where ${ask} and ${readyToday(input.today)}))::int`,
      scheduled: sql<number>`(count(*) filter (where ${byTab.scheduled}))::int`,
      sent: sql<number>`(count(*) filter (where ${byTab.sent}))::int`,
      sentLast30: sql<number>`(count(*) filter (where ${byTab.sent} and ${reviewRequests.sentAt} >= now() - interval '30 days'))::int`,
      other: sql<number>`(count(*) filter (where ${byTab.other}))::int`,
    })
    .from(orders)
    .leftJoin(reviewRequests, eq(reviewRequests.orderId, orders.id))
    .where(channel);

  return {
    rows: rows.map((r) => ({ ...r, request: r.request?.status ? r.request : null })),
    counts: counts ?? { ask: 0, ready: 0, scheduled: 0, sent: 0, sentLast30: 0, other: 0 },
  };
}

/** The request for one order, for the order page. */
export async function getReviewRequest(tx: Transaction, orderId: string) {
  const [row] = await tx
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.orderId, orderId))
    .limit(1);
  return row ?? null;
}

/** SKUs the company has sold, for the "leave out" picker. */
export async function soldSkus(tx: Transaction) {
  const rows = await tx
    .selectDistinct({ sku: orderItems.sku })
    .from(orderItems)
    .where(sql`${orderItems.sku} is not null`)
    .orderBy(asc(orderItems.sku))
    .limit(500);
  return rows.map((r) => r.sku).filter((s): s is string => Boolean(s));
}

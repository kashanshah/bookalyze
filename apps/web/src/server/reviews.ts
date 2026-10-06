import "server-only";
import {
  addDaysIso,
  can,
  getPlan,
  isAmazonRegion,
  isModuleKey,
  localDate,
  type ModuleKey,
  type ReviewSettings,
  type ReviewSource,
  reviewHold,
  reviewSendDay,
  reviewWindow,
  zonedInstant,
} from "@bookalyze/core";
import {
  dueReviewRequests,
  getChannelForSync,
  getDb,
  getReviewSettings,
  type PlannedReview,
  planReviewRequests,
  readyToAsk,
  recordReviewOutcome,
  reviewCandidates,
  reviewTargets,
  schema,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import { sql } from "drizzle-orm";
import {
  type AmazonCredentials,
  AmazonError,
  canRequestReview,
  orderRefundReason,
  requestReview,
} from "./amazon";
import { openAmazonCredentials } from "./commerce";

/**
 * Amazon review requests, sent with Amazon's own "Request a Review" (one standard message per
 * order, in the buyer's language). The planner gives each eligible order a send time from the
 * company's settings; the sender (hourly, and when someone asks by hand) checks refunds, asks
 * Amazon whether a request is possible, then sends it. Amazon allows about one call a second,
 * so everything runs within a time budget and carries on in the next run.
 */

type Ctx = { orgId: string; userId: string | null };

export type ReviewTally = {
  sent: number;
  skipped: number;
  notEligible: number;
  failed: number;
  /** Orders whose window hasn't opened yet, or left for the next run (out of time). */
  later: number;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Amazon allows one solicitations call a second (burst of 5). */
const PACE_MS = 1_100;
/** How many times an automatic request is tried before it's left as not eligible or failed. */
const MAX_TRIES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const emptyTally = (): ReviewTally => ({
  sent: 0,
  skipped: 0,
  notEligible: 0,
  failed: 0,
  later: 0,
});

/** The company's timezone, review settings, and what its plan and modules allow. */
async function reviewAccess(ctx: Ctx) {
  return withOrg(getDb(), ctx, async (tx) => {
    const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
    const modules = (await tx.select().from(schema.organizationModules))
      .filter((m) => m.enabled && isModuleKey(m.moduleKey))
      .map((m) => m.moduleKey as ModuleKey);
    const plan = getPlan(profile?.planKey);
    return {
      timezone: profile?.timezone ?? "UTC",
      settings: await getReviewSettings(tx),
      manual: can(plan, modules, "reviews.manual"),
      auto: can(plan, modules, "reviews.auto_rules"),
    };
  });
}

type Target = {
  orderId: string;
  externalId: string;
  earliestDelivery: string | null;
  latestDelivery: string | null;
  channelId: string;
  marketplaceId: string | null;
};

type Outcome =
  | { status: "sent" | "skipped" | "not_eligible" | "failed"; reason: string | null }
  | { status: "scheduled"; reason: string | null; dueAt: Date }
  /** Nothing recorded: try again later. */
  | { status: "later"; reason: string };

/** Talks to Amazon for one company within a deadline: credentials per channel, and pacing. */
function reviewSender(ctx: Ctx, deadline: number) {
  const access = new Map<string, Promise<{ creds: AmazonCredentials; region: string } | null>>();
  let last = 0;

  const channel = (channelId: string) => {
    let found = access.get(channelId);
    if (!found) {
      found = withOrg(getDb(), ctx, (tx) => getChannelForSync(tx, channelId)).then((row) => {
        const region = String(row?.connection.settings.region ?? "");
        if (!row?.connection.secret || row.connection.status === "disconnected") return null;
        if (!isAmazonRegion(region)) return null;
        return {
          creds: openAmazonCredentials(ctx.orgId, row.connection.id, row.connection.secret),
          region,
        };
      });
      access.set(channelId, found);
    }
    return found;
  };

  /** One Amazon call, paced, waiting out throttling while there's time. */
  const amazon = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (;;) {
      const wait = last + PACE_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        return await fn();
      } catch (error) {
        const throttled = error instanceof AmazonError && error.code === "throttled";
        if (!throttled || Date.now() + 2_000 >= deadline) throw error;
        await sleep(2_000);
      }
    }
  };

  /** Asks for one order's review. Nothing is recorded here. */
  async function ask(
    target: Target,
    input: {
      source: ReviewSource;
      checkRefund: boolean;
      attempts: number;
      timezone: string;
      hour: number;
    },
  ): Promise<Outcome> {
    const now = new Date();
    const today = localDate(now.toISOString(), input.timezone);
    const window = reviewWindow(target);
    const auto = input.source === "auto";
    if (!window) {
      return { status: "not_eligible", reason: "Amazon hasn't given a delivery date for it" };
    }
    if (today > addDaysIso(window.closes, -1)) {
      return { status: "not_eligible", reason: "Amazon's 30-day window for this order has closed" };
    }
    if (today < window.opens) {
      if (auto) {
        return {
          status: "scheduled",
          reason: null,
          dueAt: zonedInstant(window.opens, input.hour, input.timezone),
        };
      }
      return {
        status: "later",
        reason: `Amazon takes a request for this order from ${window.opens}`,
      };
    }
    const found = await channel(target.channelId);
    if (!found || !target.marketplaceId || !isAmazonRegion(found.region)) {
      return { status: "failed", reason: "Its Amazon connection is missing or disconnected" };
    }
    const { creds, region } = found;
    const order = { externalId: target.externalId, marketplaceId: target.marketplaceId };
    if (input.checkRefund) {
      const refunded = await amazon(() => orderRefundReason(creds, region, target.externalId));
      if (refunded) return { status: "skipped", reason: refunded };
    }
    if (!(await amazon(() => canRequestReview(creds, region, order)))) {
      if (auto && input.attempts + 1 < MAX_TRIES) {
        return {
          status: "scheduled",
          reason: "Amazon wasn't taking a request yet; trying again tomorrow",
          dueAt: new Date(now.getTime() + DAY),
        };
      }
      return {
        status: "not_eligible",
        reason:
          "Amazon isn't taking a review request for this order (it may have been asked from Seller Central)",
      };
    }
    if ((await amazon(() => requestReview(creds, region, order))) === "refused") {
      return { status: "not_eligible", reason: "Amazon says this order has already been asked" };
    }
    return { status: "sent", reason: null };
  }

  /**
   * Asks, records the outcome and counts it. `stop` is Amazon refusing the app itself (a
   * missing role, say): nothing else will go through either.
   */
  async function handle(
    target: Target,
    input: Parameters<typeof ask>[1] & { userId: string | null },
    tally: ReviewTally,
  ): Promise<{ stop: string | null; status: Outcome["status"]; reason: string | null }> {
    let outcome: Outcome;
    let stop: string | null = null;
    try {
      outcome = await ask(target, input);
    } catch (error) {
      if (!(error instanceof AmazonError) && !(error instanceof VaultError)) throw error;
      if (error instanceof AmazonError && error.code === "throttled") {
        outcome = { status: "later", reason: error.message };
      } else {
        if (
          error instanceof VaultError ||
          error.code === "forbidden" ||
          error.code === "unauthorized"
        ) {
          stop = error.message;
        }
        outcome =
          input.source === "auto" && input.attempts + 1 < MAX_TRIES
            ? { status: "scheduled", reason: error.message, dueAt: new Date(Date.now() + HOUR) }
            : { status: "failed", reason: error.message };
      }
    }
    if (outcome.status === "later") {
      tally.later++;
      return { stop, status: "later", reason: outcome.reason };
    }
    const status = outcome.status;
    await withOrg(getDb(), ctx, (tx) =>
      recordReviewOutcome(tx, {
        orgId: ctx.orgId,
        orderId: target.orderId,
        source: input.source,
        status,
        reason: outcome.reason,
        dueAt: status === "scheduled" ? outcome.dueAt : null,
        userId: input.source === "auto" ? undefined : input.userId,
        attempted: true,
      }),
    );
    if (status === "sent") tally.sent++;
    else if (status === "skipped") tally.skipped++;
    else if (status === "not_eligible") tally.notEligible++;
    else if (status === "failed") tally.failed++;
    else tally.later++;
    return { stop, status, reason: outcome.reason };
  }

  return { handle };
}

/** Gives each eligible order a send time (or a reason it's left out). */
async function planReviews(
  ctx: Ctx,
  input: { settings: ReviewSettings; timezone: string; now: Date; deadline: number },
) {
  const { settings, timezone, now } = input;
  const today = localDate(now.toISOString(), timezone);
  const needsItems = settings.excludedSkus.length > 0 || settings.skipPromotions;
  let planned = 0;
  while (Date.now() < input.deadline) {
    const batch = await withOrg(getDb(), ctx, (tx) =>
      reviewCandidates(tx, { today, needsItems, limit: 200 }),
    );
    const rows = batch.flatMap((order): PlannedReview[] => {
      const hold = reviewHold(order, settings);
      if (hold?.waiting) return [];
      if (hold) return [{ orderId: order.id, status: "skipped", dueAt: null, reason: hold.reason }];
      const day = reviewSendDay(order, settings, today);
      if (!day) {
        return [
          {
            orderId: order.id,
            status: "skipped",
            dueAt: null,
            reason: "None of the chosen weekdays fall within Amazon's window",
          },
        ];
      }
      const due = zonedInstant(day, settings.sendHour, timezone);
      return [
        { orderId: order.id, status: "scheduled", dueAt: due < now ? now : due, reason: null },
      ];
    });
    if (!rows.length) break;
    planned += await withOrg(getDb(), ctx, (tx) => planReviewRequests(tx, ctx.orgId, rows));
    if (batch.length < 200) break;
  }
  return planned;
}

/** Plans automatic requests now (after the settings change), without sending any. */
export async function planOrgReviewRequests(ctx: Ctx, budgetMs: number) {
  const access = await reviewAccess(ctx);
  if (!access.auto || !access.settings.enabled) return 0;
  return planReviews(ctx, {
    settings: access.settings,
    timezone: access.timezone,
    now: new Date(),
    deadline: Date.now() + budgetMs,
  });
}

/** One company's run: plan, then send what's due, within the deadline. */
export async function runOrgReviewRequests(ctx: Ctx, deadline: number) {
  const access = await reviewAccess(ctx);
  const tally = emptyTally();
  if (!access.auto || !access.settings.enabled) return { planned: 0, ...tally, error: null };
  const planned = await planReviews(ctx, {
    settings: access.settings,
    timezone: access.timezone,
    now: new Date(),
    deadline,
  });
  const sender = reviewSender(ctx, deadline);
  let error: string | null = null;
  sending: while (Date.now() < deadline) {
    const due = await withOrg(getDb(), ctx, (tx) =>
      dueReviewRequests(tx, { now: new Date(), limit: 20 }),
    );
    if (!due.length) break;
    for (const request of due) {
      if (Date.now() >= deadline) break sending;
      const outcome = await sender.handle(
        request,
        {
          source: request.source,
          attempts: request.attempts,
          checkRefund: access.settings.skipRefunded,
          timezone: access.timezone,
          hour: access.settings.sendHour,
          userId: null,
        },
        tally,
      );
      error = outcome.stop;
      // Amazon refused the app, or was throttling with no time left to wait.
      if (error || outcome.status === "later") break sending;
    }
  }
  return { planned, ...tally, error };
}

/** The hourly job: every company with automatic requests on, or requests due. */
export async function runAllReviewRequests(budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  const rows = await getDb().execute<{ organization_id: string }>(
    sql`select organization_id from review_request_orgs()`,
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows.rows) {
    if (Date.now() >= deadline) break;
    // No company takes more than a minute, so a large backlog doesn't starve the rest.
    const r = await runOrgReviewRequests(
      { orgId: row.organization_id, userId: null },
      Math.min(deadline, Date.now() + 60_000),
    ).catch(() => ({ sent: 0, error: "failed" }));
    sent += r.sent;
    if (r.error) failed++;
  }
  return { companies: rows.rows.length, sent, failed };
}

export type AskResult = ReviewTally & {
  /** What happened to each order handled. */
  results: { orderId: string; status: Outcome["status"]; reason: string | null }[];
  /** Orders not handled yet (out of time): send them again. With `all`, more may be waiting. */
  pendingIds: string[];
  more: boolean;
  error: string | null;
};

/** Asks for reviews now: the given orders, or (with `all`) orders whose window is open. */
export async function askForReviews(
  ctx: Ctx,
  input:
    | { orderIds: readonly string[]; source: "manual" | "bulk" }
    | { all: true; channelId: string | null; source: "bulk" },
  budgetMs: number,
): Promise<AskResult> {
  const deadline = Date.now() + budgetMs;
  const access = await reviewAccess(ctx);
  const result: AskResult = {
    ...emptyTally(),
    results: [],
    pendingIds: [],
    more: false,
    error: null,
  };
  if (!access.manual) {
    return { ...result, error: "Review requests aren't switched on for this company." };
  }
  const today = localDate(new Date().toISOString(), access.timezone);
  const ids =
    "all" in input
      ? await withOrg(getDb(), ctx, (tx) =>
          readyToAsk(tx, { today, channelId: input.channelId, limit: 30 }),
        )
      : input.orderIds;
  const targets = await withOrg(getDb(), ctx, (tx) => reviewTargets(tx, ids));
  const sender = reviewSender(ctx, deadline);
  for (const [i, target] of targets.entries()) {
    if (Date.now() >= deadline - 2_000) {
      result.pendingIds = targets.slice(i).map((t) => t.orderId);
      break;
    }
    if (target.request === "sent") {
      result.results.push({ orderId: target.orderId, status: "later", reason: "Already asked" });
      continue;
    }
    if (!["Shipped", "InvoiceUnconfirmed"].includes(target.status)) {
      const reason = "Only shipped orders can be asked";
      result.results.push({ orderId: target.orderId, status: "later", reason });
      result.later++;
      continue;
    }
    const outcome = await sender.handle(
      target,
      {
        source: input.source,
        attempts: 0,
        checkRefund: access.settings.skipRefunded,
        timezone: access.timezone,
        hour: access.settings.sendHour,
        userId: ctx.userId,
      },
      result,
    );
    result.results.push({
      orderId: target.orderId,
      status: outcome.status,
      reason: outcome.reason,
    });
    if (outcome.stop) {
      result.error = outcome.stop;
      break;
    }
  }
  // With `all`, orders asked drop out of the next batch, so carry on while this one did something.
  result.more =
    !result.error &&
    (result.pendingIds.length > 0 ||
      ("all" in input && result.results.some((r) => r.status !== "later")));
  return result;
}

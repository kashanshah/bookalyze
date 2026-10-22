import "server-only";
import {
  type AdMetricRow,
  can,
  getPlan,
  isModuleKey,
  type ModuleKey,
  nextWalmartAdsWindow,
  parseWalmartAdsReport,
  parseWalmartCatalogSku,
  WALMART_ADS_PENDING_LIMIT_MS,
  WALMART_CATALOG_SEARCH_PATH,
  type WalmartCredentials,
  walmartCatalogSearchBody,
  walmartMarketplace,
} from "@bookalyze/core";
import {
  adReportState,
  finishAdReportRequest,
  getChannel,
  getConnection,
  getDb,
  getWalmartConnection,
  knownListingRefs,
  listWalmartAdsConnections,
  recordAdReportRequest,
  recordConnectionSync,
  replaceAdMetrics,
  saveChannelSkuListingRef,
  schema,
  withOrg,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { nowIn } from "@/lib/dates";
import { openWalmartCredentials } from "./commerce";
import { suggestRate } from "./fx";
import { logInfo, logWarn } from "./log";
import { WalmartError, walmartPost } from "./walmart";
import {
  createWalmartAdsReport,
  downloadWalmartAdsReport,
  WalmartAdsError,
  walmartAdsApp,
  walmartAdsSnapshot,
} from "./walmart-ads";

/**
 * Bringing Walmart Connect's ad spend in (docs/ADS.md §9): for each advertiser a company linked
 * to a Walmart channel, collect the item reports Walmart has finished, then ask for the next
 * window (the last 30 days at first, then the last 15 every day). Walmart names items by its own
 * item ID: each new one is looked up once in the channel's Marketplace catalog (with the
 * country's Walmart key) and kept on the SKU list, so its spend lands on the SKU. A finished
 * report replaces the channel's Walmart Connect rows for its days.
 */

type Ctx = { orgId: string; userId: string | null };

export type WalmartAdsSyncResult = {
  requested: number;
  collected: number;
  rows: number;
  pending: number;
  /** Items whose SKU Walmart's catalog didn't give (their spend isn't tied to a product). */
  unmatched: number;
  error: string | null;
};

/** At most this many new items are looked up in the catalog per report. */
const CATALOG_LOOKUPS = 100;

const day = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/** Looks up the SKUs of a report's new item IDs in the Marketplace catalog, and keeps them. */
async function matchItems(
  ctx: Ctx,
  input: { channelId: string; market: string; creds: WalmartCredentials | null },
  rows: readonly AdMetricRow[],
): Promise<number> {
  const items = [...new Set(rows.map((r) => r.listingRef).filter((x): x is string => !!x))];
  const known = await withOrg(getDb(), ctx, (tx) => knownListingRefs(tx, input.channelId, items));
  const unknown = items.filter((i) => !known.has(i));
  if (!input.creds) return unknown.length;
  let unmatched = 0;
  for (const [i, itemId] of unknown.entries()) {
    if (i >= CATALOG_LOOKUPS) {
      unmatched += unknown.length - i;
      break;
    }
    let sku: string | null = null;
    try {
      sku = parseWalmartCatalogSku(
        await walmartPost(
          input.creds,
          input.market,
          WALMART_CATALOG_SEARCH_PATH,
          walmartCatalogSearchBody(itemId),
        ),
        itemId,
      );
    } catch (error) {
      if (!(error instanceof WalmartError)) throw error;
      logWarn("walmart_ads.catalog_failed", { orgId: ctx.orgId, itemId }, error);
      // The rest wait for the next run; their spend stays untied for now.
      unmatched += unknown.length - i;
      break;
    }
    if (!sku) {
      unmatched++;
      continue;
    }
    const found = sku;
    await withOrg(getDb(), ctx, (tx) =>
      saveChannelSkuListingRef(tx, {
        orgId: ctx.orgId,
        channelId: input.channelId,
        sku: found,
        listingRef: itemId,
      }),
    );
  }
  return unmatched;
}

/**
 * One advertiser's sync. `requestNew` asks Walmart for the next window (the daily job and the
 * button); without it, only snapshots Walmart has finished are collected (the 5-minute job).
 */
export async function syncWalmartAdsConnection(
  ctx: Ctx,
  connectionId: string,
  options: { requestNew: boolean; deadline: number },
): Promise<WalmartAdsSyncResult> {
  const result: WalmartAdsSyncResult = {
    requested: 0,
    collected: 0,
    rows: 0,
    pending: 0,
    unmatched: 0,
    error: null,
  };
  if (!walmartAdsApp()) return result;
  const setup = await withOrg(getDb(), ctx, async (tx) => {
    const connection = await getConnection(tx, connectionId);
    if (connection?.provider !== "walmart_ads" || connection.status === "disconnected") return null;
    const advertiserId = String(connection.settings.advertiserId ?? "");
    const channel = await getChannel(tx, String(connection.settings.channelId ?? ""));
    const marketplace = walmartMarketplace(channel?.marketplaceId ?? "");
    // A switched-off channel keeps what it has but isn't synced, like its orders.
    if (!advertiserId || channel?.kind !== "walmart" || !channel.isActive || !marketplace) {
      return null;
    }
    const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
    const live = await getWalmartConnection(tx, marketplace.id);
    const seller = live ? await getConnection(tx, live.id) : null;
    return { advertiserId, channel, marketplace, profile, seller };
  });
  if (!setup?.profile) return result;
  const { advertiserId, channel, marketplace, profile, seller } = setup;
  let creds: WalmartCredentials | null = null;
  if (seller?.secret && seller.status !== "disconnected") {
    try {
      creds = openWalmartCredentials(ctx.orgId, seller.id, seller.secret);
    } catch (error) {
      logWarn("walmart_ads.seller_key_unreadable", { orgId: ctx.orgId }, error);
    }
  }
  const today = nowIn(profile.timezone).date;
  const currency = channel.currency;

  try {
    const state = await withOrg(getDb(), ctx, (tx) =>
      adReportState(tx, channel.id, "sponsored_products"),
    );
    let stillPending = 0;
    for (const p of state.pending) {
      if (Date.now() > options.deadline) break;
      const snapshot = await walmartAdsSnapshot(advertiserId, p.reportId);
      if (snapshot.status === "pending") {
        if (Date.now() - p.requestedAt.getTime() > WALMART_ADS_PENDING_LIMIT_MS) {
          await withOrg(getDb(), ctx, (tx) =>
            finishAdReportRequest(tx, p.id, {
              status: "failed",
              error: "Walmart took more than 6 hours to make the report; it's asked again.",
            }),
          );
        } else stillPending++;
        continue;
      }
      if (snapshot.status === "failed" || !snapshot.url) {
        await withOrg(getDb(), ctx, (tx) =>
          finishAdReportRequest(tx, p.id, {
            status: "failed",
            error: `Walmart couldn't make the report${snapshot.failure ? ` (${snapshot.failure})` : ""}.`,
          }),
        );
        continue;
      }
      const rows = parseWalmartAdsReport(await downloadWalmartAdsReport(snapshot.url), {
        from: p.dateFrom,
        to: p.dateTo,
      });
      result.unmatched += await matchItems(
        ctx,
        { channelId: channel.id, market: marketplace.market, creds },
        rows,
      );
      const rates = new Map<string, string>();
      if (currency !== profile.baseCurrency) {
        for (const date of new Set(rows.map((r) => r.date))) {
          const rate = await suggestRate(profile.baseCurrency, currency, date);
          if (rate) rates.set(date, rate.rate);
        }
      }
      const kept = await withOrg(getDb(), ctx, async (tx) => {
        const n = await replaceAdMetrics(tx, {
          orgId: ctx.orgId,
          channelId: channel.id,
          connectionId,
          source: "walmart_ads",
          accountRef: advertiserId,
          country: channel.country,
          currency,
          adType: "sponsored_products",
          from: p.dateFrom,
          to: p.dateTo,
          rows,
          baseCurrency: profile.baseCurrency,
          rates,
        });
        await finishAdReportRequest(tx, p.id, { status: "done", rows: n });
        return n;
      });
      result.collected++;
      result.rows += kept;
    }
    result.pending += stillPending;
    if (!stillPending && options.requestNew && Date.now() < options.deadline) {
      const latest = await withOrg(getDb(), ctx, (tx) =>
        adReportState(tx, channel.id, "sponsored_products"),
      );
      const window = nextWalmartAdsWindow({
        today,
        doneThrough: latest.done?.dateTo ?? null,
        doneOn: latest.done?.finishedAt ? day(latest.done.finishedAt, profile.timezone) : null,
      });
      if (window) {
        const snapshotId = await createWalmartAdsReport(advertiserId, window.from, window.to);
        await withOrg(getDb(), ctx, (tx) =>
          recordAdReportRequest(tx, {
            orgId: ctx.orgId,
            connectionId,
            channelId: channel.id,
            accountRef: advertiserId,
            adType: "sponsored_products",
            from: window.from,
            to: window.to,
            reportId: snapshotId,
          }),
        );
        result.requested++;
        result.pending++;
      }
    }
  } catch (error) {
    if (!(error instanceof WalmartAdsError)) throw error;
    // Asked to slow down: not the account's fault, the next run carries on.
    if (error.code !== "throttled") result.error = error.message;
  }
  await withOrg(getDb(), ctx, (tx) =>
    recordConnectionSync(tx, connectionId, { at: new Date(), error: result.error }),
  );
  return result;
}

/**
 * Every company's Walmart Connect advertisers (Channel profit's companies only). The daily job
 * asks for new windows; the 5-minute job only collects what Walmart finished.
 */
export async function runWalmartAdsJob(
  budgetMs: number,
  options: { requestNew: boolean },
): Promise<{ companies: number } & Omit<WalmartAdsSyncResult, "error"> & { failed: number }> {
  const deadline = Date.now() + budgetMs;
  const total = {
    companies: 0,
    requested: 0,
    collected: 0,
    rows: 0,
    pending: 0,
    unmatched: 0,
    failed: 0,
  };
  if (!walmartAdsApp()) return total;
  const orgs = await getDb().select({ id: schema.organization.id }).from(schema.organization);
  for (const org of orgs) {
    if (Date.now() > deadline) break;
    const ctx = { orgId: org.id, userId: null };
    const connections = await withOrg(getDb(), ctx, async (tx) => {
      const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
      if (!profile) return [];
      const enabled = (await tx.select().from(schema.organizationModules))
        .filter((m) => m.enabled && isModuleKey(m.moduleKey))
        .map((m) => m.moduleKey as ModuleKey);
      if (!can(getPlan(profile.planKey), enabled, "commerce.settlements")) return [];
      const list = (await listWalmartAdsConnections(tx)).filter((c) => c.status !== "disconnected");
      if (!list.length || options.requestNew) return list;
      // The 5-minute job only has work where a report is waiting.
      const waiting = await tx
        .select({ id: schema.adReportRequests.id })
        .from(schema.adReportRequests)
        .where(eq(schema.adReportRequests.status, "pending"))
        .limit(1);
      return waiting.length ? list : [];
    });
    if (!connections.length) continue;
    total.companies++;
    for (const c of connections) {
      try {
        const r = await syncWalmartAdsConnection(ctx, c.id, {
          requestNew: options.requestNew,
          deadline,
        });
        total.requested += r.requested;
        total.collected += r.collected;
        total.rows += r.rows;
        total.pending += r.pending;
        total.unmatched += r.unmatched;
        if (r.error) {
          total.failed++;
          logWarn("job.walmart_ads_problem", { orgId: org.id, connectionId: c.id, error: r.error });
        }
      } catch (error) {
        total.failed++;
        logWarn("job.walmart_ads_failed", { orgId: org.id, connectionId: c.id }, error);
      }
    }
  }
  if (total.collected || total.requested) logInfo("job.walmart_ads", total);
  return total;
}

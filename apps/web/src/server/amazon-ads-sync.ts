import "server-only";
import {
  AMAZON_ADS_PENDING_LIMIT_MS,
  AMAZON_ADS_REPORTS,
  type AmazonAdsProfile,
  can,
  getPlan,
  isAmazonRegion,
  isModuleKey,
  type ModuleKey,
  nextAmazonAdsWindow,
  parseAmazonAdsReport,
} from "@bookalyze/core";
import {
  adReportState,
  finishAdReportRequest,
  getConnection,
  getDb,
  listAmazonAdsConnections,
  recordAdReportRequest,
  recordConnectionSync,
  replaceAdMetrics,
  schema,
  withOrg,
} from "@bookalyze/db";
import { and, eq, inArray } from "drizzle-orm";
import { nowIn } from "@/lib/dates";
import {
  type AmazonAdsAccount,
  AmazonAdsError,
  amazonAdsReportStatus,
  createAmazonAdsReport,
  downloadAmazonAdsReport,
  openAmazonAdsCredentials,
} from "./amazon-ads";
import { suggestRate } from "./fx";
import { logInfo, logWarn } from "./log";

/**
 * Bringing Amazon's ad spend in (docs/ADS.md §5). For each ads profile that matches one of the
 * company's Amazon channels, and each ad type (Sponsored Products per SKU, Sponsored Brands per
 * campaign): collect the reports Amazon has finished, then ask for the next window (60 days back
 * at first, then the last 15 days every day, as attribution changes for 14). A finished report
 * replaces the channel's rows for its days.
 */

type Ctx = { orgId: string; userId: string | null };

export type AdsSyncResult = {
  requested: number;
  collected: number;
  rows: number;
  pending: number;
  error: string | null;
};

/** Saved profiles on a connection's settings (from the last time Amazon listed them). */
export function savedProfiles(settings: Record<string, unknown>): AmazonAdsProfile[] {
  return Array.isArray(settings.profiles) ? (settings.profiles as AmazonAdsProfile[]) : [];
}

const day = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/**
 * One Ads connection's sync. `requestNew` asks Amazon for the next windows (the daily job and the
 * button); without it, only reports Amazon has finished are collected (the 5-minute job).
 * `channelId` limits it to one channel.
 */
export async function syncAmazonAdsConnection(
  ctx: Ctx,
  connectionId: string,
  options: { requestNew: boolean; channelId?: string; deadline: number },
): Promise<AdsSyncResult> {
  const result: AdsSyncResult = { requested: 0, collected: 0, rows: 0, pending: 0, error: null };
  const setup = await withOrg(getDb(), ctx, async (tx) => {
    const connection = await getConnection(tx, connectionId);
    if (!connection?.secret || connection.status === "disconnected") return null;
    const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
    const profiles = savedProfiles(connection.settings).filter(
      (p) => p.accountType === "seller" && p.marketplaceId,
    );
    const channels = profiles.length
      ? await tx
          .select()
          .from(schema.salesChannels)
          .where(
            and(
              eq(schema.salesChannels.kind, "amazon"),
              inArray(
                schema.salesChannels.marketplaceId,
                profiles.map((p) => p.marketplaceId),
              ),
            ),
          )
      : [];
    return { connection, profile, profiles, channels };
  });
  if (!setup?.profile) return result;
  const region = String(setup.connection.settings.region ?? "");
  if (!isAmazonRegion(region)) return result;
  const { baseCurrency, timezone: companyTimezone } = setup.profile;

  let account: AmazonAdsAccount;
  try {
    account = {
      region,
      refreshToken: openAmazonAdsCredentials(ctx.orgId, connectionId, setup.connection.secret ?? "")
        .refreshToken,
    };
  } catch (error) {
    logWarn("amazon_ads.credentials_unreadable", { orgId: ctx.orgId, connectionId }, error);
    result.error = "The saved sign-in can't be read. Connect Amazon Ads again.";
    await withOrg(getDb(), ctx, (tx) =>
      recordConnectionSync(tx, connectionId, { at: new Date(), error: result.error }),
    );
    return result;
  }

  try {
    for (const profile of setup.profiles) {
      const channel = setup.channels.find((c) => c.marketplaceId === profile.marketplaceId);
      if (!channel) continue;
      if (options.channelId && channel.id !== options.channelId) continue;
      // A switched-off channel keeps what it has but isn't synced, like its orders.
      if (!channel.isActive) continue;
      const timezone = profile.timezone || companyTimezone;
      const today = nowIn(timezone).date;
      for (const spec of AMAZON_ADS_REPORTS) {
        if (Date.now() > options.deadline) return result;
        const state = await withOrg(getDb(), ctx, (tx) =>
          adReportState(tx, channel.id, spec.adType),
        );
        let stillPending = 0;
        for (const p of state.pending) {
          const status = await amazonAdsReportStatus(account, profile.profileId, p.reportId);
          if (status.status === "pending") {
            if (Date.now() - p.requestedAt.getTime() > AMAZON_ADS_PENDING_LIMIT_MS) {
              await withOrg(getDb(), ctx, (tx) =>
                finishAdReportRequest(tx, p.id, {
                  status: "failed",
                  error: "Amazon took more than 6 hours to make the report; it's asked again.",
                }),
              );
            } else stillPending++;
            continue;
          }
          if (status.status === "failed" || !status.url) {
            await withOrg(getDb(), ctx, (tx) =>
              finishAdReportRequest(tx, p.id, {
                status: "failed",
                error: status.failure ?? "Amazon couldn't make the report.",
              }),
            );
            continue;
          }
          const rows = parseAmazonAdsReport(
            spec.adType,
            await downloadAmazonAdsReport(status.url),
            { from: p.dateFrom, to: p.dateTo },
          );
          const rates = new Map<string, string>();
          const currency = profile.currency || channel.currency;
          if (currency !== baseCurrency) {
            for (const date of new Set(rows.map((r) => r.date))) {
              const rate = await suggestRate(baseCurrency, currency, date);
              if (rate) rates.set(date, rate.rate);
            }
          }
          const kept = await withOrg(getDb(), ctx, async (tx) => {
            const n = await replaceAdMetrics(tx, {
              orgId: ctx.orgId,
              channelId: channel.id,
              connectionId,
              source: "amazon_ads",
              accountRef: profile.profileId,
              country: channel.country ?? (profile.countryCode || null),
              currency,
              adType: spec.adType,
              from: p.dateFrom,
              to: p.dateTo,
              rows,
              baseCurrency,
              rates,
            });
            await finishAdReportRequest(tx, p.id, { status: "done", rows: n });
            return n;
          });
          result.collected++;
          result.rows += kept;
        }
        if (stillPending || !options.requestNew) {
          result.pending += stillPending;
          continue;
        }
        const latest = await withOrg(getDb(), ctx, (tx) =>
          adReportState(tx, channel.id, spec.adType),
        );
        const window = nextAmazonAdsWindow({
          today,
          doneThrough: latest.done?.dateTo ?? null,
          doneOn: latest.done?.finishedAt ? day(latest.done.finishedAt, timezone) : null,
        });
        if (!window) continue;
        const reportId = await createAmazonAdsReport(
          account,
          profile.profileId,
          spec.adType,
          window.from,
          window.to,
        );
        await withOrg(getDb(), ctx, (tx) =>
          recordAdReportRequest(tx, {
            orgId: ctx.orgId,
            connectionId,
            channelId: channel.id,
            accountRef: profile.profileId,
            adType: spec.adType,
            from: window.from,
            to: window.to,
            reportId,
          }),
        );
        result.requested++;
        result.pending++;
      }
    }
  } catch (error) {
    if (!(error instanceof AmazonAdsError)) throw error;
    // Asked to slow down: not the account's fault, the next run carries on.
    if (error.code !== "throttled") result.error = error.message;
  }
  await withOrg(getDb(), ctx, (tx) =>
    recordConnectionSync(tx, connectionId, { at: new Date(), error: result.error }),
  );
  return result;
}

/**
 * Every company's Amazon Ads connections (Channel profit's companies only). The daily job asks
 * for new windows; the 5-minute job only collects what Amazon finished.
 */
export async function runAmazonAdsJob(
  budgetMs: number,
  options: { requestNew: boolean },
): Promise<{ companies: number } & Omit<AdsSyncResult, "error"> & { failed: number }> {
  const deadline = Date.now() + budgetMs;
  const total = { companies: 0, requested: 0, collected: 0, rows: 0, pending: 0, failed: 0 };
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
      return (await listAmazonAdsConnections(tx)).filter(
        (c) => c.hasSecret && c.status !== "disconnected",
      );
    });
    if (!connections.length) continue;
    // The 5-minute job only has work where a report is waiting.
    if (!options.requestNew) {
      const waiting = await withOrg(getDb(), ctx, (tx) =>
        tx
          .select({ id: schema.adReportRequests.id })
          .from(schema.adReportRequests)
          .where(eq(schema.adReportRequests.status, "pending"))
          .limit(1),
      );
      if (!waiting.length) continue;
    }
    total.companies++;
    for (const c of connections) {
      try {
        const r = await syncAmazonAdsConnection(ctx, c.id, {
          requestNew: options.requestNew,
          deadline,
        });
        total.requested += r.requested;
        total.collected += r.collected;
        total.rows += r.rows;
        total.pending += r.pending;
        if (r.error) {
          total.failed++;
          logWarn("job.amazon_ads_problem", { orgId: org.id, connectionId: c.id, error: r.error });
        }
      } catch (error) {
        total.failed++;
        logWarn("job.amazon_ads_failed", { orgId: org.id, connectionId: c.id }, error);
      }
    }
  }
  if (total.collected || total.requested) logInfo("job.amazon_ads", total);
  return total;
}

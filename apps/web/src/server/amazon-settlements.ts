import "server-only";
import { isAmazonRegion, parseSettlementReport } from "@bookalyze/core";
import {
  getDb,
  knownSettlementReports,
  markSettlementsSynced,
  saveSettlement,
  settlementChannel,
  settlementConnections,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import { sql } from "drizzle-orm";
import { AmazonError, downloadReport, settlementReportsPage } from "./amazon";
import { openAmazonCredentials } from "./commerce";
import { logError, logWarn } from "./log";

/**
 * Amazon settlements, brought in from the Reports API: Amazon makes one settlement report per
 * period (about every 14 days) on its own. Each run lists the reports since the last look and
 * downloads those not in yet. Amazon rations both calls tightly (about one listing a minute), so
 * a run stops when it's out of time or throttled and the next carries on. Nothing posts yet.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Amazon lists reports from the last 90 days. */
const LOOKBACK_MS = 89 * DAY;
/** Settlement reports appear a day or two after a period closes: look back a little further. */
const OVERLAP_MS = 3 * DAY;
/** A connection looked at this recently isn't asked again (unless someone asks). */
const FRESH_MS = 6 * HOUR;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Ctx = { orgId: string; userId: string | null };

export type SettlementSyncResult = {
  /** Settlements added or brought up to date. */
  added: number;
  /** More to do: run again. */
  more: boolean;
  /** Reports that couldn't be read. */
  unreadable: number;
  error: string | null;
};

export async function syncConnectionSettlements(
  ctx: Ctx,
  connectionId: string,
  deadline: number,
  force = false,
): Promise<SettlementSyncResult> {
  const db = getDb();
  const result: SettlementSyncResult = { added: 0, more: false, unreadable: 0, error: null };
  const connection = (await withOrg(db, ctx, (tx) => settlementConnections(tx))).find(
    (c) => c.id === connectionId,
  );
  const region = String(connection?.settings.region ?? "");
  if (!connection?.secret || !isAmazonRegion(region)) return result;
  const synced = connection.settlementsSyncedAt;
  if (!force && synced && Date.now() - synced.getTime() < FRESH_MS) return result;

  /** Waits out Amazon's rationing while there's time; false when there isn't. */
  const retry = async (error: unknown, wait: number) => {
    if (!(error instanceof AmazonError) || error.code !== "throttled") return false;
    if (Date.now() + wait >= deadline) return false;
    await sleep(wait);
    return true;
  };

  try {
    const creds = openAmazonCredentials(ctx.orgId, connection.id, connection.secret);
    const started = new Date();
    const since = new Date(
      Math.max(started.getTime() - LOOKBACK_MS, synced ? synced.getTime() - OVERLAP_MS : 0),
    ).toISOString();

    // 1. Every settlement report since then (a page is 100: years of settlements).
    const reports: { reportId: string; reportDocumentId: string; createdAt: string }[] = [];
    let token: string | null = null;
    let listed = false;
    while (!listed && Date.now() < deadline) {
      try {
        const page = await settlementReportsPage(
          creds,
          region,
          token ? { nextToken: token } : { createdSince: since },
        );
        reports.push(...page.reports);
        token = page.nextToken;
        listed = !token;
      } catch (error) {
        if (await retry(error, 5_000)) continue;
        if (error instanceof AmazonError && error.code === "throttled") break;
        throw error;
      }
    }
    if (!listed) return { ...result, more: true };

    // 2. Download the ones not in yet, oldest first.
    const known = await withOrg(db, ctx, (tx) => knownSettlementReports(tx));
    const fresh = reports
      .filter((r) => !known.has(r.reportId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const report of fresh) {
      if (Date.now() >= deadline - 2_000) return { ...result, more: true };
      let text: string;
      try {
        text = await downloadReport(creds, region, report.reportDocumentId);
      } catch (error) {
        if (await retry(error, 5_000)) {
          fresh.push(report);
          continue;
        }
        if (error instanceof AmazonError && error.code === "throttled") {
          return { ...result, more: true };
        }
        throw error;
      }
      let settlement: ReturnType<typeof parseSettlementReport>;
      try {
        settlement = parseSettlementReport(text);
      } catch (error) {
        logWarn(
          "amazon.settlement_unreadable",
          { orgId: ctx.orgId, connectionId: connection.id, reportId: report.reportId },
          error,
        );
        result.unreadable++;
        continue;
      }
      await withOrg(db, ctx, async (tx) => {
        const channelId = await settlementChannel(tx, {
          connectionId: connection.id,
          marketplace: settlement.marketplace,
          currency: settlement.currency,
        });
        await saveSettlement(tx, {
          orgId: ctx.orgId,
          connectionId: connection.id,
          channelId,
          reportId: report.reportId,
          source: "amazon",
          settlement,
        });
      });
      result.added++;
    }
    await withOrg(db, ctx, (tx) => markSettlementsSynced(tx, connection.id, started));
  } catch (error) {
    if (!(error instanceof AmazonError) && !(error instanceof VaultError)) throw error;
    return { ...result, more: false, error: error.message };
  }
  return result;
}

/** A company's Amazon connections, sharing one time budget (the Settlements page button). */
export async function syncOrgSettlements(ctx: Ctx, budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  const ids = (await withOrg(getDb(), ctx, (tx) => settlementConnections(tx))).map((c) => c.id);
  const total: SettlementSyncResult & { connections: number } = {
    added: 0,
    more: false,
    unreadable: 0,
    error: null,
    connections: ids.length,
  };
  for (const id of ids) {
    const r = await syncConnectionSettlements(ctx, id, deadline, true);
    total.added += r.added;
    total.unreadable += r.unreadable;
    total.more ||= r.more;
    total.error ??= r.error;
  }
  return total;
}

/** The daily job: every Amazon connection with credentials, within the budget. */
export async function syncAllSettlements(budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  const rows = await getDb().execute<{ organization_id: string; connection_id: string }>(
    sql`select organization_id, connection_id from syncable_amazon_connections()`,
  );
  let added = 0;
  let failed = 0;
  for (const row of rows.rows) {
    if (Date.now() >= deadline) break;
    const r = await syncConnectionSettlements(
      { orgId: row.organization_id, userId: null },
      row.connection_id,
      Math.min(deadline, Date.now() + 60_000),
    ).catch((error) => {
      logError("job.amazon_settlements_failed", error, {
        orgId: row.organization_id,
        connectionId: row.connection_id,
      });
      return { added: 0, error: "failed" };
    });
    // Handled failures (a refused key, a missing role) are saved on the connection and shown in
    // the app; log them too, so a run's problems can be read in one place.
    if (r.error && r.error !== "failed") {
      logWarn("job.amazon_settlements_problem", {
        orgId: row.organization_id,
        connectionId: row.connection_id,
        problem: r.error,
      });
    }
    added += r.added;
    if (r.error) failed++;
  }
  return { connections: rows.rows.length, added, failed };
}

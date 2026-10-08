import "server-only";
import { isAmazonRegion, parseInventoryLedger } from "@bookalyze/core";
import {
  getChannelForSync,
  getDb,
  importLedgerEvents,
  saveLedgerReport,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import { sql } from "drizzle-orm";
import {
  AmazonError,
  downloadReport,
  LEDGER_DENIED,
  reportStatus,
  requestLedgerReport,
} from "./amazon";
import { openAmazonCredentials } from "./commerce";
import { logError, logWarn } from "./log";

/**
 * Amazon's FBA inventory ledger, a month at a time: ask Amazon for the report, wait for it
 * (it takes a minute or two, so a run may end while it's being made and the next run picks it
 * up), download it, and bring its rows in. Each marketplace remembers the day it's in through.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DAY = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

type SyncContext = { orgId: string; userId: string | null };

export type LedgerSyncResult = {
  added: number;
  through: string | null;
  /** A report is still being made at Amazon: run again shortly. */
  waiting: boolean;
  error: string | null;
};

export async function syncChannelLedger(
  ctx: SyncContext,
  channelId: string,
  deadline: number,
): Promise<LedgerSyncResult> {
  const result: LedgerSyncResult = { added: 0, through: null, waiting: false, error: null };
  const load = () => withOrg(getDb(), ctx, (tx) => getChannelForSync(tx, channelId));
  const found = await load();
  if (!found) return { ...result, error: "This marketplace no longer exists." };
  const { connection } = found;
  let { channel } = found;
  const region = String(connection.settings.region ?? "");
  if (
    connection.provider !== "amazon_sp" ||
    connection.status === "disconnected" ||
    !connection.secret ||
    !isAmazonRegion(region) ||
    !channel.isActive ||
    !channel.marketplaceId
  ) {
    return result;
  }
  const marketplaceId = channel.marketplaceId;
  result.through = channel.ledgerSyncedThrough;
  const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  try {
    const creds = openAmazonCredentials(ctx.orgId, connection.id, connection.secret);
    while (Date.now() < deadline) {
      if (!channel.ledgerReportId) {
        const from = channel.ledgerSyncedThrough
          ? addDays(channel.ledgerSyncedThrough, 1)
          : (channel.ordersFrom ?? addDays(yesterday, -89));
        if (from > yesterday) break;
        // A month at a time keeps each report small.
        const monthEnd = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0))
          .toISOString()
          .slice(0, 10);
        const to = monthEnd < yesterday ? monthEnd : yesterday;
        const id = await requestLedgerReport(creds, region, { marketplaceId, from, to });
        await withOrg(getDb(), ctx, (tx) => saveLedgerReport(tx, channelId, { id, from, to }));
        channel = { ...channel, ledgerReportId: id, ledgerReportFrom: from, ledgerReportTo: to };
        continue;
      }
      let status: Awaited<ReturnType<typeof reportStatus>>;
      try {
        status = await reportStatus(creds, region, channel.ledgerReportId);
      } catch (error) {
        if (error instanceof AmazonError && error.code === "throttled") {
          await sleep(2_000);
          continue;
        }
        throw error;
      }
      const to = channel.ledgerReportTo as string;
      if (status.status === "DONE" && status.documentId) {
        const text = await downloadReport(creds, region, status.documentId, LEDGER_DENIED);
        const parsed = parseInventoryLedger(text);
        if (!parsed.ok && text.trim()) {
          throw new AmazonError(
            `Amazon's inventory ledger couldn't be read: ${parsed.error}`,
            "unexpected",
          );
        }
        const events = parsed.ok ? parsed.events : [];
        const saved = await withOrg(getDb(), ctx, async (tx) => {
          const r = await importLedgerEvents(tx, {
            orgId: ctx.orgId,
            channelId,
            events,
            through: to,
          });
          await saveLedgerReport(tx, channelId, null);
          return r;
        });
        result.added += saved.added;
      } else if (status.status === "CANCELLED") {
        // Amazon cancels a report with nothing in it: those days are in, with no movements.
        await withOrg(getDb(), ctx, async (tx) => {
          await importLedgerEvents(tx, { orgId: ctx.orgId, channelId, events: [], through: to });
          await saveLedgerReport(tx, channelId, null);
        });
      } else if (status.status === "FATAL") {
        await withOrg(getDb(), ctx, (tx) => saveLedgerReport(tx, channelId, null));
        throw new AmazonError(
          "Amazon couldn't make the inventory ledger report. Try again later.",
          "unexpected",
        );
      } else {
        if (Date.now() + 5_000 >= deadline) {
          result.waiting = true;
          break;
        }
        await sleep(5_000);
        continue;
      }
      const next = await load();
      if (!next) break;
      channel = next.channel;
      result.through = channel.ledgerSyncedThrough;
    }
    if (channel.ledgerReportId) result.waiting = true;
  } catch (error) {
    if (error instanceof AmazonError || error instanceof VaultError) {
      return { ...result, error: `${channel.name}: ${error.message}` };
    }
    throw error;
  }
  return result;
}

/** The daily job: every marketplace orders are brought in for, within the budget. */
export async function syncAllLedgers(budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  const rows = await getDb().execute<{ organization_id: string; channel_id: string }>(
    sql`select organization_id, channel_id from syncable_sales_channels()`,
  );
  let added = 0;
  let failed = 0;
  for (const row of rows.rows) {
    if (Date.now() >= deadline) break;
    const r = await syncChannelLedger(
      { orgId: row.organization_id, userId: null },
      row.channel_id,
      Math.min(deadline, Date.now() + 45_000),
    ).catch((error) => {
      logError("job.amazon_ledger_failed", error, {
        orgId: row.organization_id,
        channelId: row.channel_id,
      });
      return { added: 0, error: "failed" };
    });
    // Handled failures (a refused key, a missing role) are saved on the connection and shown in
    // the app; log them too, so a run's problems can be read in one place.
    if (r.error && r.error !== "failed") {
      logWarn("job.amazon_ledger_problem", {
        orgId: row.organization_id,
        channelId: row.channel_id,
        problem: r.error,
      });
    }
    added += r.added;
    if (r.error) failed++;
  }
  return { channels: rows.rows.length, added, failed };
}

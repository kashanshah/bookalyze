import "server-only";
import {
  connectionSecretContext,
  type FeedLine,
  getConnection,
  getDb,
  type ImportResult,
  importBankLines,
  listFeeds,
  markFeedSynced,
  missingCadRates,
  openSecret,
  recordConnectionSync,
  recordFeedBalance,
  schema,
  sealSecret,
  withOrg,
} from "@bookalyze/db";
import { sql } from "drizzle-orm";
import { nowIn } from "@/lib/dates";
import { audit } from "./audit";
import { env } from "./env";
import { syncBankOfCanada } from "./fx";
import { WiseError, wiseBalances, wiseStatement } from "./wise";

/**
 * Syncing bank connections: fetch each feed's new transactions from the provider (outside any
 * database transaction), then post them in one withOrg() transaction. Safe to run any number of
 * times: lines already in the books are recognised and left alone.
 */

const DAY = 86_400_000;
/** Re-read a few days before the last sync: banks post some lines late. */
const OVERLAP_DAYS = 7;
/** Wise statements cover at most about 15 months; stay well inside it. */
const WINDOW_DAYS = 180;

export function sealConnectionSecret(orgId: string, connectionId: string, secret: string) {
  return sealSecret(secret, connectionSecretContext(orgId, connectionId), env().APP_ENCRYPTION_KEY);
}

export type SyncSummary = ImportResult & { error: string | null };

/**
 * Bank of Canada rates for foreign-currency bank lines, fetched once for the whole range when any
 * are missing (lines without a rate wait as pending otherwise).
 */
export async function ensureRates(
  baseCurrency: string,
  lines: readonly { currency: string; date: string }[],
) {
  const foreign = lines.filter((l) => l.currency !== baseCurrency);
  if (!foreign.length) return;
  const dates = foreign.map((l) => l.date).sort();
  const first = dates[0] as string;
  const last = dates.at(-1) as string;
  const db = getDb();
  let missing = false;
  for (const c of new Set(foreign.map((l) => l.currency))) {
    if ((await missingCadRates(db, baseCurrency, c, last)).length) missing = true;
    if ((await missingCadRates(db, baseCurrency, c, first)).length) missing = true;
  }
  if (missing) {
    const from = new Date(new Date(`${first}T00:00:00Z`).getTime() - 7 * DAY)
      .toISOString()
      .slice(0, 10);
    await syncBankOfCanada(from, last).catch(() => 0);
  }
}

type SyncContext = { orgId: string; userId: string | null };

/** Syncs one connection. Errors are recorded on it and returned, not thrown. */
export async function syncConnection(ctx: SyncContext, connectionId: string): Promise<SyncSummary> {
  const db = getDb();
  const startedAt = new Date();
  const setup = await withOrg(db, ctx, async (tx) => {
    const connection = await getConnection(tx, connectionId);
    const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
    return { connection, profile, feeds: connection ? await listFeeds(tx, connectionId) : [] };
  });
  const { connection, profile, feeds } = setup;
  const empty: ImportResult = { posted: 0, duplicates: 0, flagged: 0, categorized: 0, skipped: [] };
  if (!connection || !profile || connection.status === "disconnected" || !connection.secret) {
    return { ...empty, error: "This connection isn't active." };
  }

  let error: string | null = null;
  const lines: FeedLine[] = [];
  const fetched = new Map<string, Date>();
  const balances = new Map<string, string>();
  try {
    const token = openSecret(
      connection.secret,
      connectionSecretContext(ctx.orgId, connectionId),
      env().APP_ENCRYPTION_KEY,
    );
    const profileId = Number(connection.settings.profileId);
    for (const feed of feeds) {
      const syncFrom = new Date(`${feed.syncFrom}T00:00:00Z`).getTime() - DAY; // time-zone slack
      let start = Math.max(syncFrom, (feed.syncedThrough?.getTime() ?? 0) - OVERLAP_DAYS * DAY);
      const end = startedAt.getTime();
      while (start < end) {
        const stop = Math.min(start + WINDOW_DAYS * DAY, end);
        const part = await wiseStatement(token, {
          profileId,
          balanceId: Number(feed.externalId),
          currency: feed.currency,
          start: new Date(start),
          end: new Date(stop),
          timeZone: profile.timezone,
        });
        for (const line of part) {
          if (line.date >= feed.syncFrom) lines.push({ ...line, feedId: feed.id });
        }
        start = stop;
      }
      fetched.set(feed.id, startedAt);
    }
    // What Wise says each balance holds now, to show beside the balance in the books.
    try {
      for (const b of await wiseBalances(token, profileId)) balances.set(String(b.id), b.amount);
    } catch {
      // Not worth failing the sync over; the last figure stays.
    }
  } catch (e) {
    error = e instanceof WiseError || e instanceof Error ? e.message : "The sync failed.";
  }

  await ensureRates(profile.baseCurrency, lines);

  const result = await withOrg(db, ctx, async (tx) => {
    const imported = lines.length
      ? await importBankLines(tx, {
          orgId: ctx.orgId,
          userId: ctx.userId,
          baseCurrency: profile.baseCurrency,
          lines,
        })
      : empty;
    // A feed counts as synced only once everything it fetched is in the books (or a duplicate);
    // skipped lines keep it where it was so they're tried again.
    const stuck = new Set(
      imported.skipped.map((s) => lines.find((l) => l.externalId === s.externalId)?.feedId),
    );
    for (const [feedId, through] of fetched) {
      if (!stuck.has(feedId)) await markFeedSynced(tx, feedId, through);
    }
    const today = nowIn(profile.timezone).date;
    for (const feed of feeds) {
      const amount = balances.get(feed.externalId);
      if (amount !== undefined) await recordFeedBalance(tx, feed.id, { amount, on: today });
    }
    await recordConnectionSync(tx, connectionId, { at: startedAt, error });
    if (imported.posted && ctx.userId) {
      await audit(tx, {
        orgId: ctx.orgId,
        actorUserId: ctx.userId,
        action: "bank.sync",
        entityType: "connection",
        entityId: connectionId,
        after: {
          posted: imported.posted,
          duplicates: imported.duplicates,
          flagged: imported.flagged,
          categorized: imported.categorized,
          skipped: imported.skipped.length,
        },
      });
    }
    return imported;
  });
  return { ...result, error };
}

/**
 * The daily sync for every company (run by the cron). It only learns organization and
 * connection IDs outside withOrg(), through the syncable_connections() database function.
 */
export async function syncAllConnections(): Promise<{
  connections: number;
  posted: number;
  failed: number;
}> {
  const listed = await getDb().execute<{ organization_id: string; connection_id: string }>(
    sql`select organization_id, connection_id from syncable_connections()`,
  );
  let posted = 0;
  let failed = 0;
  for (const row of listed.rows) {
    const summary = await syncConnection(
      { orgId: row.organization_id, userId: null },
      row.connection_id,
    ).catch(() => ({ posted: 0, error: "failed" }));
    posted += summary.posted;
    if (summary.error) failed++;
  }
  return { connections: listed.rows.length, posted, failed };
}

import "server-only";
import {
  can,
  ebayTransactionsQuery,
  getPlan,
  isModuleKey,
  type ModuleKey,
  nextNoonWindow,
  parseEbayTransactionsPage,
} from "@bookalyze/core";
import {
  type EbaySyncState,
  ebaySyncState,
  getConnection,
  getDb,
  getEbayConnection,
  importEbayTransactions,
  placeEbayTransactionsByOrder,
  recordConnectionSync,
  saveEbaySyncState,
  schema,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import { nowIn } from "@/lib/dates";
import { EbayError, ebaySellGet, openEbayCredentials } from "./ebay";
import { logError, logInfo, logWarn } from "./log";

/**
 * Bringing eBay's money in (Finances API), within a time budget: a year back, a calendar month
 * per window, up to yesterday; once caught up, the last three weeks again now and then (rows
 * move from on hold to paid out, and late fees arrive). A window is read 1,000 rows a page; a
 * window cut short by the budget is kept on the connection and the next run carries on from its
 * page. Nothing here posts to the books.
 */

export type EbayMoneyResult = {
  added: number;
  updated: number;
  /** Days through this one are in. */
  through: string | null;
  /** More to do: run again. */
  more: boolean;
  error: string | null;
};

type SyncContext = { orgId: string; userId: string | null };

/** Stop starting new pages this close to the deadline. */
const MARGIN_MS = 4_000;

export async function syncEbayTransactions(
  ctx: SyncContext,
  today: string,
  budgetMs: number,
): Promise<EbayMoneyResult | null> {
  const deadline = Date.now() + budgetMs;
  const connection = await withOrg(getDb(), ctx, async (tx) => {
    const found = await getEbayConnection(tx);
    return found && found.status !== "disconnected" && found.hasSecret
      ? getConnection(tx, found.id)
      : null;
  });
  if (!connection?.secret) return null;
  const marketplaceId =
    typeof connection.settings.marketplace === "string"
      ? connection.settings.marketplace
      : undefined;

  let state: EbaySyncState = ebaySyncState(connection.settings);
  const result: EbayMoneyResult = {
    added: 0,
    updated: 0,
    through: state.through,
    more: false,
    error: null,
  };
  try {
    const { refreshToken } = openEbayCredentials(ctx.orgId, connection.id, connection.secret);
    while (Date.now() < deadline - MARGIN_MS) {
      const window =
        state.pending ??
        (() => {
          const next = nextNoonWindow(state, today);
          return next ? { from: next.from, to: next.to, offset: 0 } : null;
        })();
      if (!window) break;
      const json = await ebaySellGet(refreshToken, ebayTransactionsQuery(window), {
        host: "apiz",
        marketplaceId,
      });
      let page: ReturnType<typeof parseEbayTransactionsPage>;
      try {
        page = parseEbayTransactionsPage(json);
      } catch (cause) {
        throw new EbayError("eBay's list of payments didn't make sense. Try again.", "unexpected", {
          cause,
        });
      }
      const next: EbaySyncState =
        page.next !== null
          ? { ...state, pending: { ...window, offset: page.next } }
          : {
              through: !state.through || window.to > state.through ? window.to : state.through,
              // Caught up to yesterday: the next read is a refresh, a while from now.
              refreshedAt:
                window.to >= dayBefore(today) ? new Date().toISOString() : state.refreshedAt,
              pending: null,
            };
      const saved = await withOrg(getDb(), ctx, async (tx) => {
        const r = await importEbayTransactions(tx, { orgId: ctx.orgId, rows: page.transactions });
        await placeEbayTransactionsByOrder(tx);
        await saveEbaySyncState(tx, connection.id, next);
        return r;
      });
      result.added += saved.added;
      result.updated += saved.updated;
      state = next;
      result.through = state.through;
      logInfo("ebay.transactions_imported", {
        orgId: ctx.orgId,
        from: window.from,
        to: window.to,
        rows: page.transactions.length,
      });
    }
    result.more =
      state.pending !== null || nextNoonWindow(state, today) !== null
        ? Date.now() >= deadline - MARGIN_MS
        : false;
    await withOrg(getDb(), ctx, (tx) =>
      recordConnectionSync(tx, connection.id, { at: new Date(), error: null }),
    );
  } catch (error) {
    if (!(error instanceof EbayError) && !(error instanceof VaultError)) throw error;
    result.error =
      error instanceof EbayError && error.code === "forbidden"
        ? "eBay didn't let us read payments. Connect eBay again and agree to every item."
        : error.message;
    await withOrg(getDb(), ctx, (tx) =>
      recordConnectionSync(tx, connection.id, { at: new Date(), error: result.error }),
    );
  }
  return result;
}

const dayBefore = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Each company's share of the daily job's eBay time. */
const PER_COMPANY_MS = 20_000;

/**
 * eBay in the daily job: for each company with a live eBay connection (and the settlements
 * feature), new and changed money rows come in.
 */
export async function runEbayDaily(
  budgetMs: number,
): Promise<{ companies: number; added: number; failed: number }> {
  const deadline = Date.now() + budgetMs;
  const result = { companies: 0, added: 0, failed: 0 };
  const orgs = await getDb().select({ id: schema.organization.id }).from(schema.organization);
  for (const org of orgs) {
    if (Date.now() > deadline) break;
    const ctx = { orgId: org.id, userId: null };
    try {
      const today = await withOrg(getDb(), ctx, async (tx) => {
        const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
        if (!profile) return null;
        const enabled = (await tx.select().from(schema.organizationModules))
          .filter((m) => m.enabled && isModuleKey(m.moduleKey))
          .map((m) => m.moduleKey as ModuleKey);
        if (!can(getPlan(profile.planKey), enabled, "commerce.settlements")) return null;
        const connection = await getEbayConnection(tx);
        if (!connection?.hasSecret || connection.status === "disconnected") return null;
        return nowIn(profile.timezone).date;
      });
      if (!today) continue;
      result.companies++;
      const budget = Math.min(PER_COMPANY_MS, Math.max(0, deadline - Date.now()));
      const synced = await syncEbayTransactions(ctx, today, budget);
      if (synced) {
        result.added += synced.added;
        if (synced.error) logWarn("ebay.daily_sync_error", { orgId: org.id, error: synced.error });
      }
    } catch (error) {
      result.failed++;
      logError("ebay.daily_failed", error, { orgId: org.id });
    }
  }
  return result;
}

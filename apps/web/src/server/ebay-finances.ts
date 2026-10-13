import "server-only";
import {
  can,
  type EbayPayout,
  ebayPayoutsQuery,
  ebayTransactionsQuery,
  getPlan,
  isModuleKey,
  type ModuleKey,
  monthEnd,
  nextNoonWindow,
  parseEbayPayoutsPage,
  parseEbayTransactionsPage,
} from "@bookalyze/core";
import {
  type EbaySyncState,
  ebayMonthsToPost,
  ebayPayoutsWithOneDeposit,
  ebaySyncState,
  getConnection,
  getDb,
  getEbayAccounts,
  getEbayConnection,
  getEbaySettings,
  importEbayPayouts,
  importEbayTransactions,
  LedgerError,
  matchEbayPayout,
  placeEbayTransactionsByOrder,
  postEbayMonth,
  recordConnectionSync,
  saveEbaySyncState,
  schema,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import { nowIn } from "@/lib/dates";
import { audit } from "./audit";
import { EbayError, ebaySellGet, openEbayCredentials } from "./ebay";
import { suggestRate } from "./fx";
import { logError, logInfo, logWarn } from "./log";

/**
 * Bringing eBay's money in (Finances API), within a time budget: a year back, a calendar month
 * per window, up to yesterday; once caught up, the last three weeks again now and then (rows
 * move from on hold to paid out, and late fees arrive). A window is read 1,000 rows a page; a
 * window cut short by the budget is kept on the connection and the next run carries on from its
 * page. When a window's rows are all in, its payouts come in too (to match to bank deposits).
 * Nothing here posts to the books.
 */

export type EbayMoneyResult = {
  added: number;
  updated: number;
  /** New payouts. */
  payouts: number;
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
    payouts: 0,
    through: state.through,
    more: false,
    error: null,
  };
  try {
    const { refreshToken } = openEbayCredentials(ctx.orgId, connection.id, connection.secret);
    // Days read before payouts came in (slice 5): their payouts first, a month at a time.
    while (
      state.through &&
      (!state.payoutsThrough || state.payoutsThrough < state.through) &&
      Date.now() < deadline - MARGIN_MS
    ) {
      const window = nextNoonWindow(
        { through: state.payoutsThrough, refreshedAt: new Date().toISOString() },
        today,
      );
      if (!window || window.from > state.through) {
        state = { ...state, payoutsThrough: state.through };
        break;
      }
      const to = window.to < state.through ? window.to : state.through;
      const payouts = await readPayouts(refreshToken, { from: window.from, to }, marketplaceId);
      const next: EbaySyncState = { ...state, payoutsThrough: to };
      result.payouts += await withOrg(getDb(), ctx, async (tx) => {
        const added = await importEbayPayouts(tx, { orgId: ctx.orgId, payouts });
        await saveEbaySyncState(tx, connection.id, next);
        return added;
      });
      state = next;
    }
    const payoutsBehind = () =>
      Boolean(state.through && (!state.payoutsThrough || state.payoutsThrough < state.through));
    while (!payoutsBehind() && Date.now() < deadline - MARGIN_MS) {
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
              payoutsThrough:
                !state.through || window.to > state.through ? window.to : state.through,
            };
      // The window's last page: its payouts too (a few a week, so all of them now).
      const payouts =
        page.next === null ? await readPayouts(refreshToken, window, marketplaceId) : [];
      const saved = await withOrg(getDb(), ctx, async (tx) => {
        const r = await importEbayTransactions(tx, { orgId: ctx.orgId, rows: page.transactions });
        await placeEbayTransactionsByOrder(tx);
        const newPayouts = await importEbayPayouts(tx, { orgId: ctx.orgId, payouts });
        await saveEbaySyncState(tx, connection.id, next);
        return { ...r, payouts: newPayouts };
      });
      result.added += saved.added;
      result.updated += saved.updated;
      result.payouts += saved.payouts;
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
      payoutsBehind() || state.pending !== null || nextNoonWindow(state, today) !== null
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

/** Every payout dated in a window of days. */
async function readPayouts(
  refreshToken: string,
  window: { from: string; to: string },
  marketplaceId: string | undefined,
): Promise<EbayPayout[]> {
  const payouts: EbayPayout[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const json = await ebaySellGet(refreshToken, ebayPayoutsQuery({ ...window, offset }), {
      host: "apiz",
      marketplaceId,
    });
    let page: ReturnType<typeof parseEbayPayoutsPage>;
    try {
      page = parseEbayPayoutsPage(json);
    } catch (cause) {
      throw new EbayError("eBay's list of payouts didn't make sense. Try again.", "unexpected", {
        cause,
      });
    }
    payouts.push(...page.payouts);
    offset = page.next;
  }
  return payouts;
}

const dayBefore = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Each company's share of the daily job's eBay time. */
const PER_COMPANY_MS = 20_000;

export type EbayDailyResult = {
  companies: number;
  added: number;
  posted: number;
  matched: number;
  failed: number;
};

/**
 * eBay in the daily job: for each company with a live eBay connection (and the settlements
 * feature), new and changed money rows and payouts come in. Where "Post eBay automatically" is
 * on, finished months post (and months eBay changed post again) and each payout is matched to
 * its bank deposit when exactly one deposit fits it exactly and is uncategorized or in the eBay
 * sales account (so nothing someone chose on purpose is moved). Anything else waits on the eBay
 * money page for a person.
 */
export async function runEbayDaily(budgetMs: number): Promise<EbayDailyResult> {
  const deadline = Date.now() + budgetMs;
  const result: EbayDailyResult = { companies: 0, added: 0, posted: 0, matched: 0, failed: 0 };
  const orgs = await getDb().select({ id: schema.organization.id }).from(schema.organization);
  for (const org of orgs) {
    if (Date.now() > deadline) break;
    const ctx = { orgId: org.id, userId: null };
    try {
      const setup = await withOrg(getDb(), ctx, async (tx) => {
        const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
        if (!profile) return null;
        const enabled = (await tx.select().from(schema.organizationModules))
          .filter((m) => m.enabled && isModuleKey(m.moduleKey))
          .map((m) => m.moduleKey as ModuleKey);
        if (!can(getPlan(profile.planKey), enabled, "commerce.settlements")) return null;
        const connection = await getEbayConnection(tx);
        const live = Boolean(connection?.hasSecret && connection.status !== "disconnected");
        const settings = await getEbaySettings(tx);
        if (!live && !settings.autoPost) return null;
        return { profile, live, settings, sales: (await getEbayAccounts(tx)).sales ?? null };
      });
      if (!setup) continue;
      result.companies++;
      const { profile } = setup;
      const today = nowIn(profile.timezone).date;
      if (setup.live) {
        const budget = Math.min(PER_COMPANY_MS, Math.max(0, deadline - Date.now()));
        const synced = await syncEbayTransactions(ctx, today, budget);
        if (synced) {
          result.added += synced.added;
          if (synced.error)
            logWarn("ebay.daily_sync_error", { orgId: org.id, error: synced.error });
        }
      }
      if (!setup.settings.autoPost || !setup.settings.postFrom) continue;

      const months = await withOrg(getDb(), ctx, (tx) => ebayMonthsToPost(tx, today));
      for (const m of months) {
        try {
          if (m.currency !== profile.baseCurrency) {
            await suggestRate(profile.baseCurrency, m.currency, monthEnd(m.month));
          }
          await withOrg(getDb(), ctx, async (tx) => {
            const entry = await postEbayMonth(tx, {
              orgId: org.id,
              userId: null,
              channelId: m.channelId,
              month: m.month,
              baseCurrency: profile.baseCurrency,
              today,
            });
            await audit(tx, {
              orgId: org.id,
              actorUserId: null,
              action: entry.again ? "ebay.month_reposted" : "ebay.month_posted",
              entityType: "sales_channel",
              entityId: m.channelId,
              after: { month: m.month, journalEntryId: entry.id, net: entry.net, automatic: true },
            });
          });
          result.posted++;
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          // No rate yet, a closed period, an account missing…: it waits for a person.
          logWarn(
            "ebay.auto_post_skipped",
            { orgId: org.id, channelId: m.channelId, month: m.month },
            error,
          );
          result.failed++;
        }
      }

      const found = await withOrg(getDb(), ctx, (tx) => ebayPayoutsWithOneDeposit(tx, 50));
      for (const f of found) {
        const d = f.deposit;
        const onlySales = setup.sales && d.categoryAccountIds.every((a) => a === setup.sales);
        if (!d.uncategorized && !onlySales) continue;
        try {
          await withOrg(getDb(), ctx, async (tx) => {
            const done = await matchEbayPayout(tx, {
              orgId: org.id,
              userId: null,
              payoutId: f.payoutId,
              entryId: d.entryId,
              baseCurrency: profile.baseCurrency,
            });
            await audit(tx, {
              orgId: org.id,
              actorUserId: null,
              action: "ebay.payout_matched",
              entityType: "ebay_payout",
              entityId: f.payoutId,
              before: { journalEntryId: d.entryId, categories: d.categories },
              after: { journalEntryId: done.id, automatic: true },
            });
          });
          result.matched++;
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          logWarn(
            "ebay.auto_match_skipped",
            { orgId: org.id, payoutId: f.payoutId, entryId: d.entryId },
            error,
          );
          result.failed++;
        }
      }
    } catch (error) {
      result.failed++;
      logError("ebay.daily_failed", error, { orgId: org.id });
    }
  }
  return result;
}

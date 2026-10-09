import "server-only";
import { can, getPlan, isModuleKey, type ModuleKey, monthEnd } from "@bookalyze/core";
import {
  getDb,
  getNoonAccounts,
  getNoonConnection,
  getNoonSettings,
  LedgerError,
  matchNoonPayout,
  noonMonthsToPost,
  noonPayoutsWithOneDeposit,
  postNoonMonth,
  schema,
  withOrg,
} from "@bookalyze/db";
import { nowIn } from "@/lib/dates";
import { audit } from "./audit";
import { suggestRate } from "./fx";
import { logError, logWarn } from "./log";
import { syncNoonTransactions } from "./noon-transactions";

/**
 * Noon in the daily job: for each company with Noon, new rows come in from Noon's API (where
 * it's connected and its key can download the transaction view), then, where "Post Noon
 * automatically" is on, finished months post (and months Noon changed post again) and each
 * payout is matched to its bank deposit when exactly one deposit fits it exactly and is
 * uncategorized or in the Noon sales account (so nothing someone chose on purpose is moved).
 * Anything else waits on the Noon transactions page for a person.
 */

export type NoonDailyResult = {
  companies: number;
  added: number;
  posted: number;
  matched: number;
  failed: number;
};

/** Each company's share of the time Noon gets (an export can take a while to be made). */
const PER_COMPANY_MS = 25_000;

export async function runNoonDaily(budgetMs: number): Promise<NoonDailyResult> {
  const deadline = Date.now() + budgetMs;
  const result: NoonDailyResult = { companies: 0, added: 0, posted: 0, matched: 0, failed: 0 };
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
        const connection = await getNoonConnection(tx);
        const settings = await getNoonSettings(tx);
        const live =
          connection?.hasSecret &&
          connection.status !== "disconnected" &&
          Boolean(connection.settings.payoutsReport);
        if (!live && !settings.autoPost) return null;
        return {
          profile,
          live,
          settings,
          sales: (await getNoonAccounts(tx)).sales ?? null,
        };
      });
      if (!setup) continue;
      result.companies++;
      const { profile } = setup;
      const today = nowIn(profile.timezone).date;

      if (setup.live) {
        const budget = Math.min(PER_COMPANY_MS, Math.max(0, deadline - Date.now()));
        const synced = await syncNoonTransactions(ctx, today, budget);
        if (synced) {
          result.added += synced.added;
          if (synced.error) {
            logWarn("noon.daily_sync_error", { orgId: org.id, error: synced.error });
          }
        }
      }
      if (!setup.settings.autoPost || !setup.settings.postFrom) continue;

      const months = await withOrg(getDb(), ctx, (tx) => noonMonthsToPost(tx, today));
      for (const m of months) {
        try {
          if (m.currency !== profile.baseCurrency) {
            await suggestRate(profile.baseCurrency, m.currency, monthEnd(m.month));
          }
          await withOrg(getDb(), ctx, async (tx) => {
            const entry = await postNoonMonth(tx, {
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
              action: entry.again ? "noon.month_reposted" : "noon.month_posted",
              entityType: "sales_channel",
              entityId: m.channelId,
              after: {
                month: m.month,
                journalEntryId: entry.id,
                earned: entry.earned,
                automatic: true,
              },
            });
          });
          result.posted++;
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          // No rate yet, a closed period, an account missing…: it waits for a person.
          logWarn(
            "noon.auto_post_skipped",
            { orgId: org.id, channelId: m.channelId, month: m.month },
            error,
          );
          result.failed++;
        }
      }

      const found = await withOrg(getDb(), ctx, (tx) => noonPayoutsWithOneDeposit(tx, 50));
      for (const f of found) {
        const d = f.deposit;
        const onlySales = setup.sales && d.categoryAccountIds.every((a) => a === setup.sales);
        if (!d.uncategorized && !onlySales) continue;
        try {
          await withOrg(getDb(), ctx, async (tx) => {
            const done = await matchNoonPayout(tx, {
              orgId: org.id,
              userId: null,
              transactionId: f.transactionId,
              entryId: d.entryId,
              baseCurrency: profile.baseCurrency,
            });
            await audit(tx, {
              orgId: org.id,
              actorUserId: null,
              action: "noon.payout_matched",
              entityType: "noon_transaction",
              entityId: f.transactionId,
              before: { journalEntryId: d.entryId, categories: d.categories },
              after: { journalEntryId: done.id, automatic: true },
            });
          });
          result.matched++;
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          logWarn(
            "noon.auto_match_skipped",
            { orgId: org.id, transactionId: f.transactionId, entryId: d.entryId },
            error,
          );
          result.failed++;
        }
      }
    } catch (error) {
      // One company's trouble doesn't stop the others.
      logError("noon.daily_company_failed", error, { orgId: org.id });
      result.failed++;
    }
  }
  return result;
}

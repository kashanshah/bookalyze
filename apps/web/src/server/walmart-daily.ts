import "server-only";
import { can, getPlan, isModuleKey, type ModuleKey, walmartMarketplace } from "@bookalyze/core";
import {
  getConnection,
  getDb,
  getWalmartAccounts,
  getWalmartSettings,
  LedgerError,
  listWalmartChannels,
  matchWalmartPayout,
  postWalmartSettlement,
  schema,
  walmartPayoutsWithOneDeposit,
  walmartSettlementsToPost,
  withOrg,
} from "@bookalyze/db";
import { audit } from "./audit";
import { openWalmartCredentials } from "./commerce";
import { suggestRate } from "./fx";
import { logError, logWarn } from "./log";
import { WalmartError } from "./walmart";
import { bringInWfsStock } from "./walmart-inventory";
import { bringInWalmartSettlements } from "./walmart-settlements";

/** WFS stock comes in again once it's this old (a little under a day, so each run takes it). */
const WFS_EVERY_MS = 20 * 3_600_000;

/** At most this long on one company's settlement downloads, so one big account can't stall the rest. */
const PER_COMPANY_MS = 15_000;

export type WalmartDailyResult = {
  companies: number;
  added: number;
  posted: number;
  matched: number;
  failed: number;
  /** SKUs whose WFS stock came in. */
  wfsSkus: number;
};

/**
 * The daily job's Walmart part: for each company on a plan with payouts, brings in the new
 * settlements of every connected Walmart channel (and, for WFS channels, what WFS holds), then, where "Post Walmart automatically" is on,
 * posts each settlement ready (one that adds up to Walmart's payout) and matches a payout whose
 * one exact deposit is uncategorized or in the Walmart sales account, so nothing someone chose
 * on purpose is moved. Anything that can't be done waits on Walmart money for a person.
 */
export async function runWalmartDaily(budgetMs: number): Promise<WalmartDailyResult> {
  const deadline = Date.now() + budgetMs;
  const result: WalmartDailyResult = {
    companies: 0,
    added: 0,
    posted: 0,
    matched: 0,
    failed: 0,
    wfsSkus: 0,
  };
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
        const live: {
          channelId: string;
          market: string;
          connectionId: string;
          secret: string;
          /** WFS holds its stock and it wasn't brought in today. */
          wfs: boolean;
        }[] = [];
        for (const channel of await listWalmartChannels(tx)) {
          const marketplace = walmartMarketplace(channel.marketplaceId ?? "");
          if (!channel.isActive || !channel.connectionId || !marketplace) continue;
          const connection = await getConnection(tx, channel.connectionId);
          if (!connection?.secret || connection.status === "disconnected") continue;
          live.push({
            channelId: channel.id,
            market: marketplace.market,
            connectionId: connection.id,
            secret: connection.secret,
            wfs:
              channel.fulfilment !== "seller" &&
              (!channel.skusSyncedAt || Date.now() - channel.skusSyncedAt.getTime() > WFS_EVERY_MS),
          });
        }
        const settings = await getWalmartSettings(tx);
        if (!live.length && !settings.autoPost) return null;
        return { profile, live, settings, sales: (await getWalmartAccounts(tx)).sales ?? null };
      });
      if (!setup) continue;
      result.companies++;
      const { profile } = setup;

      const until = Math.min(deadline, Date.now() + PER_COMPANY_MS);
      for (const c of setup.live) {
        if (Date.now() > until) break;
        try {
          const brought = await bringInWalmartSettlements(
            ctx,
            {
              channelId: c.channelId,
              market: c.market,
              creds: openWalmartCredentials(org.id, c.connectionId, c.secret),
            },
            until,
          );
          result.added += brought.added;
          if (c.wfs && Date.now() < until) {
            const stock = await bringInWfsStock(
              ctx,
              {
                channelId: c.channelId,
                market: c.market,
                creds: openWalmartCredentials(org.id, c.connectionId, c.secret),
              },
              until,
            );
            result.wfsSkus += stock.skus;
          }
        } catch (error) {
          if (!(error instanceof WalmartError)) throw error;
          logWarn(
            "walmart.daily_settlements_failed",
            { orgId: org.id, channelId: c.channelId },
            error,
          );
        }
      }
      if (!setup.settings.autoPost || !setup.settings.postFrom) continue;

      const ready = await withOrg(getDb(), ctx, (tx) => walmartSettlementsToPost(tx));
      for (const s of ready.slice(0, 50)) {
        try {
          if (s.currency !== profile.baseCurrency) {
            await suggestRate(profile.baseCurrency, s.currency, s.date);
          }
          await withOrg(getDb(), ctx, async (tx) => {
            const entry = await postWalmartSettlement(tx, {
              orgId: org.id,
              userId: null,
              settlementId: s.id,
              baseCurrency: profile.baseCurrency,
            });
            await audit(tx, {
              orgId: org.id,
              actorUserId: null,
              action: entry.again ? "walmart.settlement_reposted" : "walmart.settlement_posted",
              entityType: "walmart_settlement",
              entityId: s.id,
              after: {
                journalEntryId: entry.id,
                net: entry.net,
                reportDate: s.reportDate,
                automatic: true,
              },
            });
          });
          result.posted++;
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          // No rate yet, a closed period, an account missing…: it waits for a person.
          logWarn("walmart.auto_post_skipped", { orgId: org.id, settlementId: s.id }, error);
          result.failed++;
        }
      }

      const found = await withOrg(getDb(), ctx, (tx) => walmartPayoutsWithOneDeposit(tx, 50));
      for (const f of found) {
        const d = f.deposit;
        const onlySales = setup.sales && d.categoryAccountIds.every((a) => a === setup.sales);
        if (!d.uncategorized && !onlySales) continue;
        try {
          await withOrg(getDb(), ctx, async (tx) => {
            const done = await matchWalmartPayout(tx, {
              orgId: org.id,
              userId: null,
              settlementId: f.settlementId,
              entryId: d.entryId,
              baseCurrency: profile.baseCurrency,
            });
            await audit(tx, {
              orgId: org.id,
              actorUserId: null,
              action: "walmart.payout_matched",
              entityType: "walmart_settlement",
              entityId: f.settlementId,
              before: { journalEntryId: d.entryId, categories: d.categories },
              after: { journalEntryId: done.id, automatic: true },
            });
          });
          result.matched++;
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          logWarn(
            "walmart.auto_match_skipped",
            { orgId: org.id, settlementId: f.settlementId, entryId: d.entryId },
            error,
          );
          result.failed++;
        }
      }
    } catch (error) {
      logError("walmart.daily_failed", error, { orgId: org.id });
      result.failed++;
    }
  }
  return result;
}

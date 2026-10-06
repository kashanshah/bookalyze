import "server-only";
import { can, getPlan, isModuleKey, localDate, type ModuleKey } from "@bookalyze/core";
import {
  getDb,
  getSettlementAccounts,
  getSettlementSettings,
  LedgerError,
  matchSettlementDeposit,
  postSettlement,
  schema,
  settlementsToPost,
  settlementsWithOneDeposit,
  withOrg,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { formatDate } from "@/lib/dates";
import { audit } from "./audit";
import { suggestRate } from "./fx";

/**
 * Posting settlements outside a page: the entry's date and memo (shared with the Settlements
 * actions), and the daily job that posts new settlements and matches the deposits that fit
 * exactly, for the companies that switched it on ("Post new settlements automatically").
 */

type Profile = { locale: string; timezone: string };

/** One settlement's entry: dated the period's last day (company time), memo in plain words. */
export function settlementEntryFor(
  profile: Profile,
  s: { startAt: Date; endAt: Date; externalId: string; marketplace: string | null },
) {
  const start = localDate(s.startAt.toISOString(), profile.timezone);
  const end = localDate(s.endAt.toISOString(), profile.timezone);
  return {
    date: end,
    memo: `${s.marketplace ?? "Amazon"} settlement ${s.externalId} · ${formatDate(start, profile.locale)} – ${formatDate(end, profile.locale)}`,
  };
}

export type AutoPostResult = { companies: number; posted: number; matched: number; failed: number };

/**
 * The daily job's part: for each company with automatic posting on, posts the settlements ready
 * from its start date (another currency at that day's rate), then matches each posted payout to
 * its deposit when there's exactly one of the same amount in the same currency and it's
 * uncategorized or in the sales account (so nothing someone chose on purpose is moved). Deposits
 * in another currency are never matched here: the rate needs a look first.
 */
export async function autoPostSettlements(): Promise<AutoPostResult> {
  const orgs = await getDb().select({ id: schema.organization.id }).from(schema.organization);
  const result: AutoPostResult = { companies: 0, posted: 0, matched: 0, failed: 0 };
  for (const org of orgs) {
    const ctx = { orgId: org.id, userId: null };
    const setup = await withOrg(getDb(), ctx, async (tx) => {
      const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
      const settings = await getSettlementSettings(tx);
      if (!profile || !settings.autoPost || !settings.postFrom) return null;
      const enabled = (await tx.select().from(schema.organizationModules))
        .filter((m) => m.enabled && isModuleKey(m.moduleKey))
        .map((m) => m.moduleKey as ModuleKey);
      if (!can(getPlan(profile.planKey), enabled, "commerce.settlements")) return null;
      return {
        profile,
        sales: (await getSettlementAccounts(tx)).sales ?? null,
        ids: (await settlementsToPost(tx, { from: settings.postFrom, limit: 50 })).map((r) => r.id),
      };
    });
    if (!setup) continue;
    result.companies++;
    const { profile } = setup;

    for (const id of setup.ids) {
      try {
        await withOrg(getDb(), ctx, async (tx) => {
          const [s] = await tx
            .select()
            .from(schema.settlements)
            .where(eq(schema.settlements.id, id));
          if (!s) return;
          const entry = settlementEntryFor(profile, s);
          if (s.currency !== profile.baseCurrency) {
            await suggestRate(profile.baseCurrency, s.currency, entry.date);
          }
          const posted = await postSettlement(tx, {
            orgId: org.id,
            userId: null,
            settlementId: id,
            baseCurrency: profile.baseCurrency,
            ...entry,
          });
          await audit(tx, {
            orgId: org.id,
            actorUserId: null,
            action: "settlements.posted",
            entityType: "settlement",
            entityId: id,
            after: { journalEntryId: posted.id, total: String(s.total), automatic: true },
          });
        });
        result.posted++;
      } catch (error) {
        if (!(error instanceof LedgerError)) throw error;
        // No rate yet, a closed period…: it waits on the list for a person.
        result.failed++;
      }
    }

    const found = await withOrg(getDb(), ctx, (tx) => settlementsWithOneDeposit(tx, 50));
    for (const f of found) {
      const d = f.deposit;
      const onlySales = setup.sales && d.categoryAccountIds.every((a) => a === setup.sales);
      if (!d.uncategorized && !onlySales) continue;
      try {
        await withOrg(getDb(), ctx, async (tx) => {
          const done = await matchSettlementDeposit(tx, {
            orgId: org.id,
            userId: null,
            settlementId: f.settlementId,
            entryId: d.entryId,
            baseCurrency: profile.baseCurrency,
          });
          await audit(tx, {
            orgId: org.id,
            actorUserId: null,
            action: "settlements.deposit_matched",
            entityType: "settlement",
            entityId: f.settlementId,
            before: { journalEntryId: d.entryId, categories: d.categories },
            after: { journalEntryId: done.id, automatic: true },
          });
        });
        result.matched++;
      } catch (error) {
        if (!(error instanceof LedgerError)) throw error;
        result.failed++;
      }
    }
  }
  return result;
}

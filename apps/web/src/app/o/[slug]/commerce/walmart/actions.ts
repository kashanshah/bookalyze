"use server";

import { can, WALMART_ACCOUNT_KEYS, type WalmartAccounts } from "@bookalyze/core";
import {
  dismissWalmartPayoutDeposit,
  LedgerError,
  matchWalmartPayout,
  postWalmartSettlement,
  saveWalmartSetup,
  schema,
  unmatchWalmartPayout,
  unpostWalmartSettlement,
  walmartPayoutsWithOneDeposit,
  walmartPostingList,
  walmartSettlementsToPost,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { suggestRate } from "@/server/fx";
import { isOrgAdmin } from "@/server/org";

export type WalmartResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function walmartContext(slug: string) {
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) {
    return {
      ctx,
      denied: { ok: false as const, message: "Payouts aren't part of this company's plan." },
    };
  }
  if (!isOrgAdmin(ctx)) {
    return { ctx, denied: { ok: false as const, message: "Only owners and admins can do this." } };
  }
  return { ctx, denied: null };
}

function revalidateBooks(slug: string) {
  revalidatePath(`/o/${slug}/commerce/walmart`, "layout");
  revalidatePath(`/o/${slug}/commerce/channels`, "layout");
  revalidatePath(`/o/${slug}/accounting`, "layout");
}

function postingError(error: unknown): string {
  if (error instanceof LedgerError) {
    if (error.code === "period_locked") {
      return "Your books are closed for that period. Ask an owner to reopen it, or leave this settlement out.";
    }
    return error.message;
  }
  throw error;
}

// --- How Walmart posts --------------------------------------------------------------------

const setupSchema = z.object({
  accounts: z.record(
    z.enum(WALMART_ACCOUNT_KEYS as [string, ...string[]]),
    z.uuid().or(z.literal("")),
  ),
  postFrom: z.string().refine((v) => isIsoDate(v), "Choose the day posting starts."),
  autoPost: z.boolean().optional(),
});

/** Saves the account for each kind of Walmart amount, the Walmart balance and the start day. */
export async function saveWalmartSetupAction(
  slug: string,
  input: z.input<typeof setupSchema>,
): Promise<WalmartResult> {
  const { ctx, denied } = await walmartContext(slug);
  if (denied) return denied;
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the accounts and the start day." };
  const accounts = Object.fromEntries(
    Object.entries(parsed.data.accounts).filter(([, v]) => v),
  ) as WalmartAccounts;
  if (!accounts.balance) return { ok: false, message: "Choose the Walmart balance account." };
  const saved = await inOrg(ctx, async (tx) => {
    const mine = new Map(
      (await tx.select().from(schema.accounts).where(eq(schema.accounts.isArchived, false))).map(
        (a) => [a.id, a],
      ),
    );
    if (Object.values(accounts).some((id) => !mine.has(id ?? ""))) return "unknown";
    if (mine.get(accounts.balance ?? "")?.type !== "asset") return "balance";
    if (
      Object.entries(accounts).some(([key, id]) => key !== "balance" && id === accounts.balance)
    ) {
      return "same";
    }
    await saveWalmartSetup(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      accounts,
      postFrom: parsed.data.postFrom,
      autoPost: parsed.data.autoPost ?? false,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "walmart.accounts_updated",
      entityType: "walmart_settings",
      after: { accounts, postFrom: parsed.data.postFrom, autoPost: parsed.data.autoPost ?? false },
    });
    return "ok";
  });
  if (saved === "balance") {
    return {
      ok: false,
      message: "The Walmart balance account must be an asset (Money in transit).",
    };
  }
  if (saved === "same") {
    return {
      ok: false,
      message: "The Walmart balance account can't also be used for another line. Choose another.",
    };
  }
  if (saved === "unknown") return { ok: false, message: "Choose accounts from the list." };
  revalidateBooks(slug);
  return { ok: true };
}

// --- Settlements --------------------------------------------------------------------------

const settlementSchema = z.object({ settlementId: z.uuid() });

/**
 * Posts Walmart settlements to the books: one, or (`all`) every settlement ready from the start
 * day on (and ones changed since posted), each in its own transaction, oldest first.
 */
export async function postWalmartSettlementsAction(
  slug: string,
  input: z.input<typeof settlementSchema> | { all: true },
): Promise<WalmartResult<{ posted: number; failed: number; message: string | null }>> {
  const { ctx, denied } = await walmartContext(slug);
  if (denied) return denied;
  const one = "all" in input ? null : settlementSchema.safeParse(input);
  if (one && !one.success) return { ok: false, message: "Settlement not found." };
  const list = await inOrg(ctx, (tx) =>
    one?.success ? walmartPostingList(tx) : walmartSettlementsToPost(tx),
  );
  const settlements = (
    one?.success ? list.filter((s) => s.id === one.data.settlementId) : list
  ).slice(0, 50);
  if (one && !settlements.length) return { ok: false, message: "Settlement not found." };
  let posted = 0;
  let failed = 0;
  let message: string | null = null;
  for (const s of settlements) {
    try {
      if (s.currency !== ctx.profile.baseCurrency) {
        // Another currency posts at the settlement's last day's rate: fetch it if it isn't stored.
        await suggestRate(ctx.profile.baseCurrency, s.currency, s.date);
      }
      await inOrg(ctx, async (tx) => {
        const entry = await postWalmartSettlement(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          settlementId: s.id,
          baseCurrency: ctx.profile.baseCurrency,
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: entry.again ? "walmart.settlement_reposted" : "walmart.settlement_posted",
          entityType: "walmart_settlement",
          entityId: s.id,
          after: { journalEntryId: entry.id, net: entry.net, reportDate: s.reportDate },
        });
      });
      posted++;
    } catch (error) {
      failed++;
      message ??= postingError(error);
    }
  }
  revalidateBooks(slug);
  if (one && failed) return { ok: false, message: message ?? "It couldn't be posted." };
  return { ok: true, posted, failed, message };
}

/** Takes a Walmart settlement out of the books (its entry is reversed). */
export async function unpostWalmartSettlementAction(
  slug: string,
  input: z.input<typeof settlementSchema>,
): Promise<WalmartResult> {
  const { ctx, denied } = await walmartContext(slug);
  if (denied) return denied;
  const parsed = settlementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Settlement not found." };
  try {
    await inOrg(ctx, async (tx) => {
      await unpostWalmartSettlement(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        settlementId: parsed.data.settlementId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "walmart.settlement_unposted",
        entityType: "walmart_settlement",
        entityId: parsed.data.settlementId,
      });
    });
  } catch (error) {
    return { ok: false, message: postingError(error) };
  }
  revalidateBooks(slug);
  return { ok: true };
}

// --- Payouts and bank deposits -----------------------------------------------------------

const payoutSchema = z.object({ settlementId: z.uuid(), entryId: z.uuid() });

/** Matches a settlement's payout to its bank deposit (moving the deposit to the Walmart balance). */
export async function matchWalmartPayoutAction(
  slug: string,
  input: z.input<typeof payoutSchema>,
): Promise<WalmartResult> {
  const { ctx, denied } = await walmartContext(slug);
  if (denied) return denied;
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Deposit not found." };
  try {
    await inOrg(ctx, async (tx) => {
      const matched = await matchWalmartPayout(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        ...parsed.data,
        baseCurrency: ctx.profile.baseCurrency,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "walmart.payout_matched",
        entityType: "walmart_settlement",
        entityId: parsed.data.settlementId,
        before: { journalEntryId: parsed.data.entryId, categories: matched.was.categories },
        after: { journalEntryId: matched.id },
      });
    });
  } catch (error) {
    return { ok: false, message: postingError(error) };
  }
  revalidateBooks(slug);
  return { ok: true };
}

/** Undoes a match: the deposit goes back to how it was. */
export async function unmatchWalmartPayoutAction(
  slug: string,
  settlementId: string,
): Promise<WalmartResult> {
  const { ctx, denied } = await walmartContext(slug);
  if (denied) return denied;
  const parsed = settlementSchema.safeParse({ settlementId });
  if (!parsed.success) return { ok: false, message: "Settlement not found." };
  try {
    await inOrg(ctx, async (tx) => {
      const back = await unmatchWalmartPayout(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        settlementId: parsed.data.settlementId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "walmart.payout_unmatched",
        entityType: "walmart_settlement",
        entityId: parsed.data.settlementId,
        after: { journalEntryId: back.id },
      });
    });
  } catch (error) {
    return { ok: false, message: postingError(error) };
  }
  revalidateBooks(slug);
  return { ok: true };
}

/** "Not this one": the deposit isn't suggested for the payout again. */
export async function dismissWalmartPayoutAction(
  slug: string,
  input: z.input<typeof payoutSchema>,
): Promise<WalmartResult> {
  const { ctx, denied } = await walmartContext(slug);
  if (denied) return denied;
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Deposit not found." };
  await inOrg(ctx, async (tx) => {
    await dismissWalmartPayoutDeposit(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      ...parsed.data,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "walmart.payout_deposit_dismissed",
      entityType: "walmart_settlement",
      entityId: parsed.data.settlementId,
      after: { journalEntryId: parsed.data.entryId },
    });
  });
  revalidatePath(`/o/${slug}/commerce/walmart`);
  return { ok: true };
}

/** Matches every payout that has exactly one deposit of its amount (up to 50 per click). */
export async function matchWalmartPayoutsAction(
  slug: string,
): Promise<WalmartResult<{ matched: number; failed: number; message: string | null }>> {
  const { ctx, denied } = await walmartContext(slug);
  if (denied) return denied;
  const found = await inOrg(ctx, (tx) => walmartPayoutsWithOneDeposit(tx, 50));
  let matched = 0;
  let failed = 0;
  let message: string | null = null;
  for (const f of found) {
    try {
      await inOrg(ctx, async (tx) => {
        const done = await matchWalmartPayout(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          settlementId: f.settlementId,
          entryId: f.deposit.entryId,
          baseCurrency: ctx.profile.baseCurrency,
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "walmart.payout_matched",
          entityType: "walmart_settlement",
          entityId: f.settlementId,
          before: { journalEntryId: f.deposit.entryId, categories: f.deposit.categories },
          after: { journalEntryId: done.id },
        });
      });
      matched++;
    } catch (error) {
      failed++;
      message ??= postingError(error);
    }
  }
  revalidateBooks(slug);
  return { ok: true, matched, failed, message };
}

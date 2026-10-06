"use server";

import { can, localDate, SETTLEMENT_ACCOUNT_KEYS, type SettlementAccounts } from "@bookalyze/core";
import {
  dismissSettlementDeposit,
  getSettlementSettings,
  LedgerError,
  matchSettlementDeposit,
  postSettlement,
  saveSettlement,
  saveSettlementSetup,
  schema,
  settlementChannel,
  settlementsToPost,
  settlementsWithOneDeposit,
  unmatchSettlementDeposit,
  unpostSettlement,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatDate, isIsoDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { type SettlementSyncResult, syncOrgSettlements } from "@/server/amazon-settlements";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";

export type SettlementResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function settlementsContext(slug: string) {
  const ctx = await getCommerceContext(slug);
  const allowed = can(ctx.plan, ctx.enabledModules, "commerce.settlements");
  return { ctx, allowed };
}

/**
 * Brings in new settlement reports from Amazon, for up to ~40 seconds. `more` says to call again
 * (Amazon lets a report list through about once a minute, so a first look can take a few calls).
 */
export async function syncSettlementsAction(
  slug: string,
): Promise<SettlementResult<SettlementSyncResult>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  const result = await syncOrgSettlements(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    40_000,
  );
  if (!result.connections) {
    return { ok: false, message: "Connect Amazon Seller Central on the Channels page first." };
  }
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  const { connections: _, ...rest } = result;
  return { ok: true, ...rest };
}

const amount = z.string().regex(/^-?\d+(\.\d{1,4})?$/);
/** A settlement read in the browser from the flat file (core `parseSettlementReport`). */
const settlementSchema = z.object({
  settlementId: z.string().trim().min(1).max(100),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  depositDate: z.iso.date().nullable(),
  total: amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  marketplace: z.string().max(100).nullable(),
  orderCount: z.number().int().min(0),
  balanced: z.boolean(),
  lines: z
    .array(
      z.object({
        transactionType: z.string().max(200),
        amountType: z.string().max(200),
        amountDescription: z.string().max(200),
        amount,
        count: z.number().int().min(0),
      }),
    )
    .max(2_000),
});

/**
 * Adds a settlement from Amazon's flat file (Seller Central → Payments → All statements →
 * “Flat File V2”), read in the browser: for periods the Reports API no longer lists.
 */
export async function uploadSettlementAction(
  slug: string,
  input: z.input<typeof settlementSchema>,
): Promise<SettlementResult<{ id: string; created: boolean }>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx))
    return { ok: false, message: "Only owners and admins can add settlements." };
  const parsed = settlementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That settlement couldn't be read." };
  const settlement = parsed.data;
  const saved = await inOrg(ctx, async (tx) => {
    const channelId = await settlementChannel(tx, {
      connectionId: null,
      marketplace: settlement.marketplace,
      currency: settlement.currency,
    });
    const row = await saveSettlement(tx, {
      orgId: ctx.org.id,
      connectionId: null,
      channelId,
      reportId: null,
      source: "upload",
      settlement,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "settlements.uploaded",
      entityType: "settlement",
      entityId: row.id,
      after: { settlementId: settlement.settlementId, total: settlement.total },
    });
    return row;
  });
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  return { ok: true, ...saved };
}

// --- Posting ------------------------------------------------------------------------------

const setupSchema = z.object({
  accounts: z.record(
    z.enum(SETTLEMENT_ACCOUNT_KEYS as [string, ...string[]]),
    z.uuid().or(z.literal("")),
  ),
  postFrom: z.string().refine(isIsoDate, "Choose a date."),
});

/** Saves which account each kind of settlement line posts to, and when posting starts. */
export async function saveSettlementSetupAction(
  slug: string,
  input: z.input<typeof setupSchema>,
): Promise<SettlementResult> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can change this." };
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the accounts and the date." };
  const accounts = parsed.data.accounts as SettlementAccounts;
  if (!accounts.clearing) return { ok: false, message: "Choose the clearing account." };
  const saved = await inOrg(ctx, async (tx) => {
    const mine = new Map(
      (await tx.select().from(schema.accounts).where(eq(schema.accounts.isArchived, false))).map(
        (a) => [a.id, a],
      ),
    );
    const chosen = Object.values(accounts).filter(Boolean) as string[];
    if (chosen.some((id) => !mine.has(id))) return false;
    if (mine.get(accounts.clearing ?? "")?.type !== "asset") return "clearing";
    await saveSettlementSetup(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      accounts,
      postFrom: parsed.data.postFrom,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "settlements.accounts_updated",
      entityType: "settlement_settings",
      after: { accounts, postFrom: parsed.data.postFrom },
    });
    return true;
  });
  if (saved === "clearing") {
    return { ok: false, message: "The clearing account must be an asset (Money in transit)." };
  }
  if (!saved) return { ok: false, message: "Choose accounts from the list." };
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  return { ok: true };
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

/** One settlement's entry: dated the period's last day (company time), memo in plain words. */
function entryFor(
  ctx: Awaited<ReturnType<typeof settlementsContext>>["ctx"],
  s: { startAt: Date; endAt: Date; externalId: string; marketplace: string | null },
) {
  const { locale, timezone } = ctx.profile;
  const start = localDate(s.startAt.toISOString(), timezone);
  const end = localDate(s.endAt.toISOString(), timezone);
  return {
    date: end,
    memo: `${s.marketplace ?? "Amazon"} settlement ${s.externalId} · ${formatDate(start, locale)} – ${formatDate(end, locale)}`,
  };
}

/** Posts settlements to the books: one, or (`all`) every one ready from the start date on. */
export async function postSettlementsAction(
  slug: string,
  input: { id: string } | { all: true },
): Promise<SettlementResult<{ posted: number; failed: number; message: string | null }>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx))
    return { ok: false, message: "Only owners and admins can post settlements." };
  const one = "id" in input ? z.uuid().safeParse(input.id) : null;
  if (one && !one.success) return { ok: false, message: "Settlement not found." };
  const ids = await inOrg(ctx, async (tx) => {
    if (one?.success) return [one.data];
    const { postFrom } = await getSettlementSettings(tx);
    if (!postFrom) return null;
    return (
      await settlementsToPost(tx, {
        from: postFrom,
        limit: 50,
        currency: ctx.profile.baseCurrency,
      })
    ).map((r) => r.id);
  });
  if (!ids) return { ok: false, message: "Choose the accounts and when posting starts first." };
  let posted = 0;
  let failed = 0;
  let message: string | null = null;
  for (const id of ids) {
    try {
      // Each settlement in its own transaction: one that can't post doesn't hold up the rest.
      await inOrg(ctx, async (tx) => {
        const [s] = await tx.select().from(schema.settlements).where(eq(schema.settlements.id, id));
        if (!s) throw new LedgerError("This settlement no longer exists.");
        const entry = await postSettlement(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          settlementId: id,
          baseCurrency: ctx.profile.baseCurrency,
          ...entryFor(ctx, s),
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "settlements.posted",
          entityType: "settlement",
          entityId: id,
          after: { journalEntryId: entry.id, total: String(s.total) },
        });
      });
      posted++;
    } catch (error) {
      failed++;
      message ??= postingError(error);
    }
  }
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  revalidatePath(`/o/${slug}/accounting`, "layout");
  if (one && failed) return { ok: false, message: message ?? "It couldn't be posted." };
  return { ok: true, posted, failed, message };
}

/** Takes a settlement out of the books (its entry is reversed). */
export async function unpostSettlementAction(slug: string, id: string): Promise<SettlementResult> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Settlement not found." };
  try {
    await inOrg(ctx, async (tx) => {
      await unpostSettlement(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        settlementId: id,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "settlements.unposted",
        entityType: "settlement",
        entityId: id,
      });
    });
  } catch (error) {
    return { ok: false, message: postingError(error) };
  }
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  revalidatePath(`/o/${slug}/accounting`, "layout");
  return { ok: true };
}

// --- Matching the payout to its bank deposit -----------------------------------------------

const matchSchema = z.object({ settlementId: z.uuid(), entryId: z.uuid() });

function revalidateBooks(slug: string) {
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  revalidatePath(`/o/${slug}/accounting`, "layout");
}

/** Matches a posted settlement's payout to a bank deposit (moving the deposit to clearing). */
export async function matchDepositAction(
  slug: string,
  input: z.input<typeof matchSchema>,
): Promise<SettlementResult> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Deposit not found." };
  try {
    await inOrg(ctx, async (tx) => {
      const matched = await matchSettlementDeposit(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        ...parsed.data,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "settlements.deposit_matched",
        entityType: "settlement",
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

/** Puts the matched deposit back as it was (its old category). */
export async function unmatchDepositAction(
  slug: string,
  settlementId: string,
): Promise<SettlementResult> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  if (!z.uuid().safeParse(settlementId).success) {
    return { ok: false, message: "Settlement not found." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      const back = await unmatchSettlementDeposit(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        settlementId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "settlements.deposit_unmatched",
        entityType: "settlement",
        entityId: settlementId,
        after: { journalEntryId: back.id },
      });
    });
  } catch (error) {
    return { ok: false, message: postingError(error) };
  }
  revalidateBooks(slug);
  return { ok: true };
}

/** "Not this one": the deposit isn't suggested for the settlement again. */
export async function dismissDepositAction(
  slug: string,
  input: z.input<typeof matchSchema>,
): Promise<SettlementResult> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Deposit not found." };
  await inOrg(ctx, async (tx) => {
    await dismissSettlementDeposit(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      ...parsed.data,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "settlements.deposit_dismissed",
      entityType: "settlement",
      entityId: parsed.data.settlementId,
      after: { journalEntryId: parsed.data.entryId },
    });
  });
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  return { ok: true };
}

/**
 * Matches every posted settlement that has exactly one possible deposit (up to 50 per click),
 * each in its own transaction.
 */
export async function matchFoundDepositsAction(
  slug: string,
): Promise<SettlementResult<{ matched: number; failed: number; message: string | null }>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  const found = await inOrg(ctx, (tx) => settlementsWithOneDeposit(tx, 50));
  let matched = 0;
  let failed = 0;
  let message: string | null = null;
  for (const f of found) {
    try {
      await inOrg(ctx, async (tx) => {
        const done = await matchSettlementDeposit(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          settlementId: f.settlementId,
          entryId: f.deposit.entryId,
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "settlements.deposit_matched",
          entityType: "settlement",
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

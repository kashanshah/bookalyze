"use server";

import {
  can,
  parseDecimal,
  SETTLEMENT_ACCOUNT_KEYS,
  type SettlementAccounts,
} from "@bookalyze/core";
import {
  addReportOrders,
  addReportReturns,
  dismissSettlementDeposit,
  getSettlementSettings,
  LedgerError,
  matchSettlementDeposit,
  postedSettlements,
  postSettlement,
  repostSettlement,
  restoreDismissedDeposits,
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
import { isIsoDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { type SettlementSyncResult, syncOrgSettlements } from "@/server/amazon-settlements";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { suggestRate } from "@/server/fx";
import { isOrgAdmin } from "@/server/org";
import { settlementEntryFor } from "@/server/settlement-posting";

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

/**
 * Adds the settlements of Amazon's date range transaction report (read in the browser, a part
 * at a time). Settlements already here are left as they are (Amazon's own report for them, from
 * the API or a flat file, is more detailed), except one not in the books yet whose payout now
 * reads differently: an earlier upload of this report, before it carried what Amazon held back.
 */
export async function uploadReportSettlementsAction(
  slug: string,
  input: z.input<typeof settlementSchema>[],
): Promise<SettlementResult<{ added: number; updated: number; skipped: number; posted: number }>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx))
    return { ok: false, message: "Only owners and admins can add settlements." };
  const parsed = z.array(settlementSchema).max(50).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those settlements couldn't be read." };
  const counts = await inOrg(ctx, async (tx) => {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let posted = 0;
    for (const settlement of parsed.data) {
      const [existing] = await tx
        .select({
          id: schema.settlements.id,
          total: schema.settlements.total,
          source: schema.settlements.source,
          posted: schema.settlements.journalEntryId,
        })
        .from(schema.settlements)
        .where(eq(schema.settlements.externalId, settlement.settlementId));
      const refresh =
        existing &&
        existing.source === "upload" &&
        !existing.posted &&
        parseDecimal(existing.total) !== parseDecimal(settlement.total);
      if (existing && !refresh) {
        const differs = parseDecimal(existing.total) !== parseDecimal(settlement.total);
        if (existing.source === "upload" && existing.posted && differs) posted++;
        else skipped++;
        continue;
      }
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
        after: {
          settlementId: settlement.settlementId,
          total: settlement.total,
          from: "transaction report",
        },
      });
      if (existing) updated++;
      else added++;
    }
    return { added, updated, skipped, posted };
  });
  // Sent a part at a time: the upload refreshes the page once, when every part is in.
  return { ok: true, ...counts };
}

const reportItemSchema = z.object({
  itemId: z.string().min(1).max(200),
  asin: z.string().max(20),
  sku: z.string().min(1).max(200).nullable(),
  title: z.string().max(500).nullable(),
  quantityOrdered: z.number().int().min(0).max(100_000),
  quantityShipped: z.number().int().min(0).max(100_000),
  itemPrice: amount.nullable(),
  itemTax: amount.nullable(),
  shippingPrice: amount.nullable(),
  shippingTax: amount.nullable(),
  promotionDiscount: amount.nullable(),
});
const reportOrdersSchema = z.object({
  marketplace: z.string().min(1).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  orders: z
    .array(
      z.object({
        order: z.object({
          orderId: z.string().min(1).max(100),
          marketplaceId: z.string().max(40),
          purchasedAt: z.iso.datetime(),
          lastUpdatedAt: z.iso.datetime(),
          status: z.literal("Shipped").or(z.string().max(40)),
          fulfillment: z.enum(["amazon", "merchant"]),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .nullable(),
          total: amount.nullable(),
          itemsShipped: z.number().int().min(0),
          itemsUnshipped: z.number().int().min(0),
          shipCountry: z.string().max(2).nullable(),
          shipRegion: z.string().max(100).nullable(),
          isBusiness: z.boolean(),
          isPrime: z.boolean(),
          isReplacement: z.boolean(),
          replacedOrderId: z.string().max(100).nullable().optional(),
          earliestDelivery: z.iso.date().nullable(),
          latestDelivery: z.iso.date().nullable(),
        }),
        items: z.array(reportItemSchema).max(100),
      }),
    )
    .max(300),
});

/**
 * Adds the orders of Amazon's transaction report (read in the browser, a part at a time) for the
 * years the Orders API no longer reaches, so cost of goods sold can count them. Orders already
 * here (from the API) are left as they are.
 */
export async function uploadReportOrdersAction(
  slug: string,
  input: z.input<typeof reportOrdersSchema>,
): Promise<SettlementResult<{ added: number }>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can add orders." };
  const parsed = reportOrdersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those orders couldn't be read." };
  const { marketplace, currency, orders } = parsed.data;
  const added = await inOrg(ctx, async (tx) => {
    const channelId = await settlementChannel(tx, { connectionId: null, marketplace, currency });
    if (!channelId) return null;
    const n = await addReportOrders(tx, { orgId: ctx.org.id, channelId, orders });
    if (n) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "orders.uploaded",
        entityType: "sales_channel",
        entityId: channelId,
        after: { added: n, from: "transaction report" },
      });
    }
    return n;
  });
  if (added === null)
    return { ok: false, message: `There's no ${marketplace} channel to add its orders to.` };
  // Sent a part at a time: the upload refreshes the page once, when every part is in.
  return { ok: true, added };
}

const reportReturnsSchema = z.object({
  marketplace: z.string().min(1).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  returns: z
    .array(
      z.object({
        date: z.iso.date(),
        orderId: z.string().min(1).max(100),
        sku: z.string().min(1).max(200),
        quantity: z.number().int().min(1).max(100000),
      }),
    )
    .max(1000),
});

/**
 * Counts the transaction report's refunds as customer returns for the days before the
 * marketplace's inventory ledger starts (read in the browser, a part at a time), so cost of goods
 * sold puts those units back into stock. Refunds the ledger covers are left to it.
 */
export async function uploadReportReturnsAction(
  slug: string,
  input: z.input<typeof reportReturnsSchema>,
): Promise<SettlementResult<{ added: number; covered: number }>> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can add returns." };
  const parsed = reportReturnsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those refunds couldn't be read." };
  const { marketplace, currency, returns } = parsed.data;
  const result = await inOrg(ctx, async (tx) => {
    const channelId = await settlementChannel(tx, { connectionId: null, marketplace, currency });
    if (!channelId) return null;
    const r = await addReportReturns(tx, { orgId: ctx.org.id, channelId, returns });
    if (r.added) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "inventory_ledger.returns_from_refunds",
        entityType: "sales_channel",
        entityId: channelId,
        after: { added: r.added, from: "transaction report" },
      });
    }
    return r;
  });
  if (result === null)
    return { ok: false, message: `There's no ${marketplace} channel to add its returns to.` };
  // Sent a part at a time: the upload refreshes the page once, when every part is in.
  return { ok: true, ...result };
}

// --- Posting ------------------------------------------------------------------------------

const setupSchema = z.object({
  accounts: z.record(
    z.enum(SETTLEMENT_ACCOUNT_KEYS as [string, ...string[]]),
    z.uuid().or(z.literal("")),
  ),
  postFrom: z.string().refine(isIsoDate, "Choose a date."),
  autoPost: z.boolean().optional(),
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
      autoPost: parsed.data.autoPost ?? false,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "settlements.accounts_updated",
      entityType: "settlement_settings",
      after: { accounts, postFrom: parsed.data.postFrom, autoPost: parsed.data.autoPost ?? false },
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
  return settlementEntryFor(ctx.profile, s);
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
    return (await settlementsToPost(tx, { from: postFrom, limit: 50 })).map((r) => r.id);
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
        // Another currency posts at that day's rate: fetch it first if it isn't stored yet.
        if (s.currency !== ctx.profile.baseCurrency) {
          await suggestRate(ctx.profile.baseCurrency, s.currency, entryFor(ctx, s).date);
        }
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
/**
 * Posts settlements in the books again with the accounts and grouping as they are now (after
 * the accounts changed): one by id, or all of them, 25 per call from `after` on (the page calls
 * again with `next` until it's null). Matched deposits stay matched.
 */
export async function repostSettlementsAction(
  slug: string,
  input: { id: string } | { after: string | null },
): Promise<
  SettlementResult<{
    reposted: number;
    failed: number;
    message: string | null;
    next: string | null;
  }>
> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  const one = "id" in input ? z.uuid().safeParse(input.id) : null;
  if (one && !one.success) return { ok: false, message: "Settlement not found." };
  const after =
    "after" in input && input.after && z.uuid().safeParse(input.after).success ? input.after : null;
  const page = one?.success
    ? [one.data]
    : (await inOrg(ctx, (tx) => postedSettlements(tx, { after, limit: 25 }))).map((r) => r.id);
  let reposted = 0;
  let failed = 0;
  let message: string | null = null;
  for (const id of page) {
    try {
      await inOrg(ctx, async (tx) => {
        const [s] = await tx.select().from(schema.settlements).where(eq(schema.settlements.id, id));
        if (!s) throw new LedgerError("This settlement no longer exists.");
        if (s.currency !== ctx.profile.baseCurrency) {
          await suggestRate(ctx.profile.baseCurrency, s.currency, entryFor(ctx, s).date);
        }
        const entry = await repostSettlement(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          settlementId: id,
          baseCurrency: ctx.profile.baseCurrency,
          ...entryFor(ctx, s),
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "settlements.reposted",
          entityType: "settlement",
          entityId: id,
          before: { journalEntryId: s.journalEntryId },
          after: { journalEntryId: entry.id },
        });
      });
      reposted++;
    } catch (error) {
      failed++;
      message ??= postingError(error);
    }
  }
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  revalidatePath(`/o/${slug}/accounting`, "layout");
  if (one && failed) return { ok: false, message: message ?? "It couldn't be posted again." };
  const next = !one && page.length === 25 ? (page.at(-1) ?? null) : null;
  return { ok: true, reposted, failed, message, next };
}

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
        baseCurrency: ctx.profile.baseCurrency,
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
/** "Suggest them again": the deposits turned down for this settlement show up again. */
export async function restoreDismissedDepositsAction(
  slug: string,
  settlementId: string,
): Promise<SettlementResult> {
  const { ctx, allowed } = await settlementsContext(slug);
  if (!allowed) return { ok: false, message: "Settlements aren't part of this company's plan." };
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can do this." };
  if (!z.uuid().safeParse(settlementId).success)
    return { ok: false, message: "Settlement not found." };
  await inOrg(ctx, async (tx) => {
    await restoreDismissedDeposits(tx, settlementId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "settlements.deposits_restored",
      entityType: "settlement",
      entityId: settlementId,
    });
  });
  revalidatePath(`/o/${slug}/commerce/settlements`, "layout");
  return { ok: true };
}

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
          baseCurrency: ctx.profile.baseCurrency,
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

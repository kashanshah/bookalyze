"use server";

import { can, EBAY_ACCOUNT_KEYS, type EbayAccounts, monthEnd } from "@bookalyze/core";
import {
  dismissEbayPayoutDeposit,
  type EbayReportImport,
  ebayMonthsToPost,
  ebayPayoutsWithOneDeposit,
  importEbayReport,
  LedgerError,
  matchEbayPayout,
  postEbayMonth,
  saveEbaySetup,
  schema,
  unmatchEbayPayout,
  unpostEbayMonth,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { type EbayMoneyResult, syncEbayTransactions } from "@/server/ebay-finances";
import { suggestRate } from "@/server/fx";
import { logError } from "@/server/log";
import { isOrgAdmin } from "@/server/org";

export type EbayResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function ebayContext(slug: string) {
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

/**
 * Brings in eBay's money rows through the Finances API for up to ~25 seconds: a year back, a
 * month at a time. `more` says to call again.
 */
export async function syncEbayMoneyAction(slug: string): Promise<EbayResult<EbayMoneyResult>> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  try {
    const result = await syncEbayTransactions(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      nowIn(ctx.profile.timezone).date,
      25_000,
    );
    if (!result) return { ok: false, message: "Connect eBay on an eBay site's page first." };
    revalidatePath(`/o/${slug}/commerce/ebay`);
    return { ok: true, ...result };
  } catch (error) {
    logError("ebay.transactions_sync_failed", error, { orgId: ctx.org.id });
    return { ok: false, message: "eBay's payments couldn't be brought in. Try again in a minute." };
  }
}

// --- Seller Hub's transaction report ------------------------------------------------------

const amount = z.string().regex(/^-?\d+(\.\d+)?$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const text = (max: number) => z.string().max(max).nullable();
/** Rows per call: a year's report is sent in parts. */
const REPORT_ROWS = 1_000;
const reportSchema = z.object({
  fileName: z.string().max(200),
  rows: z
    .array(
      z.object({
        transactionId: z.string().startsWith("report:").max(1_500),
        transactionType: z.string().regex(/^[A-Z_]{2,40}$/),
        status: text(50),
        transactionDate: day,
        orderId: text(100),
        payoutId: text(100),
        feeType: text(200),
        currency,
        amount,
        fees: amount,
        ebayTax: amount,
      }),
    )
    .max(REPORT_ROWS),
  payouts: z
    .array(
      z.object({
        payoutId: z.string().min(1).max(100),
        status: z.string().regex(/^[A-Z_]{2,30}$/),
        payoutDate: day,
        currency,
        amount,
        accountLast4: z.string().max(4).nullable(),
      }),
    )
    .max(REPORT_ROWS),
});

/**
 * Adds eBay's transaction report (Seller Hub → Payments → Reports → Transaction report), read in
 * the browser and sent in parts. Days eBay's API already brought in keep the API's rows.
 */
export async function uploadEbayReportAction(
  slug: string,
  input: z.input<typeof reportSchema>,
): Promise<EbayResult<EbayReportImport>> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those rows couldn't be read." };
  const { fileName, rows, payouts } = parsed.data;
  const result = await inOrg(ctx, async (tx) => {
    const [site] = await tx
      .select({ id: schema.salesChannels.id })
      .from(schema.salesChannels)
      .where(eq(schema.salesChannels.kind, "ebay"))
      .limit(1);
    if (!site) return null;
    const saved = await importEbayReport(tx, { orgId: ctx.org.id, rows, payouts });
    const days = rows.map((r) => r.transactionDate.slice(0, 10)).sort();
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "ebay.report_uploaded",
      entityType: "organization",
      entityId: ctx.org.id,
      after: { fileName, from: days[0] ?? null, to: days.at(-1) ?? null, ...saved },
    });
    return saved;
  });
  if (!result) return { ok: false, message: "Add an eBay site on Channels first." };
  revalidatePath(`/o/${slug}/commerce/ebay`, "layout");
  return { ok: true, ...result };
}

// --- Posting to the books -----------------------------------------------------------------

function revalidateBooks(slug: string) {
  revalidatePath(`/o/${slug}/commerce/ebay`, "layout");
  revalidatePath(`/o/${slug}/accounting`, "layout");
}

function postingError(error: unknown): string {
  if (error instanceof LedgerError) {
    if (error.code === "period_locked") {
      return "Your books are closed for that period. Ask an owner to reopen it, or leave this month out.";
    }
    if (error.code === "reconciled" && error.reconciled) {
      const on = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(
        new Date(`${error.reconciled.statementDate}T00:00:00Z`),
      );
      return `This month is reconciled in ${error.reconciled.account} (statement of ${on}), so its entry can't change. To post eBay's new figures, undo that reconciliation, and any after it, in Accounting → Reconcile, then post again and reconcile once more.`;
    }
    return error.message;
  }
  throw error;
}

const setupSchema = z.object({
  accounts: z.record(
    z.enum(EBAY_ACCOUNT_KEYS as [string, ...string[]]),
    z.uuid().or(z.literal("")),
  ),
  postFrom: z
    .string()
    .refine((v) => isIsoDate(v) && v.endsWith("-01"), "Choose the month posting starts."),
  autoPost: z.boolean().optional(),
});

/** Saves the account for each kind of eBay amount, the eBay balance account and the start month. */
export async function saveEbaySetupAction(
  slug: string,
  input: z.input<typeof setupSchema>,
): Promise<EbayResult> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the accounts and the month." };
  const accounts = Object.fromEntries(
    Object.entries(parsed.data.accounts).filter(([, v]) => v),
  ) as EbayAccounts;
  if (!accounts.balance) return { ok: false, message: "Choose the eBay balance account." };
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
    await saveEbaySetup(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      accounts,
      postFrom: parsed.data.postFrom,
      autoPost: parsed.data.autoPost ?? false,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "ebay.accounts_updated",
      entityType: "ebay_settings",
      after: { accounts, postFrom: parsed.data.postFrom, autoPost: parsed.data.autoPost ?? false },
    });
    return "ok";
  });
  if (saved === "balance") {
    return { ok: false, message: "The eBay balance account must be an asset (Money in transit)." };
  }
  if (saved === "same") {
    return {
      ok: false,
      message: "The eBay balance account can't also be used for another line. Choose another.",
    };
  }
  if (saved === "unknown") return { ok: false, message: "Choose accounts from the list." };
  revalidateBooks(slug);
  return { ok: true };
}

const monthSchema = z.object({
  channelId: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

/**
 * Posts eBay months to the books: one, or (`all`) every finished month from the start month on
 * (and months changed since posted), each in its own transaction, oldest first.
 */
export async function postEbayMonthsAction(
  slug: string,
  input: z.input<typeof monthSchema> | { all: true },
): Promise<EbayResult<{ posted: number; failed: number; message: string | null }>> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  const today = nowIn(ctx.profile.timezone).date;
  const one = "all" in input ? null : monthSchema.safeParse(input);
  if (one && !one.success) return { ok: false, message: "Month not found." };
  const months = one?.success
    ? [{ ...one.data, currency: null as string | null }]
    : (await inOrg(ctx, (tx) => ebayMonthsToPost(tx, today))).slice(0, 36);
  let posted = 0;
  let failed = 0;
  let message: string | null = null;
  for (const m of months) {
    try {
      if (m.currency && m.currency !== ctx.profile.baseCurrency) {
        // Another currency posts at the month's last day's rate: fetch it if it isn't stored.
        await suggestRate(ctx.profile.baseCurrency, m.currency, monthEnd(m.month));
      }
      await inOrg(ctx, async (tx) => {
        const entry = await postEbayMonth(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          channelId: m.channelId,
          month: m.month,
          baseCurrency: ctx.profile.baseCurrency,
          today,
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: entry.again ? "ebay.month_reposted" : "ebay.month_posted",
          entityType: "sales_channel",
          entityId: m.channelId,
          after: { month: m.month, journalEntryId: entry.id, net: entry.net },
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

/** Takes an eBay month out of the books (its entry is reversed). */
export async function unpostEbayMonthAction(
  slug: string,
  input: z.input<typeof monthSchema>,
): Promise<EbayResult> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  const parsed = monthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Month not found." };
  try {
    await inOrg(ctx, async (tx) => {
      await unpostEbayMonth(tx, { orgId: ctx.org.id, userId: ctx.session.user.id, ...parsed.data });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "ebay.month_unposted",
        entityType: "sales_channel",
        entityId: parsed.data.channelId,
        after: { month: parsed.data.month },
      });
    });
  } catch (error) {
    return { ok: false, message: postingError(error) };
  }
  revalidateBooks(slug);
  return { ok: true };
}

// --- Payouts and bank deposits -----------------------------------------------------------

const payoutSchema = z.object({ payoutId: z.uuid(), entryId: z.uuid() });

/** Matches an eBay payout to its bank deposit (moving the deposit to the eBay balance). */
export async function matchEbayPayoutAction(
  slug: string,
  input: z.input<typeof payoutSchema>,
): Promise<EbayResult> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Deposit not found." };
  try {
    await inOrg(ctx, async (tx) => {
      const matched = await matchEbayPayout(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        ...parsed.data,
        baseCurrency: ctx.profile.baseCurrency,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "ebay.payout_matched",
        entityType: "ebay_payout",
        entityId: parsed.data.payoutId,
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

/** Puts a matched deposit back as it was (its old category). */
export async function unmatchEbayPayoutAction(slug: string, payoutId: string): Promise<EbayResult> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  if (!z.uuid().safeParse(payoutId).success) return { ok: false, message: "Payout not found." };
  try {
    await inOrg(ctx, async (tx) => {
      const back = await unmatchEbayPayout(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        payoutId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "ebay.payout_unmatched",
        entityType: "ebay_payout",
        entityId: payoutId,
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
export async function dismissEbayPayoutAction(
  slug: string,
  input: z.input<typeof payoutSchema>,
): Promise<EbayResult> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Deposit not found." };
  await inOrg(ctx, async (tx) => {
    await dismissEbayPayoutDeposit(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      ...parsed.data,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "ebay.payout_deposit_dismissed",
      entityType: "ebay_payout",
      entityId: parsed.data.payoutId,
      after: { journalEntryId: parsed.data.entryId },
    });
  });
  revalidatePath(`/o/${slug}/commerce/ebay`);
  return { ok: true };
}

/** Matches every payout that has exactly one deposit of its amount (up to 50 per click). */
export async function matchEbayPayoutsAction(
  slug: string,
): Promise<EbayResult<{ matched: number; failed: number; message: string | null }>> {
  const { ctx, denied } = await ebayContext(slug);
  if (denied) return denied;
  const found = await inOrg(ctx, (tx) => ebayPayoutsWithOneDeposit(tx, 50));
  let matched = 0;
  let failed = 0;
  let message: string | null = null;
  for (const f of found) {
    try {
      await inOrg(ctx, async (tx) => {
        const done = await matchEbayPayout(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          payoutId: f.payoutId,
          entryId: f.deposit.entryId,
          baseCurrency: ctx.profile.baseCurrency,
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "ebay.payout_matched",
          entityType: "ebay_payout",
          entityId: f.payoutId,
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

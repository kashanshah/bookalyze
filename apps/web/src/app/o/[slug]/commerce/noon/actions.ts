"use server";

import {
  can,
  monthEnd,
  NOON_ACCOUNT_KEYS,
  NOON_AMOUNT_FIELDS,
  type NoonAccounts,
} from "@bookalyze/core";
import {
  dismissNoonPayoutDeposit,
  getNoonConnection,
  importNoonTransactions,
  LedgerError,
  matchNoonPayout,
  type NoonImportResult,
  noonMonthsToPost,
  noonPayoutsWithOneDeposit,
  postNoonMonth,
  saveNoonSetup,
  schema,
  unmatchNoonPayout,
  unpostNoonMonth,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { suggestRate } from "@/server/fx";
import { logError } from "@/server/log";
import { type NoonSyncResult, syncNoonTransactions } from "@/server/noon-transactions";
import { isOrgAdmin } from "@/server/org";

export type NoonResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function noonContext(slug: string) {
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) {
    return { ctx, denied: { ok: false, message: "Payouts aren't part of this company's plan." } };
  }
  if (!isOrgAdmin(ctx)) {
    return {
      ctx,
      denied: { ok: false, message: "Only owners and admins can do this." },
    };
  }
  return { ctx, denied: null };
}

const revalidate = (slug: string) => revalidatePath(`/o/${slug}/commerce/noon`);

/**
 * Brings in Noon's transactions through its API for up to ~25 seconds: a year back, a month at
 * a time. `more` says to call again (each month is a report Noon makes in the background).
 */
export async function syncNoonTransactionsAction(
  slug: string,
): Promise<NoonResult<NoonSyncResult>> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  try {
    const result = await syncNoonTransactions(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      nowIn(ctx.profile.timezone).date,
      25_000,
    );
    if (!result) {
      return { ok: false, message: "Connect Noon's API on the Channels page first." };
    }
    revalidate(slug);
    return { ok: true, ...result };
  } catch (error) {
    logError("noon.transactions_sync_failed", error, { orgId: ctx.org.id });
    return {
      ok: false,
      message: "Noon's transactions couldn't be brought in. Try again in a minute.",
    };
  }
}

const amount = z.string().regex(/^-?\d+(\.\d{1,4})?$/);
const day = z.iso.date();
const text = (max: number) => z.string().trim().min(1).max(max);
/** A row of Noon's transaction view, read in the browser (core `parseNoonTransactions`). */
const rowSchema = z.object({
  contract: text(200).nullable(),
  referenceNr: text(200),
  orderNr: text(200).nullable(),
  itemNr: text(200).nullable(),
  orderDate: day.nullable(),
  transactionDate: day,
  title: text(500).nullable(),
  sku: text(200).nullable(),
  partnerSku: text(200).nullable(),
  transactionType: text(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amounts: z.record(z.enum(NOON_AMOUNT_FIELDS), amount),
  total: amount,
  balanced: z.boolean(),
  key: text(1_500),
});
/** Rows per call: a year's file is sent in parts. */
const UPLOAD_ROWS = 1_000;
const uploadSchema = z.object({
  fileName: z.string().max(200),
  rows: z.array(rowSchema).min(1).max(UPLOAD_ROWS),
});

/**
 * Adds rows of Noon's transaction view from a file (seller portal → Finance → Transaction view),
 * read in the browser and sent in parts. Rows already in only get their amounts refreshed.
 */
export async function uploadNoonTransactionsAction(
  slug: string,
  input: z.input<typeof uploadSchema>,
): Promise<NoonResult<NoonImportResult>> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those rows couldn't be read." };
  const { rows, fileName } = parsed.data;
  const result = await inOrg(ctx, async (tx) => {
    const connection = await getNoonConnection(tx);
    const saved = await importNoonTransactions(tx, {
      orgId: ctx.org.id,
      rows,
      source: "upload",
      connectionId: connection && connection.status !== "disconnected" ? connection.id : null,
    });
    const dates = rows.map((r) => r.transactionDate).sort();
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "noon.transactions_uploaded",
      entityType: "organization",
      entityId: ctx.org.id,
      after: { fileName, from: dates[0], to: dates.at(-1), ...saved },
    });
    return saved;
  });
  revalidate(slug);
  return { ok: true, ...result };
}

// --- Posting to the books -----------------------------------------------------------------

function revalidateBooks(slug: string) {
  revalidate(slug);
  revalidatePath(`/o/${slug}/accounting`, "layout");
}

function postingError(error: unknown): string {
  if (error instanceof LedgerError) {
    if (error.code === "period_locked") {
      return "Your books are closed for that period. Ask an owner to reopen it, or leave this month out.";
    }
    return error.message;
  }
  throw error;
}

const setupSchema = z.object({
  accounts: z.record(
    z.enum(NOON_ACCOUNT_KEYS as [string, ...string[]]),
    z.uuid().or(z.literal("")),
  ),
  postFrom: z
    .string()
    .refine((v) => isIsoDate(v) && v.endsWith("-01"), "Choose the month posting starts."),
  autoPost: z.boolean().optional(),
});

/** Saves the account for each kind of Noon amount, the Noon balance account and the start month. */
export async function saveNoonSetupAction(
  slug: string,
  input: z.input<typeof setupSchema>,
): Promise<NoonResult> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the accounts and the month." };
  const accounts = Object.fromEntries(
    Object.entries(parsed.data.accounts).filter(([, v]) => v),
  ) as NoonAccounts;
  if (!accounts.balance) return { ok: false, message: "Choose the Noon balance account." };
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
    await saveNoonSetup(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      accounts,
      postFrom: parsed.data.postFrom,
      autoPost: parsed.data.autoPost ?? false,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "noon.accounts_updated",
      entityType: "noon_settings",
      after: { accounts, postFrom: parsed.data.postFrom, autoPost: parsed.data.autoPost ?? false },
    });
    return "ok";
  });
  if (saved === "balance") {
    return { ok: false, message: "The Noon balance account must be an asset (Money in transit)." };
  }
  if (saved === "same") {
    return {
      ok: false,
      message: "The Noon balance account can't also be used for another line. Choose another.",
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
 * Posts Noon months to the books: one, or (`all`) every finished month from the start month on
 * (and months changed since posted), each in its own transaction, oldest first.
 */
export async function postNoonMonthsAction(
  slug: string,
  input: z.input<typeof monthSchema> | { all: true },
): Promise<NoonResult<{ posted: number; failed: number; message: string | null }>> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  const today = nowIn(ctx.profile.timezone).date;
  const one = "all" in input ? null : monthSchema.safeParse(input);
  if (one && !one.success) return { ok: false, message: "Month not found." };
  const months = one?.success
    ? [{ ...one.data, currency: null as string | null }]
    : (await inOrg(ctx, (tx) => noonMonthsToPost(tx, today))).slice(0, 36);
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
        const entry = await postNoonMonth(tx, {
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
          action: entry.again ? "noon.month_reposted" : "noon.month_posted",
          entityType: "sales_channel",
          entityId: m.channelId,
          after: { month: m.month, journalEntryId: entry.id, earned: entry.earned },
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

/** Takes a Noon month out of the books (its entry is reversed). */
export async function unpostNoonMonthAction(
  slug: string,
  input: z.input<typeof monthSchema>,
): Promise<NoonResult> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  const parsed = monthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Month not found." };
  try {
    await inOrg(ctx, async (tx) => {
      await unpostNoonMonth(tx, { orgId: ctx.org.id, userId: ctx.session.user.id, ...parsed.data });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "noon.month_unposted",
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

const payoutSchema = z.object({ transactionId: z.uuid(), entryId: z.uuid() });

/** Matches a Noon payout to its bank deposit (moving the deposit to the Noon balance). */
export async function matchNoonPayoutAction(
  slug: string,
  input: z.input<typeof payoutSchema>,
): Promise<NoonResult> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Deposit not found." };
  try {
    await inOrg(ctx, async (tx) => {
      const matched = await matchNoonPayout(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        ...parsed.data,
        baseCurrency: ctx.profile.baseCurrency,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "noon.payout_matched",
        entityType: "noon_transaction",
        entityId: parsed.data.transactionId,
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
export async function unmatchNoonPayoutAction(
  slug: string,
  transactionId: string,
): Promise<NoonResult> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  if (!z.uuid().safeParse(transactionId).success) {
    return { ok: false, message: "Payout not found." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      const back = await unmatchNoonPayout(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        transactionId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "noon.payout_unmatched",
        entityType: "noon_transaction",
        entityId: transactionId,
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
export async function dismissNoonPayoutAction(
  slug: string,
  input: z.input<typeof payoutSchema>,
): Promise<NoonResult> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Deposit not found." };
  await inOrg(ctx, async (tx) => {
    await dismissNoonPayoutDeposit(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      ...parsed.data,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "noon.payout_deposit_dismissed",
      entityType: "noon_transaction",
      entityId: parsed.data.transactionId,
      after: { journalEntryId: parsed.data.entryId },
    });
  });
  revalidate(slug);
  return { ok: true };
}

/** Matches every payout that has exactly one deposit of its amount (up to 50 per click). */
export async function matchNoonPayoutsAction(
  slug: string,
): Promise<NoonResult<{ matched: number; failed: number; message: string | null }>> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  const found = await inOrg(ctx, (tx) => noonPayoutsWithOneDeposit(tx, 50));
  let matched = 0;
  let failed = 0;
  let message: string | null = null;
  for (const f of found) {
    try {
      await inOrg(ctx, async (tx) => {
        const done = await matchNoonPayout(tx, {
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
          transactionId: f.transactionId,
          entryId: f.deposit.entryId,
          baseCurrency: ctx.profile.baseCurrency,
        });
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "noon.payout_matched",
          entityType: "noon_transaction",
          entityId: f.transactionId,
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

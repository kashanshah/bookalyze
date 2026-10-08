"use server";

import { fiscalYearFor, isMoneyAccountSubtype } from "@bookalyze/core";
import {
  addBankFeed,
  applyAmountCorrections,
  createConnection,
  disconnectConnection,
  getConnection,
  importBankLines,
  recordFeedBalance,
  recordStatementUpload,
  schema,
  setConnectionSecret,
  statementFeedFor,
  VaultError,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate, nowIn } from "@/lib/dates";
import { getBankingContext, inOrg, listAccounts } from "@/server/accounting";
import { AmountFixError, type AmountFixPreview, previewAmountFix } from "@/server/amount-fix";
import { audit } from "@/server/audit";
import {
  ensureRates,
  type SyncSummary,
  sealConnectionSecret,
  syncConnection,
} from "@/server/banking";
import { fiscalConfigOf, isOrgAdmin } from "@/server/org";
import { WiseError, wiseBalances, wiseProfiles } from "@/server/wise";

export type Failure = { ok: false; message: string; errors?: Record<string, string> };

const tokenSchema = z
  .string()
  .trim()
  .min(20, "Paste the whole API token from Wise.")
  .max(200, "That doesn't look like a Wise API token.")
  .regex(/^[A-Za-z0-9-]+$/, "That doesn't look like a Wise API token.");

function fail(error: unknown): Failure {
  if (error instanceof WiseError || error instanceof VaultError) {
    return { ok: false, message: error.message };
  }
  throw error;
}

/** Connections need the encryption key; say so before asking anyone for a token. */
function vaultReady(): Failure | null {
  try {
    sealConnectionSecret("check", "check", "check");
    return null;
  } catch (error) {
    if (error instanceof VaultError) {
      return {
        ok: false,
        message:
          "Connections aren't set up on this server yet: APP_ENCRYPTION_KEY is missing or invalid. See docs/SETUP.md.",
      };
    }
    throw error;
  }
}

async function adminContext(slug: string) {
  const ctx = await getBankingContext(slug);
  if (!isOrgAdmin(ctx)) {
    return {
      ctx,
      denied: { ok: false, message: "Only owners and admins can manage connections." } as Failure,
    };
  }
  return { ctx, denied: null };
}

/** Step 1: check a token with Wise and list its profiles. Nothing is saved. */
export async function checkWiseTokenAction(
  slug: string,
  token: string,
): Promise<{ ok: true; profiles: { id: number; type: string; name: string }[] } | Failure> {
  const { denied } = await adminContext(slug);
  if (denied) return denied;
  const notReady = vaultReady();
  if (notReady) return notReady;
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the token.",
      errors: { token: parsed.error.issues[0]?.message ?? "" },
    };
  }
  try {
    const profiles = await wiseProfiles(parsed.data);
    if (!profiles.length) return { ok: false, message: "This Wise login has no profiles." };
    return { ok: true, profiles };
  } catch (error) {
    return fail(error);
  }
}

export type BalanceChoice = { id: number; currency: string; amount: string; name: string | null };

/** Step 2: the profile's balances, and accounts each could fill. Nothing is saved. */
export async function wiseBalancesAction(
  slug: string,
  token: string,
  profileId: number,
): Promise<
  | {
      ok: true;
      balances: BalanceChoice[];
      bankAccounts: { id: string; label: string; currency: string | null }[];
      feeAccounts: { id: string; label: string }[];
      defaultSyncFrom: string;
      defaultFeeAccountId: string | null;
    }
  | Failure
> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success || !Number.isInteger(profileId))
    return { ok: false, message: "Start again with your token." };
  try {
    const balances = await wiseBalances(parsed.data, profileId);
    const accounts = await inOrg(ctx, (tx) =>
      tx.select().from(schema.accounts).where(eq(schema.accounts.isArchived, false)),
    );
    const label = (a: { code: string | null; name: string }) =>
      a.code ? `${a.code} · ${a.name}` : a.name;
    const today = nowIn(ctx.profile.timezone).date;
    return {
      ok: true,
      balances,
      bankAccounts: accounts
        .filter((a) => a.subtype === "cash_bank")
        .map((a) => ({ id: a.id, label: label(a), currency: a.currency })),
      feeAccounts: accounts
        .filter((a) => a.type === "expense")
        .map((a) => ({ id: a.id, label: label(a) })),
      defaultSyncFrom: fiscalYearFor(today, fiscalConfigOf(ctx.profile)).start,
      defaultFeeAccountId:
        accounts.find((a) => a.systemKey === "uncategorized_expense")?.id ?? null,
    };
  } catch (error) {
    return fail(error);
  }
}

const connectSchema = z.object({
  token: tokenSchema,
  profileId: z.number().int().positive(),
  profileName: z.string().trim().min(1).max(200),
  syncFrom: z.string().refine(isIsoDate, "Choose the first day to bring in."),
  feeAccountId: z.string().uuid().nullable(),
  balances: z
    .array(
      z.object({
        id: z.number().int().positive(),
        /** "new" makes an account, "skip" leaves the balance out, otherwise an account ID. */
        target: z.union([z.literal("new"), z.literal("skip"), z.string().uuid()]),
      }),
    )
    .min(1),
});

/** Step 3: save the connection (token encrypted), the accounts and feeds, then sync. */
export async function connectWiseAction(
  slug: string,
  input: z.input<typeof connectSchema>,
): Promise<{ ok: true; summary: SyncSummary } | Failure> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message: issue?.message ?? "Check the details.",
      errors: { [String(issue?.path[0] ?? "form")]: issue?.message ?? "" },
    };
  }
  const value = parsed.data;
  const chosen = value.balances.filter((b) => b.target !== "skip");
  if (!chosen.length) return { ok: false, message: "Choose at least one balance to bring in." };

  // Ask Wise again rather than trusting the browser's list of balances.
  let live: BalanceChoice[];
  try {
    live = await wiseBalances(value.token, value.profileId);
  } catch (error) {
    return fail(error);
  }
  const userId = ctx.session.user.id;
  const connectionId = await inOrg(ctx, async (tx) => {
    const accounts = await tx.select().from(schema.accounts);
    const { id } = await createConnection(tx, {
      orgId: ctx.org.id,
      userId,
      provider: "wise",
      name: `Wise · ${value.profileName}`,
      settings: {
        profileId: value.profileId,
        profileName: value.profileName,
        feeAccountId: value.feeAccountId,
      },
    });
    await setConnectionSecret(tx, id, sealConnectionSecret(ctx.org.id, id, value.token));
    for (const choice of chosen) {
      const balance = live.find((b) => b.id === choice.id);
      if (!balance)
        throw new ConnectError("One of the balances is no longer in Wise. Start again.");
      let accountId: string;
      if (choice.target === "new") {
        const [created] = await tx
          .insert(schema.accounts)
          .values({
            organizationId: ctx.org.id,
            name: `Wise ${balance.currency}`,
            type: "asset",
            subtype: "cash_bank",
            currency: balance.currency,
            description: "Filled by the Wise connection.",
            createdBy: userId,
          })
          .returning({ id: schema.accounts.id });
        if (!created) throw new Error("Could not create the account");
        accountId = created.id;
      } else {
        const account = accounts.find((a) => a.id === choice.target);
        if (account?.subtype !== "cash_bank" || account.isArchived) {
          throw new ConnectError("Choose a bank account for each balance.");
        }
        if (account.currency && account.currency !== balance.currency) {
          throw new ConnectError(
            `${account.name} holds ${account.currency}, not ${balance.currency}.`,
          );
        }
        accountId = account.id;
      }
      await addBankFeed(tx, {
        orgId: ctx.org.id,
        connectionId: id,
        externalId: String(balance.id),
        currency: balance.currency,
        name: balance.name ?? `${balance.currency} balance`,
        accountId,
        syncFrom: value.syncFrom,
      });
    }
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: userId,
      action: "connection.create",
      entityType: "connection",
      entityId: id,
      after: {
        provider: "wise",
        profileId: value.profileId,
        feeds: chosen.length,
        syncFrom: value.syncFrom,
      },
    });
    return id;
  }).catch((error: unknown) => {
    if (error instanceof ConnectError || error instanceof VaultError)
      return { failure: error.message };
    throw error;
  });
  if (typeof connectionId !== "string") return { ok: false, message: connectionId.failure };

  const summary = await syncConnection({ orgId: ctx.org.id, userId }, connectionId);
  revalidatePath(`/o/${slug}`, "layout");
  return { ok: true, summary };
}

export async function syncConnectionAction(
  slug: string,
  connectionId: string,
): Promise<{ ok: true; summary: SyncSummary } | Failure> {
  const ctx = await getBankingContext(slug);
  if (!z.string().uuid().safeParse(connectionId).success)
    return { ok: false, message: "Unknown connection." };
  const summary = await syncConnection(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    connectionId,
  );
  revalidatePath(`/o/${slug}`, "layout");
  return { ok: true, summary };
}

export async function disconnectAction(
  slug: string,
  connectionId: string,
): Promise<{ ok: true } | Failure> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(connectionId).success)
    return { ok: false, message: "Unknown connection." };
  const done = await inOrg(ctx, async (tx) => {
    const connection = await getConnection(tx, connectionId);
    if (!connection) return false;
    await disconnectConnection(tx, connectionId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.disconnect",
      entityType: "connection",
      entityId: connectionId,
    });
    return true;
  });
  if (!done) return { ok: false, message: "This connection no longer exists." };
  revalidatePath(`/o/${slug}`, "layout");
  return { ok: true };
}

class ConnectError extends Error {}

const statementSchema = z.object({
  accountId: z.string().uuid(),
  settings: z.object({
    columns: z.record(z.string(), z.string().max(200)),
    dateOrder: z.enum(["ymd", "mdy", "dmy"]),
    positiveIs: z.enum(["in", "out"]),
    account: z
      .object({ fingerprint: z.string().regex(/^[0-9a-f]{16}$/), hint: z.string().max(12) })
      .optional(),
  }),
  lines: z
    .array(
      z.object({
        externalId: z.string().max(200),
        date: z.string().refine(isIsoDate, "Not a date."),
        amount: z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/, "Not an amount."),
        description: z.string().min(1).max(500),
        reference: z.string().max(120).nullable(),
      }),
    )
    .min(1)
    .max(500),
  /** The file's balance after its last transaction, when it has a balance column. */
  closingBalance: z
    .object({
      date: z.string().refine(isIsoDate, "Not a date."),
      amount: z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/, "Not an amount."),
    })
    .nullable()
    .optional(),
});
export type StatementUploadInput = z.infer<typeof statementSchema>;

/**
 * Brings in one part of a bank statement (up to 500 rows) for a money account. Rows already
 * brought in are recognised by their external ID and left alone; rows that look like a
 * transaction already in the books are flagged on the Transactions screen.
 */
export async function uploadStatementAction(
  slug: string,
  input: StatementUploadInput,
): Promise<{ ok: true; summary: SyncSummary } | Failure> {
  const ctx = await getBankingContext(slug);
  const parsed = statementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the file." };
  }
  const { accountId, settings, lines, closingBalance } = parsed.data;
  if (lines.some((l) => !l.externalId.startsWith(`csv:${accountId}:`))) {
    return { ok: false, message: "This file was read for a different account. Start again." };
  }
  const account = (await listAccounts(ctx)).find((a) => a.id === accountId);
  if (!account || account.isArchived || !isMoneyAccountSubtype(account.subtype)) {
    return { ok: false, message: "Pick a bank, card or cash account." };
  }
  const base = ctx.profile.baseCurrency;
  const currency = account.currency ?? base;
  await ensureRates(
    base,
    lines.map((l) => ({ currency, date: l.date })),
  );
  const summary = await inOrg(ctx, async (tx) => {
    const feed = await statementFeedFor(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      accountId,
      accountName: account.name,
      currency,
      firstDate: [...lines].map((l) => l.date).sort()[0] as string,
    });
    const result = await importBankLines(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      baseCurrency: base,
      // Uploading a statement again brings back transactions removed from it.
      restoreRemoved: true,
      lines: lines.map((l) => ({
        feedId: feed.feedId,
        externalId: l.externalId,
        date: l.date,
        currency,
        amount: l.amount,
        fee: "0.0000",
        description: l.description,
        counterparty: null,
        reference: l.reference,
        kind: l.amount.startsWith("-") ? "other" : "deposit",
      })),
    });
    await recordStatementUpload(tx, feed.connectionId, { statement: settings });
    if (closingBalance) {
      await recordFeedBalance(tx, feed.feedId, {
        amount: closingBalance.amount,
        on: closingBalance.date,
      });
    }
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "bank.statement_upload",
      entityType: "connection",
      entityId: feed.connectionId,
      after: {
        posted: result.posted,
        duplicates: result.duplicates,
        flagged: result.flagged,
        categorized: result.categorized,
        skipped: result.skipped.length,
      },
    });
    return result;
  });
  revalidatePath(`/o/${slug}`, "layout");
  return { ok: true, summary: { ...summary, error: null } };
}

/** Reads the account's Wise statement and matches each misrecorded line to it. Nothing changes. */
/** Statement rows the person added (read from their PDF statements in the browser). */
const statementRowsSchema = z
  .array(
    z.object({
      externalId: z.string().max(200),
      date: z.string().refine(isIsoDate, "Not a date."),
      amount: z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/, "Not an amount."),
      text: z.string().max(500),
    }),
  )
  .min(1, "Add at least one statement.")
  .max(10_000, "That's a lot of statements: add a year or two at a time.");

/**
 * Matches the account's misrecorded lines to their real transactions: on Wise, or on statements
 * the person added (`statement`). Nothing is changed yet.
 */
export async function previewAmountFixAction(
  slug: string,
  accountId: string,
  statement?: z.input<typeof statementRowsSchema>,
): Promise<{ ok: true; preview: AmountFixPreview } | Failure> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(accountId).success) {
    return { ok: false, message: "Unknown account." };
  }
  const rows = statement === undefined ? null : statementRowsSchema.safeParse(statement);
  if (rows && !rows.success) {
    return { ok: false, message: rows.error.issues[0]?.message ?? "Check the statements." };
  }
  try {
    const source = rows?.success
      ? ({ kind: "statement", lines: rows.data } as const)
      : ({ kind: "wise" } as const);
    return { ok: true, preview: await previewAmountFix(ctx, accountId, source) };
  } catch (error) {
    if (error instanceof AmountFixError || error instanceof VaultError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

const correctionSchema = z.object({
  lineId: z.string().uuid(),
  amount: z
    .string()
    .trim()
    .regex(/^-?\d{1,15}(\.\d{1,4})?$/, "Enter an amount like 123.45."),
  statement: z
    .object({
      feedId: z.string().uuid(),
      externalId: z.string().min(1).max(200),
      date: z.string().refine(isIsoDate),
      description: z.string().max(500),
    })
    .nullable()
    .optional(),
});

/**
 * Re-records a batch of lines in the account's currency (the page sends them 100 at a time).
 * Their main-currency value stays as it was.
 */
export async function applyAmountFixAction(
  slug: string,
  accountId: string,
  corrections: z.input<typeof correctionSchema>[],
): Promise<
  { ok: true; corrected: number; skipped: { lineId: string; reason: string }[] } | Failure
> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = z.array(correctionSchema).min(1).max(100).safeParse(corrections);
  if (!parsed.success || !z.string().uuid().safeParse(accountId).success) {
    return { ok: false, message: "Something went wrong. Open the screen again." };
  }
  const result = await inOrg(ctx, async (tx) => {
    const done = await applyAmountCorrections(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      accountId,
      corrections: parsed.data,
    });
    if (done.corrected) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "account.amounts_corrected",
        entityType: "account",
        entityId: accountId,
        after: { corrected: done.corrected, skipped: done.skipped.length },
      });
    }
    return done;
  });
  revalidatePath(`/o/${slug}/accounting`, "layout");
  revalidatePath(`/o/${slug}/banking`, "layout");
  return { ok: true, ...result };
}

"use server";

import { fiscalYearFor } from "@bookalyze/core";
import {
  addBankFeed,
  createConnection,
  disconnectConnection,
  getConnection,
  schema,
  setConnectionSecret,
  VaultError,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate, nowIn } from "@/lib/dates";
import { getBankingContext, inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { type SyncSummary, sealConnectionSecret, syncConnection } from "@/server/banking";
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

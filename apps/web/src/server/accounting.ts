import "server-only";
import { ACCOUNT_TYPES, type AccountType, can, type LedgerAccount } from "@bookalyze/core";
import { getDb, schema, type Transaction, withOrg } from "@bookalyze/db";
import { asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getOrgContext, type OrgContext, type OrgProfile } from "./org";

export type AccountingContext = OrgContext & { profile: OrgProfile };
export type AccountRow = typeof schema.accounts.$inferSelect;

/**
 * The org context for accounting pages and actions. 404s unless the Accounting module is active
 * and the company profile (base currency, financial year) exists.
 */
export async function getAccountingContext(slug: string): Promise<AccountingContext> {
  const ctx = await getOrgContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "accounting.core") || !ctx.profile) notFound();
  return ctx as AccountingContext;
}

/** Runs `fn` scoped to the organization, as the signed-in user. */
export function inOrg<T>(ctx: OrgContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withOrg(getDb(), { orgId: ctx.org.id, userId: ctx.session.user.id }, fn);
}

export async function listAccounts(ctx: OrgContext): Promise<AccountRow[]> {
  return inOrg(ctx, (tx) =>
    tx.select().from(schema.accounts).orderBy(asc(schema.accounts.code), asc(schema.accounts.name)),
  );
}

export function toLedgerMap(accounts: AccountRow[]): Map<string, LedgerAccount> {
  return new Map(
    accounts.map((a) => [
      a.id,
      { id: a.id, name: a.name, currency: a.currency, isArchived: a.isArchived },
    ]),
  );
}

export type AccountOption = {
  id: string;
  label: string;
  type: AccountType;
  currency: string | null;
};

/** Active accounts grouped by type, for account pickers. */
export function accountOptions(
  accounts: AccountRow[],
): { type: AccountType; options: AccountOption[] }[] {
  return ACCOUNT_TYPES.map((type) => ({
    type,
    options: accounts
      .filter((a) => a.type === type && !a.isArchived)
      .map((a) => ({
        id: a.id,
        label: a.code ? `${a.code} · ${a.name}` : a.name,
        type,
        currency: a.currency,
      })),
  })).filter((g) => g.options.length > 0);
}

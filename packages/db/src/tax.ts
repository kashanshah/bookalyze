import type { SalesTaxRow, TaxPack, TaxPackRate } from "@bookalyze/core";
import { and, asc, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { accounts, journalEntries, journalLines } from "./schema/accounting";
import { taxRates, taxRegistrations } from "./schema/tax";

/** Sales tax setup and the sales tax report's totals. Run inside `withOrg()`. */

export type TaxRateRow = typeof taxRates.$inferSelect & {
  accountName: string;
  /** Used by at least one posted line: the percentage, account and recoverability are fixed. */
  inUse: boolean;
};

export async function listTaxRates(
  tx: Transaction,
  options: { includeArchived?: boolean } = {},
): Promise<TaxRateRow[]> {
  const rows = await tx
    .select({
      rate: taxRates,
      accountName: accounts.name,
      inUse: sql<boolean>`exists (select 1 from ${journalLines} l where l.tax_rate_id = ${taxRates.id})`,
    })
    .from(taxRates)
    .innerJoin(accounts, eq(accounts.id, taxRates.accountId))
    .where(options.includeArchived ? undefined : eq(taxRates.isArchived, false))
    .orderBy(asc(taxRates.isArchived), desc(taxRates.rate), asc(taxRates.name));
  return rows.map((r) => ({ ...r.rate, accountName: r.accountName, inUse: Boolean(r.inUse) }));
}

export async function listTaxRegistrations(tx: Transaction) {
  return tx
    .select()
    .from(taxRegistrations)
    .orderBy(asc(taxRegistrations.isActive), asc(taxRegistrations.createdAt));
}

/**
 * Sets up a country pack: creates its tax accounts (or reuses a sales tax account with the same
 * name) and the chosen rates, skipping rates whose name already exists. Returns how many rates
 * were added.
 */
export async function applyTaxPack(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; pack: TaxPack; rates: TaxPackRate[] },
): Promise<{ added: number; accountIds: Record<string, string> }> {
  const existing = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      code: accounts.code,
      subtype: accounts.subtype,
    })
    .from(accounts);
  const usedCodes = new Set(existing.map((a) => a.code).filter(Boolean));
  const accountIds: Record<string, string> = {};
  const needed = new Set(input.rates.map((r) => r.account));
  for (const packAccount of input.pack.accounts) {
    if (!needed.has(packAccount.key)) continue;
    const match = existing.find(
      (a) => a.subtype === "sales_tax" && a.name.toLowerCase() === packAccount.name.toLowerCase(),
    );
    if (match) {
      accountIds[packAccount.key] = match.id;
      continue;
    }
    const [created] = await tx
      .insert(accounts)
      .values({
        organizationId: input.orgId,
        code: usedCodes.has(packAccount.code) ? null : packAccount.code,
        name: packAccount.name,
        type: "liability",
        subtype: "sales_tax",
        description: "Sales tax collected, less tax paid that can be claimed back.",
        createdBy: input.userId ?? null,
      })
      .returning({ id: accounts.id });
    if (!created) throw new Error("Could not create the tax account");
    usedCodes.add(packAccount.code);
    accountIds[packAccount.key] = created.id;
  }

  const names = new Set(
    (await tx.select({ name: taxRates.name }).from(taxRates)).map((r) => r.name.toLowerCase()),
  );
  const rows = input.rates
    .filter((r) => !names.has(r.name.toLowerCase()))
    .map((r) => ({
      organizationId: input.orgId,
      name: r.name,
      rate: r.rate,
      accountId: accountIds[r.account] as string,
      isRecoverable: r.isRecoverable,
      createdBy: input.userId ?? null,
    }));
  if (rows.length) await tx.insert(taxRates).values(rows);
  return { added: rows.length, accountIds };
}

/**
 * Per-rate base-currency totals for entries dated within [from, to], for the sales tax report.
 * A taxed line on the rate's account is tax; any other taxed line is what the tax was charged on.
 * Credits are sales (and tax collected), debits purchases (and tax paid). Reversals count with
 * the sign of the entry they undo, so an edited or deleted transaction nets to nothing.
 */
export async function salesTaxRows(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<SalesTaxRow[]> {
  // +1 for ordinary entries, -1 for reversals (classify a reversal line like the line it undoes).
  const sign = sql`(case when ${journalEntries.reversesEntryId} is null then 1 else -1 end)`;
  const base = journalLines.baseAmount;
  const isTax = sql`${journalLines.accountId} = ${taxRates.accountId}`;
  const total = (condition: SQL, value: SQL) =>
    sql<string>`coalesce(sum(case when ${condition} then ${value} end), 0)::numeric(20,4)::text`;
  const conditions: SQL[] = [
    gte(journalEntries.date, range.from),
    lte(journalEntries.date, range.to),
  ];
  const rows = await tx
    .select({
      taxRateId: taxRates.id,
      name: taxRates.name,
      rate: taxRates.rate,
      isRecoverable: taxRates.isRecoverable,
      sales: total(sql`not ${isTax} and ${sign} * ${base} < 0`, sql`-${base}`),
      taxCollected: total(sql`${isTax} and ${sign} * ${base} < 0`, sql`-${base}`),
      purchases: total(sql`not ${isTax} and ${sign} * ${base} > 0`, sql`${base}`),
      taxPaid: total(sql`${isTax} and ${sign} * ${base} > 0`, sql`${base}`),
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .innerJoin(taxRates, eq(taxRates.id, journalLines.taxRateId))
    .where(and(...conditions))
    .groupBy(taxRates.id)
    .orderBy(asc(taxRates.rate), asc(taxRates.name));
  return rows;
}

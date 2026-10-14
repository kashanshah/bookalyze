import { and, asc, eq, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { accounts, journalEntries, journalLines } from "./schema/accounting";
import { channelCostAccounts, salesChannels } from "./schema/commerce";
import { cogsPeriods } from "./schema/inventory";

/**
 * Channel profit's costs from the books (run inside `withOrg()`): the expense categories a person
 * counted against a channel (or as shared), and cost of goods sold by marketplace.
 */

/** System accounts the report already counts another way (cost of goods sold, write-offs). */
const COUNTED_ELSEWHERE = ["cost_of_goods_sold", "inventory_write_offs"];
/** Entries the marketplace's own rows already count (settlements, Noon, eBay) or the COGS row. */
const MARKETPLACE_SOURCES = ["settlement", "noon", "ebay", "cogs"];

export type CostCategory = {
  accountId: string;
  label: string;
  /** The channel it counts against; null: shared (All channels only); undefined: not counted. */
  channelId: string | null | undefined;
};

/** The expense categories that can be counted, with the channel each counts against (if any). */
export async function channelCostCategories(tx: Transaction): Promise<CostCategory[]> {
  const rows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      chosen: channelCostAccounts.accountId,
      channelId: channelCostAccounts.channelId,
    })
    .from(accounts)
    .leftJoin(channelCostAccounts, eq(channelCostAccounts.accountId, accounts.id))
    .where(
      and(
        eq(accounts.type, "expense"),
        eq(accounts.isArchived, false),
        sql`coalesce(${accounts.systemKey}, '') not in ${COUNTED_ELSEWHERE}`,
      ),
    )
    .orderBy(asc(accounts.code), asc(accounts.name));
  return rows.map((r) => ({
    accountId: r.accountId,
    label: r.code ? `${r.code} · ${r.name}` : r.name,
    channelId: r.chosen ? r.channelId : undefined,
  }));
}

/** Saves which categories count, and against which channel (null: shared). Others are cleared. */
export async function saveChannelCostAccounts(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    choices: readonly { accountId: string; channelId: string | null }[];
  },
) {
  await tx.delete(channelCostAccounts);
  if (!input.choices.length) return;
  await tx.insert(channelCostAccounts).values(
    input.choices.map((c) => ({
      organizationId: input.orgId,
      accountId: c.accountId,
      channelId: c.channelId,
      updatedBy: input.userId,
    })),
  );
}

export type ChannelCost = {
  channelId: string | null;
  accountId: string;
  label: string;
  /** Spent in the period, in the main currency (refunds of it make it smaller). */
  base: string;
};

/**
 * What each counted category cost in `from`…`to` (entry dates), in the main currency. Entries
 * the report counts already (settlements, Noon, eBay, cost of goods sold) are left out, so an
 * advertising account used by a settlement isn't counted twice.
 */
export async function channelCostsForProfit(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<ChannelCost[]> {
  const rows = await tx
    .select({
      channelId: channelCostAccounts.channelId,
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      base: sql<string>`sum(${journalLines.baseAmount})::text`,
    })
    .from(channelCostAccounts)
    .innerJoin(accounts, eq(accounts.id, channelCostAccounts.accountId))
    .innerJoin(journalLines, eq(journalLines.accountId, accounts.id))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(
      and(
        sql`${journalEntries.date} between ${range.from}::date and ${range.to}::date`,
        sql`${journalEntries.source} not in ${MARKETPLACE_SOURCES}`,
      ),
    )
    .groupBy(channelCostAccounts.channelId, accounts.id, accounts.code, accounts.name)
    .orderBy(asc(accounts.code), asc(accounts.name));
  return rows
    .filter((r) => r.base !== null)
    .map((r) => ({
      channelId: r.channelId,
      accountId: r.accountId,
      label: r.code ? `${r.code} · ${r.name}` : r.name,
      base: r.base,
    }));
}

export type ChannelCogs = {
  channelId: string;
  month: string;
  /** In the main currency: products shipped less those returned. */
  cogs: string;
  /** Lost, damaged or disposed less found. */
  writeOffs: string;
};

/** Cost of goods sold posted for months whose last day is in `from`…`to`, by marketplace. */
export async function cogsForProfit(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<ChannelCogs[]> {
  const rows = await tx
    .select({
      channelId: cogsPeriods.channelId,
      month: cogsPeriods.month,
      cogs: sql<string>`(${cogsPeriods.cost} - ${cogsPeriods.returnedCost})::text`,
      writeOffs: sql<string>`(${cogsPeriods.lostCost} - ${cogsPeriods.foundCost})::text`,
    })
    .from(cogsPeriods)
    .innerJoin(salesChannels, eq(salesChannels.id, cogsPeriods.channelId))
    .where(
      sql`(to_date(${cogsPeriods.month} || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
        between ${range.from}::date and ${range.to}::date`,
    )
    .orderBy(asc(cogsPeriods.month));
  return rows;
}

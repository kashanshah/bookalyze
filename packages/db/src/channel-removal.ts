import { sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { journalEntries } from "./schema/accounting";
import {
  ebayPeriods,
  noonPeriods,
  noonTransactions,
  salesChannels,
  settlements,
} from "./schema/commerce";
import { cogsPeriods } from "./schema/inventory";

/**
 * Removing a channel: for one added by mistake (a Noon country or an eBay site on the wrong
 * company), so what was brought in for it stops counting anywhere. Everything brought in for it
 * goes with it (orders, Noon and eBay transactions, ledger movements, SKU links, prices). Only
 * while nothing of it is in the books: Amazon settlements, posted cost of goods sold months,
 * Noon or eBay months whose entry still stands, Noon payouts matched to a deposit. Those are
 * taken out first, on their own pages. Amazon marketplaces come from their account and aren't
 * removed (switching one off is the way).
 */

export type ChannelRemovalBlocker =
  | { kind: "settlements"; count: number }
  | { kind: "cogs"; count: number }
  | { kind: "noon_months"; count: number }
  | { kind: "ebay_months"; count: number }
  | { kind: "noon_payouts"; count: number };

export class ChannelRemovalError extends Error {}

const standing = (column: unknown) =>
  sql`exists (select 1 from ${journalEntries} je
    where je.id = ${column} and je.reversed_by_entry_id is null)`;

/** What keeps a channel from being removed; empty when it can go. */
export async function channelRemovalBlockers(
  tx: Transaction,
  channelId: string,
): Promise<ChannelRemovalBlocker[]> {
  const count = async (query: ReturnType<typeof sql>) => {
    const result = await tx.execute<{ n: number }>(query);
    return Number(result.rows[0]?.n ?? 0);
  };
  const found: ChannelRemovalBlocker[] = [
    {
      kind: "settlements",
      count: await count(
        sql`select count(*)::int as n from ${settlements} where ${settlements.channelId} = ${channelId}`,
      ),
    },
    {
      kind: "cogs",
      count: await count(
        sql`select count(*)::int as n from ${cogsPeriods} where ${cogsPeriods.channelId} = ${channelId}`,
      ),
    },
    {
      kind: "noon_months",
      count: await count(
        sql`select count(*)::int as n from ${noonPeriods}
          where ${noonPeriods.channelId} = ${channelId} and ${standing(noonPeriods.journalEntryId)}`,
      ),
    },
    {
      kind: "ebay_months",
      count: await count(
        sql`select count(*)::int as n from ${ebayPeriods}
          where ${ebayPeriods.channelId} = ${channelId} and ${standing(ebayPeriods.journalEntryId)}`,
      ),
    },
    {
      kind: "noon_payouts",
      count: await count(
        sql`select count(*)::int as n from ${noonTransactions}
          where ${noonTransactions.channelId} = ${channelId}
            and ${standing(noonTransactions.depositEntryId)}`,
      ),
    },
  ];
  return found.filter((b) => b.count > 0);
}

/**
 * Removes a Noon or eBay channel and everything brought in for it. Refuses an Amazon
 * marketplace, and any channel with something in the books (`channelRemovalBlockers`).
 */
export async function removeChannel(
  tx: Transaction,
  channelId: string,
): Promise<{ id: string; name: string; kind: string }> {
  const [channel] = await tx
    .select({ id: salesChannels.id, name: salesChannels.name, kind: salesChannels.kind })
    .from(salesChannels)
    .where(sql`${salesChannels.id} = ${channelId}`)
    .for("update");
  if (!channel) throw new ChannelRemovalError("This channel no longer exists.");
  if (channel.kind === "amazon") {
    throw new ChannelRemovalError(
      "Amazon marketplaces come from their account: switch this one off instead.",
    );
  }
  const blockers = await channelRemovalBlockers(tx, channelId);
  if (blockers.length) {
    throw new ChannelRemovalError(
      `${channel.name} still has ${describeBlockers(blockers)} in your books. Take ${blockers.length > 1 ? "them" : "it"} out first.`,
    );
  }
  // Noon and eBay months that were taken out of the books keep their reversed entries; the
  // month rows themselves go with the channel (cascade), like its transactions and orders.
  await tx.delete(salesChannels).where(sql`${salesChannels.id} = ${channelId}`);
  return channel;
}

const BLOCKER_LABELS: Record<ChannelRemovalBlocker["kind"], [string, string]> = {
  settlements: ["Amazon settlement", "Amazon settlements"],
  cogs: ["posted cost of goods sold month", "posted cost of goods sold months"],
  noon_months: ["posted Noon month", "posted Noon months"],
  ebay_months: ["posted eBay month", "posted eBay months"],
  noon_payouts: ["Noon payout matched to a deposit", "Noon payouts matched to deposits"],
};

/** "2 posted Noon months and 1 Amazon settlement", for messages. */
export function describeBlockers(blockers: readonly ChannelRemovalBlocker[]): string {
  const parts = blockers.map((b) => {
    const [one, many] = BLOCKER_LABELS[b.kind];
    return `${b.count} ${b.count === 1 ? one : many}`;
  });
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

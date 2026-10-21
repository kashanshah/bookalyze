import "server-only";
import {
  addSettlementLines,
  ebayProfitTotals,
  emptyGroupTotals,
  type GroupTotals,
  noonProfitTotals,
  walmartProfitTotals,
} from "@bookalyze/core";
import {
  ebayMonths,
  noonMonthsForProfit,
  settlementsForProfit,
  type Transaction,
  walmartPostingList,
} from "@bookalyze/db";

/**
 * Each channel's money in a period, in its own currency, summed the way Channel profit sums it:
 * Amazon's and Walmart's settlements by the day they end, Noon's and eBay's rows by month. Keyed
 * by channel; settlements with no channel are left out (they can't be split by product).
 */
export async function channelTotals(
  tx: Transaction,
  input: { from: string; to: string; timezone: string },
): Promise<Map<string, { currency: string; totals: GroupTotals }>> {
  const out = new Map<string, { currency: string; totals: GroupTotals }>();
  const of = (channelId: string, currency: string) => {
    const found = out.get(channelId);
    if (found) return found.totals;
    const totals = emptyGroupTotals();
    out.set(channelId, { currency, totals });
    return totals;
  };
  for (const s of await settlementsForProfit(tx, input)) {
    if (!s.channelId) continue;
    addSettlementLines(of(s.channelId, s.currency), s.lines);
  }
  for (const m of await noonMonthsForProfit(tx, { from: input.from, to: input.to })) {
    noonProfitTotals(m.sums, undefined, of(m.channelId, m.currency));
  }
  for (const m of await ebayMonths(tx, { from: input.from, to: input.to })) {
    ebayProfitTotals(m.sums, undefined, of(m.channelId, m.currency));
  }
  for (const s of await walmartPostingList(tx)) {
    if (!s.totals || s.date < input.from || s.date > input.to) continue;
    walmartProfitTotals(s.totals.groups, undefined, of(s.channelId, s.currency));
  }
  return out;
}

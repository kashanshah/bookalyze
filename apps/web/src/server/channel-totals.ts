import "server-only";
import {
  addSettlementLines,
  ebayProfitTotals,
  emptyGroupTotals,
  type GroupTotals,
  noonProfitTotals,
  type SettlementLine,
  settlementLineOnOrder,
  walmartProfitTotals,
} from "@bookalyze/core";
import {
  ebayMonths,
  noonMonthsForProfit,
  settlementsForProfit,
  type Transaction,
  walmartPostingList,
} from "@bookalyze/db";

/** A channel's money in a period, in its own currency. */
export type ChannelTotals = {
  currency: string;
  /** Everything, the way Channel profit sums it. */
  totals: GroupTotals;
  /**
   * The amounts on orders only (sales, refunds, their fees and promotions): Amazon's settlement
   * lines on orders. Noon's, eBay's and Walmart's sums aren't split, so all of theirs.
   */
  orderTotals: GroupTotals;
  /** Amazon's settlement lines not on an order: storage, the selling plan, Vine and the like. */
  accountLines: Pick<
    SettlementLine,
    "transactionType" | "amountType" | "amountDescription" | "amount"
  >[];
  /** The last day (company time zone) its settlements cover, when they're Amazon's. */
  settledThrough: string | null;
};

/**
 * Each channel's money in a period, in its own currency, summed the way Channel profit sums it:
 * Amazon's and Walmart's settlements by the day they end, Noon's and eBay's rows by month. Keyed
 * by channel; settlements with no channel are left out (they can't be split by product).
 */
export async function channelTotals(
  tx: Transaction,
  input: { from: string; to: string; timezone: string },
): Promise<Map<string, ChannelTotals>> {
  const out = new Map<string, ChannelTotals>();
  const of = (channelId: string, currency: string) => {
    const found = out.get(channelId);
    if (found) return found;
    const made: ChannelTotals = {
      currency,
      totals: emptyGroupTotals(),
      orderTotals: emptyGroupTotals(),
      accountLines: [],
      settledThrough: null,
    };
    out.set(channelId, made);
    return made;
  };
  /** Sums split by no line: all on orders. */
  const both = (c: ChannelTotals, add: (into: GroupTotals) => void) => {
    add(c.totals);
    add(c.orderTotals);
  };
  for (const s of await settlementsForProfit(tx, input)) {
    if (!s.channelId) continue;
    const c = of(s.channelId, s.currency);
    addSettlementLines(c.totals, s.lines);
    addSettlementLines(c.orderTotals, s.lines.filter(settlementLineOnOrder));
    c.accountLines.push(...s.lines.filter((l) => !settlementLineOnOrder(l)));
    const end = dayIn(s.endAt, input.timezone);
    if (!c.settledThrough || end > c.settledThrough) c.settledThrough = end;
  }
  for (const m of await noonMonthsForProfit(tx, { from: input.from, to: input.to })) {
    both(of(m.channelId, m.currency), (into) => noonProfitTotals(m.sums, undefined, into));
  }
  for (const m of await ebayMonths(tx, { from: input.from, to: input.to })) {
    both(of(m.channelId, m.currency), (into) => ebayProfitTotals(m.sums, undefined, into));
  }
  for (const s of await walmartPostingList(tx)) {
    if (!s.totals || s.date < input.from || s.date > input.to) continue;
    const groups = s.totals.groups;
    both(of(s.channelId, s.currency), (into) => walmartProfitTotals(groups, undefined, into));
  }
  return out;
}

/** An instant's day (YYYY-MM-DD) in `timezone`. */
function dayIn(at: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

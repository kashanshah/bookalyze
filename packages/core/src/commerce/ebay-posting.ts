import { formatDecimal } from "../money";
import { EBAY_GROUPS, type EbayGroup, type EbaySum, ebayGroupTotals } from "./ebay-finances";
import type { SettlementEntryLine } from "./settlements";

/**
 * How eBay's money goes into the books (phase 4d, slice 5). eBay keeps a balance for the seller:
 * every row adds to it or takes from it, and a payout is eBay paying the balance to the bank. So
 * each eBay site's month posts as one entry (sales, fees, refunds, advertising, shipping labels…,
 * the net to an "eBay balance" asset), and each payout is matched to its bank deposit, which
 * moves it out of the eBay balance. Same shape as Noon's.
 */

export const EBAY_POSTING_GROUP_KEYS = Object.keys(EBAY_GROUPS) as EbayGroup[];
export type EbayAccountKey = EbayGroup | "balance";
export const EBAY_ACCOUNT_KEYS = [...EBAY_POSTING_GROUP_KEYS, "balance"] as EbayAccountKey[];
export type EbayAccounts = Partial<Record<EbayAccountKey, string>>;

export const EBAY_ACCOUNT_LABELS: Record<EbayAccountKey, string> = {
  ...EBAY_GROUPS,
  transfers: "Money moved in or out of your eBay balance",
  balance: "eBay balance (what eBay holds for you)",
};

export const EBAY_ACCOUNT_HINTS: Record<EbayAccountKey, string> = {
  sales: "What buyers paid for your items and shipping, before eBay's fees. An income account.",
  refunds: "Refunds and disputes you lost. Left empty, they go to the sales account.",
  fees: "Final value and other selling fees, less fees eBay gave back. An expense account.",
  advertising: "Promoted Listings and other ad fees. Left empty, they go with the fees.",
  shipping: "Shipping labels bought through eBay. Left empty, they go with the fees.",
  credits:
    "Credits eBay gave you (fee credits, goodwill). Left empty, they go to the sales account.",
  other: "Anything else on your eBay balance. Left empty, it goes with the fees.",
  transfers:
    "Money eBay took from or sent to your bank outside a payout (say, to cover a negative balance). Usually the bank account it came from.",
  balance:
    "What eBay owes you until it pays out. An asset; each payout matched to its bank deposit takes it back out.",
};

/** Where a group goes when it has no account of its own. */
const FALLBACK: Partial<Record<EbayGroup, EbayGroup>> = {
  refunds: "sales",
  advertising: "fees",
  shipping: "fees",
  credits: "sales",
  other: "fees",
};

/** What a month's rows did to the eBay balance: every group, money moved included. */
export function ebayMonthNet(sums: readonly EbaySum[]): string {
  const { groups } = ebayGroupTotals(sums);
  return formatDecimal(EBAY_POSTING_GROUP_KEYS.reduce((t, g) => t + groups[g], 0n));
}

/**
 * A month's entry: each group to its account (money to the seller credits it), the net to the
 * eBay balance. Lines for the same account are combined. Errors in plain words.
 */
export function buildEbayEntry(input: {
  sums: readonly EbaySum[];
  accounts: EbayAccounts;
}): { ok: true; lines: SettlementEntryLine[]; net: string } | { ok: false; error: string } {
  const balance = input.accounts.balance;
  if (!balance) return { ok: false, error: "Choose the eBay balance account first." };
  const { groups } = ebayGroupTotals(input.sums);
  const byAccount = new Map<string, { units: bigint; labels: string[] }>();
  const add = (accountId: string, units: bigint, label: string) => {
    const a = byAccount.get(accountId) ?? { units: 0n, labels: [] };
    a.units += units;
    if (!a.labels.includes(label)) a.labels.push(label);
    byAccount.set(accountId, a);
  };
  let net = 0n;
  for (const group of EBAY_POSTING_GROUP_KEYS) {
    const units = groups[group];
    if (units === 0n) continue;
    const fallback = FALLBACK[group];
    const account = input.accounts[group] ?? (fallback ? input.accounts[fallback] : undefined);
    if (!account) {
      return { ok: false, error: `Choose an account for “${EBAY_ACCOUNT_LABELS[group]}”.` };
    }
    if (account === balance) {
      return {
        ok: false,
        error: `“${EBAY_ACCOUNT_LABELS[group]}” can't go to the eBay balance account itself. Choose another account.`,
      };
    }
    add(account, -units, EBAY_GROUPS[group]);
    net += units;
  }
  add(balance, net, "eBay balance");
  const lines = [...byAccount.entries()]
    .filter(([, a]) => a.units !== 0n)
    .map(([accountId, a]) => ({
      accountId,
      amount: formatDecimal(a.units),
      description: a.labels.join(", "),
    }));
  if (!lines.length) return { ok: false, error: "This month has nothing to post." };
  return { ok: true, lines, net: formatDecimal(net) };
}

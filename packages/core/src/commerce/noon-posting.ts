import { formatDecimal, parseDecimal } from "../money";
import { NOON_AMOUNT_FIELDS, type NoonAmountField } from "./noon-transactions";
import { emptyGroupTotals, type GroupTotals, type SettlementEntryLine } from "./settlements";

/**
 * How Noon's transaction view goes into the books (phase 4c, slice 4). Noon keeps a balance for
 * the seller: every row adds to it or takes from it, and a "payment" row is Noon paying the
 * balance out to the bank. So each country's month posts as one entry (sales, fees, advertising,
 * subsidies…, the net to a "Noon balance" asset), and each payment is matched to its bank
 * deposit, which moves it out of the Noon balance. Noon's own words for the row types:
 *
 * - Order: initial charge applied to an order.
 * - Order Update: order adjusted after a return or change.
 * - Statement Fee: fee not tied to an order (advertising, for Kazomo: its Title says so).
 * - Payment: net amount disbursed to the seller's bank account.
 * - Balance Transfer: balance moved between contracts.
 */

/** What a month's amounts are, in the order the page and the entry show them. */
export const NOON_POSTING_GROUPS = {
  sales: "Sales",
  refunds: "Returns and order changes",
  fees: "Noon's fees",
  advertising: "Advertising",
  shippingCredits: "Shipping credits",
  subsidies: "Noon's subsidies",
  transfers: "Moved to another Noon contract",
  other: "Other",
} as const;
export type NoonPostingGroup = keyof typeof NOON_POSTING_GROUPS;
export const NOON_POSTING_GROUP_KEYS = Object.keys(NOON_POSTING_GROUPS) as NoonPostingGroup[];

export const NOON_ACCOUNT_KEYS = [...NOON_POSTING_GROUP_KEYS, "balance"] as Array<
  NoonPostingGroup | "balance"
>;
export type NoonAccountKey = NoonPostingGroup | "balance";
export type NoonAccounts = Partial<Record<NoonAccountKey, string>>;

export const NOON_ACCOUNT_LABELS: Record<NoonAccountKey, string> = {
  ...NOON_POSTING_GROUPS,
  balance: "Noon balance (what Noon holds for you)",
};

export const NOON_ACCOUNT_HINTS: Record<NoonAccountKey, string> = {
  sales: "What buyers paid for your items (Noon's net proceeds). An income account.",
  refunds:
    "Returns and changes to orders after the sale. Left empty, they go to the sales account.",
  fees: "Referral, fulfilment and logistics fees, VAT included. An expense account.",
  advertising:
    "Noon's advertising charges, after any advertising subsidy (statement fees whose details say advertising). Left empty, they go with the fees.",
  shippingCredits: "Shipping buyers paid. Left empty, it goes to the sales account.",
  subsidies: "What Noon pays toward your orders (promotions it funds). Usually income.",
  transfers:
    "Balance Noon moved to another of your contracts. Until you know what it paid for there, an expense account for Noon's other charges works.",
  other: "Anything else on an order row. Left empty, it goes with the fees.",
  balance:
    "What Noon owes you until it pays out. An asset; each payout matched to its bank deposit takes it back out, so it ends at what Noon shows as owed.",
};

/** Where a group goes when it has no account of its own. */
const FALLBACK: Partial<Record<NoonPostingGroup, NoonPostingGroup>> = {
  refunds: "sales",
  shippingCredits: "sales",
  advertising: "fees",
  other: "fees",
};

/** Noon's type names as the export ("order_update") or the seller portal ("Order Update") has them. */
export function noonTypeKey(type: string): string {
  return type
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const NOON_PAYOUT_TYPE = "payment";
/** Statement fees whose details (title) match this are advertising. */
export const NOON_ADVERTISING_PATTERN = "advertis";

export const isNoonPayout = (type: string) => noonTypeKey(type) === NOON_PAYOUT_TYPE;

/** Rows of one kind summed (or one row): what the grouping reads. */
export type NoonSum = {
  transactionType: string;
  /** A statement fee whose details mention advertising. */
  advertising: boolean;
  amounts: Record<NoonAmountField, string>;
  total: string;
};

export type NoonGroupTotals = Record<NoonPostingGroup, bigint>;

/**
 * Sums rows into the groups. Payments are left out (they're what Noon paid out, matched to the
 * bank). Statement fees and balance transfers count whole; order rows by column, with anything
 * the columns don't explain (a row that doesn't add up) in Other, so the groups always add up
 * to the rows' totals.
 */
export function noonGroupTotals(sums: readonly NoonSum[]): {
  groups: NoonGroupTotals;
  /** What the rows added to Noon's balance (everything but payouts). */
  earned: bigint;
  /** What Noon paid out (positive). */
  paidOut: bigint;
} {
  const groups = Object.fromEntries(NOON_POSTING_GROUP_KEYS.map((g) => [g, 0n])) as NoonGroupTotals;
  let paidOut = 0n;
  for (const s of sums) {
    const type = noonTypeKey(s.transactionType);
    const total = parseDecimal(s.total);
    if (type === NOON_PAYOUT_TYPE) {
      paidOut -= total;
      continue;
    }
    if (type === "balance_transfer") {
      groups.transfers += total;
      continue;
    }
    if (type === "statement_fee") {
      groups[s.advertising ? "advertising" : "fees"] += total;
      continue;
    }
    const a = (f: NoonAmountField) => parseDecimal(s.amounts[f]);
    groups[type === "order_update" ? "refunds" : "sales"] += a("netProceeds");
    groups.fees += a("referralFee") + a("fulfilmentFee") + a("otherOrderFees") + a("nonOrderFees");
    groups.shippingCredits += a("shippingCredits");
    groups.subsidies += a("orderSubsidies") + a("nonOrderSubsidies");
    const columns = NOON_AMOUNT_FIELDS.reduce((t, f) => t + a(f), 0n);
    groups.other += a("others") + (total - columns);
  }
  const earned = NOON_POSTING_GROUP_KEYS.reduce((t, g) => t + groups[g], 0n);
  return { groups, earned, paidOut };
}

/**
 * A month's entry: each group to its account (money to the seller credits it), the net to the
 * Noon balance. Lines for the same account are combined. Errors in plain words.
 */
export function buildNoonEntry(input: {
  groups: NoonGroupTotals;
  accounts: NoonAccounts;
}): { ok: true; lines: SettlementEntryLine[]; earned: string } | { ok: false; error: string } {
  const balance = input.accounts.balance;
  if (!balance) return { ok: false, error: "Choose the Noon balance account first." };
  const byAccount = new Map<string, { units: bigint; labels: string[] }>();
  const add = (accountId: string, units: bigint, label: string) => {
    const a = byAccount.get(accountId) ?? { units: 0n, labels: [] };
    a.units += units;
    if (!a.labels.includes(label)) a.labels.push(label);
    byAccount.set(accountId, a);
  };
  let earned = 0n;
  for (const group of NOON_POSTING_GROUP_KEYS) {
    const units = input.groups[group];
    if (units === 0n) continue;
    const fallback = FALLBACK[group];
    const account = input.accounts[group] ?? (fallback ? input.accounts[fallback] : undefined);
    if (!account) {
      return { ok: false, error: `Choose an account for “${NOON_POSTING_GROUPS[group]}”.` };
    }
    if (account === balance) {
      return {
        ok: false,
        error: `“${NOON_POSTING_GROUPS[group]}” can't go to the Noon balance account itself. Choose another account.`,
      };
    }
    add(account, -units, NOON_POSTING_GROUPS[group]);
    earned += units;
  }
  add(balance, earned, "Noon balance");
  const lines = [...byAccount.entries()]
    .filter(([, a]) => a.units !== 0n)
    .map(([accountId, a]) => ({
      accountId,
      amount: formatDecimal(a.units),
      description: a.labels.join(", "),
    }));
  if (!lines.length) return { ok: false, error: "This month has nothing to post." };
  return { ok: true, lines, earned: formatDecimal(earned) };
}

/** "2026-09" → its last day. */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export type NoonMonthState =
  /** In the books, as Noon's rows are now. */
  | "posted"
  /** In the books, but Noon's rows changed since (late fees, updates): post it again. */
  | "changed"
  | "ready"
  /** Not over yet (or today is its last day). */
  | "inProgress"
  /** Before posting starts: the books have it already (or don't want it). */
  | "before"
  /** No posting set up yet. */
  | "notSetUp"
  /** Nothing to post: only payouts, or amounts that come to zero in every group. */
  | "empty";

export function noonMonthState(input: {
  month: string;
  today: string;
  postFrom: string | null;
  posted: { earned: string; rows: number } | null;
  current: { earned: string; rows: number };
  /** Every group comes to zero. */
  empty?: boolean;
}): NoonMonthState {
  if (input.posted) {
    const same =
      parseDecimal(input.posted.earned) === parseDecimal(input.current.earned) &&
      input.posted.rows === input.current.rows;
    return same ? "posted" : "changed";
  }
  if (input.empty || input.current.rows === 0) return "empty";
  if (!input.postFrom) return "notSetUp";
  if (monthEnd(input.month) < input.postFrom) return "before";
  if (monthEnd(input.month) >= input.today) return "inProgress";
  return "ready";
}

/**
 * Noon's rows in Channel profit's groups (the Amazon report's rows): sales and shipping credits
 * as sales, returns as refunds, Noon's subsidies with promotions (they lower what the buyer
 * paid), fees, advertising, and balance moved to another contract with other. What stayed in
 * (or left) the Noon balance shows as "held back and released", so "paid out" is what Noon
 * actually paid out in the period. `convert` values units in another currency.
 */
export function noonProfitTotals(
  sums: readonly NoonSum[],
  convert: (units: bigint) => bigint = (u) => u,
  into: GroupTotals = emptyGroupTotals(),
): GroupTotals {
  const { groups: g, earned, paidOut } = noonGroupTotals(sums);
  into.sales += convert(g.sales + g.shippingCredits);
  into.refunds += convert(g.refunds);
  into.promotions += convert(g.subsidies);
  into.fees += convert(g.fees);
  into.advertising += convert(g.advertising);
  into.other += convert(g.transfers + g.other);
  into.reserve += convert(paidOut - earned);
  return into;
}

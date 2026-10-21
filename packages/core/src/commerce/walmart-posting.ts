import { formatDecimal, parseDecimal } from "../money";
import { emptyGroupTotals, type GroupTotals, type SettlementEntryLine } from "./settlements";
import { walmartAmount } from "./walmart-settlement-file";

/**
 * How a Walmart settlement goes into the books (phase 4e, slice 4b-2). Walmart's reconciliation
 * report has one row per amount: what it was for in "Amount Type" (Product Price, Commission on
 * Product, Walmart Fulfillment Services Fee…) and what happened in "Transaction Type" (Sale,
 * Refund, Adjustment…). Each row is read into a group, and a settlement posts as one entry on its
 * last day: each group to its account, the net to a "Walmart balance" asset, which the payout's
 * bank deposit takes back out when it's matched. A settlement whose rows don't add up to Walmart's
 * payout, or whose layout isn't Walmart's, doesn't post: the books never get a guess.
 */

export const WALMART_GROUPS = {
  sales: "Sales",
  refunds: "Refunds",
  fees: "Walmart's fees",
  fulfilment: "WFS fees",
  advertising: "Advertising",
  shipping: "Shipping labels",
  tax: "Sales tax",
  other: "Other",
} as const;
export type WalmartGroup = keyof typeof WALMART_GROUPS;
export const WALMART_GROUP_KEYS = Object.keys(WALMART_GROUPS) as WalmartGroup[];

export type WalmartAccountKey = WalmartGroup | "balance";
export const WALMART_ACCOUNT_KEYS = [...WALMART_GROUP_KEYS, "balance"] as WalmartAccountKey[];
export type WalmartAccounts = Partial<Record<WalmartAccountKey, string>>;

export const WALMART_ACCOUNT_LABELS: Record<WalmartAccountKey, string> = {
  ...WALMART_GROUPS,
  balance: "Walmart balance (what Walmart owes you)",
};

export const WALMART_ACCOUNT_HINTS: Record<WalmartAccountKey, string> = {
  sales:
    "What customers paid for your items, shipping and gift wrap, before Walmart's fees. An income account.",
  refunds: "What you gave back on returns and refunds. Left empty, they go to the sales account.",
  fees: "Walmart's commission (referral fees) and other selling fees. An expense account.",
  fulfilment:
    "Walmart Fulfillment Services: fulfilment, storage and inbound fees. Left empty, they go with Walmart's fees.",
  advertising:
    "Sponsored Products and other Walmart Connect ads. Left empty, they go with the fees.",
  shipping: "Shipping labels bought through Walmart. Left empty, they go with the fees.",
  tax: "Sales tax Walmart collected. Where Walmart also pays it to the government, the two cancel out and nothing posts. Usually a sales tax account.",
  other: "Adjustments, reimbursements and anything else. Left empty, it goes with the fees.",
  balance:
    "What Walmart owes you until it pays out. An asset; each payout matched to its bank deposit takes it back out.",
};

/** Where a group goes when it has no account of its own. */
const FALLBACK: Partial<Record<WalmartGroup, WalmartGroup>> = {
  refunds: "sales",
  fulfilment: "fees",
  advertising: "fees",
  shipping: "fees",
  other: "fees",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();

/** The columns a settlement is read with. */
export type WalmartLayout = {
  amount: string;
  amountType: string | null;
  transactionType: string | null;
  description: string | null;
};

/**
 * Finds the columns the report is read with: "Amount" (required), "Amount Type", "Transaction
 * Type" and a description. Null when there's no amount column: the report isn't in Walmart's
 * layout, and nothing can be read from it.
 */
export function walmartLayout(columns: readonly string[]): WalmartLayout | null {
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const found = columns.find((c) => p.test(norm(c)));
      if (found) return found;
    }
    return null;
  };
  const amount = find(/^amount$/, /^transaction amount$/, /^net amount$/);
  if (!amount) return null;
  return {
    amount,
    amountType: find(/^amount type$/, /^amount description$/),
    transactionType: find(/^transaction type$/, /^type$/),
    description: find(/^transaction description$/, /^description$/, /^adjustment description$/),
  };
}

/** What a row is: a group, or Walmart paying the balance out (not earnings). */
export type WalmartRowKind = WalmartGroup | "payout";

/** Which group a row's amount belongs to, from its amount type, transaction type and description. */
export function walmartRowGroup(
  row: Record<string, string>,
  layout: WalmartLayout,
): WalmartRowKind {
  const amountType = norm(layout.amountType ? (row[layout.amountType] ?? "") : "");
  const txType = norm(layout.transactionType ? (row[layout.transactionType] ?? "") : "");
  const description = norm(layout.description ? (row[layout.description] ?? "") : "");
  const all = `${amountType} ${txType} ${description}`;
  if (/\b(deposit|deposited|payment|payout|disbursement|hyperwallet|transfer)\b/.test(txType)) {
    return "payout";
  }
  if (/\btax/.test(amountType)) return "tax";
  if (/\b(wfs|fulfil+ment|fulfil+ed by walmart|storage|inbound|prep service)/.test(all)) {
    return "fulfilment";
  }
  if (/\b(advertis|sponsored|walmart connect|campaign)/.test(all)) return "advertising";
  if (/\b(shipping label|label|ship with walmart)\b/.test(all)) return "shipping";
  if (/\b(commission|referral)/.test(amountType)) return "fees";
  if (/\b(refund|return|chargeback)/.test(txType)) return "refunds";
  if (/\b(price|gift wrap|item price|product)\b/.test(amountType) || /\bsale\b/.test(txType)) {
    return "sales";
  }
  if (/\bfee/.test(all)) return "fees";
  return "other";
}

/** A settlement read: each group's total (money to the seller is positive), in minor detail. */
export type WalmartSettlementTotals = {
  groups: Record<WalmartGroup, bigint>;
  /** What the rows add to the Walmart balance: every group (payout rows aren't earnings). */
  net: bigint;
  /** Rows that pay the balance out, when the report lists them. */
  paidOut: bigint;
  /** Rows with an amount that couldn't be read. */
  unreadable: number;
};

export const emptyWalmartGroups = (): Record<WalmartGroup, bigint> =>
  Object.fromEntries(WALMART_GROUP_KEYS.map((g) => [g, 0n])) as Record<WalmartGroup, bigint>;

/** Adds a settlement's rows up by group. Null when the report isn't in Walmart's layout. */
export function walmartSettlementTotals(
  columns: readonly string[],
  rows: readonly Record<string, string>[],
): WalmartSettlementTotals | null {
  const layout = walmartLayout(columns);
  if (!layout) return null;
  const groups = emptyWalmartGroups();
  let paidOut = 0n;
  let unreadable = 0;
  for (const row of rows) {
    const raw = row[layout.amount]?.trim();
    if (!raw) continue;
    const amount = walmartAmount(raw);
    if (amount === null) {
      unreadable++;
      continue;
    }
    const units = parseDecimal(amount);
    const kind = walmartRowGroup(row, layout);
    if (kind === "payout") paidOut += units;
    else groups[kind] += units;
  }
  const net = WALMART_GROUP_KEYS.reduce((t, g) => t + groups[g], 0n);
  return { groups, net, paidOut, unreadable };
}

/** Why a settlement can't be read into the books, in plain words; null when it reads cleanly. */
export function walmartSettlementProblem(
  totals: WalmartSettlementTotals | null,
  payout: string | null,
): string | null {
  if (!totals) {
    return "This report isn't in Walmart's usual layout (it has no Amount column), so it can't be read into your books yet.";
  }
  if (totals.unreadable) {
    return `${totals.unreadable} ${totals.unreadable === 1 ? "row has an amount" : "rows have amounts"} that couldn't be read.`;
  }
  if (payout !== null && parseDecimal(payout) !== totals.net) {
    return `The rows add up to ${formatDecimal(totals.net)}, not Walmart's payout of ${formatDecimal(parseDecimal(payout))}.`;
  }
  return null;
}

/**
 * A settlement's entry: each group to its account (money to the seller credits it), the net to
 * the Walmart balance. Lines for the same account are combined. Errors in plain words.
 */
export function buildWalmartEntry(input: {
  groups: Record<WalmartGroup, bigint>;
  accounts: WalmartAccounts;
}): { ok: true; lines: SettlementEntryLine[]; net: string } | { ok: false; error: string } {
  const balance = input.accounts.balance;
  if (!balance) return { ok: false, error: "Choose the Walmart balance account first." };
  const byAccount = new Map<string, { units: bigint; labels: string[] }>();
  const add = (accountId: string, units: bigint, label: string) => {
    const a = byAccount.get(accountId) ?? { units: 0n, labels: [] };
    a.units += units;
    if (!a.labels.includes(label)) a.labels.push(label);
    byAccount.set(accountId, a);
  };
  let net = 0n;
  for (const group of WALMART_GROUP_KEYS) {
    const units = input.groups[group];
    if (units === 0n) continue;
    const fallback = FALLBACK[group];
    const account = input.accounts[group] ?? (fallback ? input.accounts[fallback] : undefined);
    if (!account) {
      return { ok: false, error: `Choose an account for “${WALMART_ACCOUNT_LABELS[group]}”.` };
    }
    if (account === balance) {
      return {
        ok: false,
        error: `“${WALMART_ACCOUNT_LABELS[group]}” can't go to the Walmart balance account itself. Choose another account.`,
      };
    }
    add(account, -units, WALMART_GROUPS[group]);
    net += units;
  }
  add(balance, net, "Walmart balance");
  const lines = [...byAccount.entries()]
    .filter(([, a]) => a.units !== 0n)
    .map(([accountId, a]) => ({
      accountId,
      amount: formatDecimal(a.units),
      description: a.labels.join(", "),
    }));
  if (!lines.length) return { ok: false, error: "This settlement has nothing to post." };
  return { ok: true, lines, net: formatDecimal(net) };
}

/**
 * Bumped whenever the way rows are read changes, so totals kept with a settlement are read again
 * from its rows.
 */
export const WALMART_READER_VERSION = 1;

/** Totals as kept with a settlement (decimal strings, so they survive JSON). */
export type WalmartStoredTotals = {
  groups: Record<WalmartGroup, string>;
  net: string;
  paidOut: string;
  unreadable: number;
};

export function storeWalmartTotals(t: WalmartSettlementTotals | null): WalmartStoredTotals | null {
  if (!t) return null;
  return {
    groups: Object.fromEntries(
      WALMART_GROUP_KEYS.map((g) => [g, formatDecimal(t.groups[g])]),
    ) as Record<WalmartGroup, string>,
    net: formatDecimal(t.net),
    paidOut: formatDecimal(t.paidOut),
    unreadable: t.unreadable,
  };
}

export function readWalmartTotals(t: WalmartStoredTotals | null): WalmartSettlementTotals | null {
  if (!t) return null;
  const groups = emptyWalmartGroups();
  for (const g of WALMART_GROUP_KEYS) groups[g] = parseDecimal(t.groups[g] ?? "0");
  return {
    groups,
    net: parseDecimal(t.net),
    paidOut: parseDecimal(t.paidOut),
    unreadable: t.unreadable,
  };
}

/**
 * A settlement's groups in Channel profit's (Amazon's settlement groups): WFS fees count with the
 * marketplace's fees, shipping labels with other. What Walmart paid out is then the net plus
 * sales tax, as on Amazon's settlements.
 */
export function walmartProfitTotals(
  groups: Record<WalmartGroup, bigint>,
  convert: (units: bigint) => bigint = (u) => u,
  into: GroupTotals = emptyGroupTotals(),
): GroupTotals {
  into.sales += convert(groups.sales);
  into.refunds += convert(groups.refunds);
  into.fees += convert(groups.fees + groups.fulfilment);
  into.advertising += convert(groups.advertising);
  into.tax += convert(groups.tax);
  into.other += convert(groups.shipping + groups.other);
  return into;
}

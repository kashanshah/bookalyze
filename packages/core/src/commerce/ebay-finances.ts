import { formatDecimal, parseDecimal } from "../money";
import { emptyGroupTotals, type GroupTotals } from "./settlements";

/**
 * eBay's money (Finances API, GET /sell/finances/v1/transaction on the apiz host): every sale,
 * refund, fee, shipping label, credit and transfer on the seller's account, kept row by row and
 * totalled by month for each eBay site. Amounts are in the account's payout currency, signed
 * (money in positive, money out negative). No buyer details are kept. Nothing here posts to the
 * books; payouts and posting come later.
 */

export const EBAY_TRANSACTIONS_PATH = "/sell/finances/v1/transaction";
/** eBay's largest page. */
export const EBAY_TRANSACTIONS_PAGE = 1000;

/** The query for one page of a window of days (YYYY-MM-DD, both included, UTC). */
export function ebayTransactionsQuery(input: { from: string; to: string; offset: number }): string {
  const params = new URLSearchParams({
    filter: `transactionDate:[${input.from}T00:00:00.000Z..${input.to}T23:59:59.999Z]`,
    limit: String(EBAY_TRANSACTIONS_PAGE),
    offset: String(input.offset),
  });
  return `${EBAY_TRANSACTIONS_PATH}?${params.toString()}`;
}

export type EbayTransaction = {
  transactionId: string;
  /** SALE, REFUND, CREDIT, DISPUTE, NON_SALE_CHARGE, SHIPPING_LABEL, TRANSFER, ADJUSTMENT… */
  transactionType: string;
  /** FUNDS_ON_HOLD, FUNDS_AVAILABLE_FOR_PAYOUT, PAYOUT, COMPLETED… */
  status: string | null;
  /** ISO timestamp (UTC). */
  transactionDate: string;
  orderId: string | null;
  payoutId: string | null;
  /** For a charge: which fee (AD_FEE, INSERTION_FEE…). */
  feeType: string | null;
  currency: string;
  /** Signed: what the row added to (or took from) the seller's eBay balance. */
  amount: string;
  /** eBay's fees on the row, as a positive amount (taken from a sale, given back on a refund). */
  fees: string;
  /** Tax eBay collected from the buyer and paid itself (never the seller's money). */
  ebayTax: string;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

/** An Amount ({ value, currency }) in units, or 0n. */
function units(v: unknown): bigint {
  const raw = record(v).value;
  const value = typeof raw === "number" ? String(raw) : text(raw);
  if (!value) return 0n;
  try {
    return parseDecimal(value);
  } catch {
    return 0n;
  }
}

/**
 * Parses one page; `next` is the offset of the next page, or null on the last one. eBay answers
 * 204 No Content (no body, so `null` here) when nothing matches: an empty page.
 */
export function parseEbayTransactionsPage(json: unknown): {
  transactions: EbayTransaction[];
  next: number | null;
} {
  if (json === null || json === undefined) return { transactions: [], next: null };
  const page = record(json);
  if (!("total" in page) && !Array.isArray(page.transactions)) {
    throw new Error("Unexpected response from eBay.");
  }
  const raw = list(page.transactions);
  const seen = count(page.offset) + raw.length;
  const next = raw.length && seen < count(page.total) ? seen : null;
  const transactions = raw.flatMap((r): EbayTransaction[] => {
    const t = record(r);
    const transactionId = text(t.transactionId);
    const transactionType = text(t.transactionType);
    const transactionDate = text(t.transactionDate);
    const amount = record(t.amount);
    const currency = text(amount.currency);
    if (!transactionId || !transactionType || !transactionDate || !currency) return [];
    const sign = text(t.bookingEntry) === "DEBIT" ? -1n : 1n;
    return [
      {
        transactionId,
        transactionType,
        status: text(t.transactionStatus) || null,
        transactionDate,
        orderId: text(t.orderId) || null,
        payoutId: text(t.payoutId) || null,
        feeType: text(t.feeType) || null,
        currency,
        amount: formatDecimal(sign * units(amount)),
        fees: formatDecimal(units(t.totalFeeAmount)),
        ebayTax: formatDecimal(units(t.ebayCollectedTaxAmount ?? t.eBayCollectedTaxAmount)),
      },
    ];
  });
  return { transactions, next };
}

/** How a row counts: what it earned, and where. */
export const EBAY_GROUPS = {
  sales: "Sales",
  refunds: "Refunds and disputes",
  fees: "eBay's fees",
  advertising: "Advertising",
  shipping: "Shipping labels",
  credits: "Credits from eBay",
  other: "Other",
  transfers: "Money moved (not earnings)",
} as const;
export type EbayGroup = keyof typeof EBAY_GROUPS;

/** Charges that are advertising (Promoted Listings and the like). */
const ADVERTISING = /AD_FEE|PROMOTED|ADVERTIS/i;
/** Money moved in or out of the eBay balance, not earned or spent. */
const TRANSFERS = new Set(["TRANSFER", "WITHDRAWAL", "LOAN_REPAYMENT", "PURCHASE"]);

/** A month's rows of one type, summed (units in the decimal strings). */
export type EbaySum = {
  transactionType: string;
  feeType: string | null;
  rows: number;
  amount: string;
  fees: string;
};

/**
 * The groups for a month's sums. A sale's fees are split out of it (sales = what came in before
 * eBay's fees); a refund gives fees back. Transfers aren't earnings. `earned` is the net.
 */
export function ebayGroupTotals(sums: readonly EbaySum[]): {
  groups: Record<EbayGroup, bigint>;
  earned: bigint;
} {
  const groups = Object.fromEntries(Object.keys(EBAY_GROUPS).map((g) => [g, 0n])) as Record<
    EbayGroup,
    bigint
  >;
  for (const s of sums) {
    const amount = parseDecimal(s.amount);
    const fees = parseDecimal(s.fees);
    const type = s.transactionType.toUpperCase();
    if (TRANSFERS.has(type)) {
      groups.transfers += amount;
      continue;
    }
    // Fees are taken from money coming in and given back with money going out.
    const feePart = amount >= 0n ? -fees : fees;
    groups.fees += feePart;
    const base = amount - feePart;
    if (type === "SALE") groups.sales += base;
    else if (type === "REFUND" || type === "DISPUTE") groups.refunds += base;
    else if (type === "SHIPPING_LABEL") groups.shipping += base;
    else if (type === "CREDIT") groups.credits += base;
    else if (type === "NON_SALE_CHARGE") {
      if (ADVERTISING.test(s.feeType ?? "")) groups.advertising += base;
      else groups.fees += base;
    } else groups.other += base;
  }
  const earned = (Object.keys(groups) as EbayGroup[])
    .filter((g) => g !== "transfers")
    .reduce((t, g) => t + groups[g], 0n);
  return { groups, earned };
}

/** A month's sums in Channel profit's groups (before payouts, which come with their own step). */
export function ebayProfitTotals(
  sums: readonly EbaySum[],
  convert: (units: bigint) => bigint = (u) => u,
  into: GroupTotals = emptyGroupTotals(),
): GroupTotals {
  const { groups: g } = ebayGroupTotals(sums);
  into.sales += convert(g.sales);
  into.refunds += convert(g.refunds);
  into.fees += convert(g.fees);
  into.advertising += convert(g.advertising);
  into.reimbursements += convert(g.credits);
  into.other += convert(g.shipping + g.other);
  return into;
}

/** Seller Hub's Payments page on the account's eBay site. */
export function ebayTransactionsUrl(site: string): string {
  return `https://www.${site}/sh/fin`;
}

// --- Payouts ------------------------------------------------------------------------------------

export const EBAY_PAYOUTS_PATH = "/sell/finances/v1/payout";
/** eBay's largest page of payouts. */
export const EBAY_PAYOUTS_PAGE = 200;

/** The query for one page of payouts dated in a window of days (YYYY-MM-DD, both included). */
export function ebayPayoutsQuery(input: { from: string; to: string; offset: number }): string {
  const params = new URLSearchParams({
    filter: `payoutDate:[${input.from}T00:00:00.000Z..${input.to}T23:59:59.999Z]`,
    limit: String(EBAY_PAYOUTS_PAGE),
    offset: String(input.offset),
  });
  return `${EBAY_PAYOUTS_PATH}?${params.toString()}`;
}

export type EbayPayout = {
  payoutId: string;
  /** INITIATED, SUCCEEDED, RETRYABLE_FAILED, TERMINAL_FAILED, REVERSED. */
  status: string;
  /** ISO timestamp (UTC). */
  payoutDate: string;
  currency: string;
  /** What eBay sent to the bank (positive). */
  amount: string;
  /** The bank account's last four digits, when eBay gives them. */
  accountLast4: string | null;
};

/** Payouts that left eBay (or are on their way): the ones a bank deposit can match. */
export const ebayPayoutSent = (status: string) => status === "SUCCEEDED" || status === "INITIATED";

/**
 * Parses one page of payouts; `next` is the next page's offset, or null on the last one. No
 * payouts in the window comes back as 204 No Content (`null`): an empty page.
 */
export function parseEbayPayoutsPage(json: unknown): {
  payouts: EbayPayout[];
  next: number | null;
} {
  if (json === null || json === undefined) return { payouts: [], next: null };
  const page = record(json);
  if (!("total" in page) && !Array.isArray(page.payouts)) {
    throw new Error("Unexpected response from eBay.");
  }
  const raw = list(page.payouts);
  const seen = count(page.offset) + raw.length;
  const next = raw.length && seen < count(page.total) ? seen : null;
  const payouts = raw.flatMap((r): EbayPayout[] => {
    const p = record(r);
    const payoutId = text(p.payoutId);
    const payoutDate = text(p.payoutDate);
    const amount = record(p.amount);
    const currency = text(amount.currency);
    if (!payoutId || !payoutDate || !currency) return [];
    return [
      {
        payoutId,
        status: text(p.payoutStatus) || "INITIATED",
        payoutDate,
        currency,
        amount: formatDecimal(units(amount)),
        accountLast4: text(record(p.payoutInstrument).accountLastFourDigits) || null,
      },
    ];
  });
  return { payouts, next };
}

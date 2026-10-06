import { formatDecimal, parseDecimal } from "../money";

/**
 * Amazon settlements: every ~14 days Amazon closes a period and pays the net (sales, shipping
 * and tax collected, less refunds, fees, advertising and any reserve) into the seller's bank.
 * The settlement report (flat file V2, tab-separated) has one summary row (settlement ID,
 * period, deposit date, total) and one row per amount. Columns are read by their header names,
 * so their order doesn't matter. Lines are summed by kind (transaction type, amount type,
 * description): that is what the books need, and it keeps thousands of rows to a few dozen.
 */

export const SETTLEMENT_REPORT_TYPE = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2";

export type SettlementLine = {
  transactionType: string;
  amountType: string;
  amountDescription: string;
  /** Signed: positive is money to the seller. */
  amount: string;
  /** How many rows were summed into it. */
  count: number;
};

export type Settlement = {
  settlementId: string;
  /** ISO timestamps (UTC). */
  startAt: string;
  endAt: string;
  /** The day Amazon sends the money (YYYY-MM-DD), if given. */
  depositDate: string | null;
  /** What Amazon pays out (negative: nothing is paid, the balance is carried or charged). */
  total: string;
  currency: string;
  /** e.g. "Amazon.ca", from the rows. */
  marketplace: string | null;
  lines: SettlementLine[];
  /** Orders the settlement covers. */
  orderCount: number;
  /** The lines add up to the total. */
  balanced: boolean;
};

const HEADERS = {
  settlementId: "settlement-id",
  start: "settlement-start-date",
  end: "settlement-end-date",
  deposit: "deposit-date",
  total: "total-amount",
  currency: "currency",
  transactionType: "transaction-type",
  orderId: "order-id",
  marketplace: "marketplace-name",
  amountType: "amount-type",
  amountDescription: "amount-description",
  amount: "amount",
} as const;

/**
 * Amounts as Amazon prints them: "1234.56", "-12.30", "1,234.56", and in some marketplaces
 * "1.234,56" or "12,30" (the last separator is the decimal one when it has 1 or 2 digits after).
 */
export function readSettlementAmount(raw: string): string | null {
  let t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastComma > lastDot && /,\d{1,2}$/.test(t)) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    t = t.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return formatDecimal(parseDecimal(t));
}

/**
 * Dates as Amazon prints them: "2026-09-01 07:08:16 UTC", "2026-09-01T07:08:16+00:00" or (EU
 * and Middle East marketplaces) "01.09.2026 07:08:16 UTC". Returns an ISO timestamp, or null.
 */
export function readSettlementDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(t);
  let parts: string[] | null = m ? [m[1], m[2], m[3], m[4], m[5], m[6]].map((p) => p ?? "") : null;
  if (!parts) {
    m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?/.exec(t);
    if (m) parts = [m[3], m[2], m[1], m[4], m[5], m[6]].map((p) => p ?? "");
  }
  if (!parts) return null;
  const [y, mo, d, h, mi, s] = parts;
  const offset = /([+-]\d{2}):?(\d{2})$/.exec(t);
  const iso = `${y}-${mo}-${d}T${h || "00"}:${mi || "00"}:${s || "00"}${
    offset ? `${offset[1]}:${offset[2]}` : "Z"
  }`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Parses a settlement report (flat file V2). Throws, in plain words, on a file that isn't one. */
export function parseSettlementReport(text: string): Settlement {
  const rows = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((r) => r.trim())
    .map((r) => r.split("\t"));
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const at = Object.fromEntries(
    Object.entries(HEADERS).map(([k, name]) => [k, col(name)]),
  ) as Record<keyof typeof HEADERS, number>;
  if (at.settlementId < 0 || at.total < 0 || at.amount < 0) {
    throw new Error(
      "This isn't an Amazon settlement report. In Seller Central → Payments → All statements, download the “Flat File V2”.",
    );
  }
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  const summary = rows.slice(1).find((r) => cell(r, at.total) !== "");
  if (!summary) throw new Error("The settlement report has no summary row.");
  const total = readSettlementAmount(cell(summary, at.total));
  const startAt = readSettlementDate(cell(summary, at.start));
  const endAt = readSettlementDate(cell(summary, at.end));
  const settlementId = cell(summary, at.settlementId);
  if (!total || !startAt || !endAt || !settlementId) {
    throw new Error("The settlement report's summary row couldn't be read.");
  }
  const deposit = readSettlementDate(cell(summary, at.deposit));

  const sums = new Map<string, SettlementLine & { units: bigint }>();
  const orders = new Set<string>();
  const marketplaces = new Map<string, number>();
  for (const row of rows.slice(1)) {
    if (row === summary) continue;
    const amount = readSettlementAmount(cell(row, at.amount));
    if (amount === null) continue;
    const line = {
      transactionType: cell(row, at.transactionType) || "Other",
      amountType: cell(row, at.amountType) || "Other",
      amountDescription: cell(row, at.amountDescription) || "Other",
    };
    const key = `${line.transactionType}\u0000${line.amountType}\u0000${line.amountDescription}`;
    const sum = sums.get(key) ?? { ...line, amount: "0", count: 0, units: 0n };
    sum.units += parseDecimal(amount);
    sum.count++;
    sums.set(key, sum);
    const order = cell(row, at.orderId);
    if (order) orders.add(order);
    const place = cell(row, at.marketplace);
    if (place) marketplaces.set(place, (marketplaces.get(place) ?? 0) + 1);
  }
  const lines = [...sums.values()].map(({ units, ...l }) => ({
    ...l,
    amount: formatDecimal(units),
  }));
  const linesTotal = [...sums.values()].reduce((t, l) => t + l.units, 0n);
  const marketplace =
    [...marketplaces.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.slice(0, 100) ?? null;
  return {
    settlementId: settlementId.slice(0, 100),
    startAt,
    endAt,
    depositDate: deposit ? deposit.slice(0, 10) : null,
    total,
    currency: cell(summary, at.currency).toUpperCase().slice(0, 3) || "",
    marketplace,
    lines,
    orderCount: orders.size,
    balanced: linesTotal === parseDecimal(total),
  };
}

export const SETTLEMENT_GROUPS = {
  sales: "Sales",
  refunds: "Refunds",
  promotions: "Promotions",
  fees: "Amazon fees",
  advertising: "Advertising",
  tax: "Tax Amazon collects and pays",
  reimbursements: "Reimbursements",
  reserve: "Held back and released",
  other: "Other",
} as const;
export type SettlementGroup = keyof typeof SETTLEMENT_GROUPS;

/** Which group a line belongs to, for the settlement page (and, later, posting). */
export function settlementGroup(
  line: Pick<SettlementLine, "transactionType" | "amountType" | "amountDescription">,
): SettlementGroup {
  const tt = line.transactionType.toLowerCase();
  const at = line.amountType.toLowerCase();
  const ad = line.amountDescription.toLowerCase();
  if (/reserve/.test(`${at} ${ad}`)) return "reserve";
  if (/advertis/.test(`${tt} ${at} ${ad}`)) return "advertising";
  if (/withheld|marketplacefacilitator|tcs|tds/.test(`${at} ${ad}`)) return "tax";
  if (/reimburse/.test(`${tt} ${ad}`)) return "reimbursements";
  if (/promotion/.test(at)) return "promotions";
  if (/fee|commission/.test(`${at} ${ad}`) || /servicefee|storage/.test(tt)) return "fees";
  if (/refund|chargeback|guarantee|a-to-z/.test(tt)) return "refunds";
  if (/order/.test(tt) && /itemprice/.test(at)) return "sales";
  return "other";
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const text = (v: unknown) => (typeof v === "string" ? v : "");

export type AmazonReport = {
  reportId: string;
  reportDocumentId: string;
  createdAt: string;
};

/** Parses GET /reports/2021-06-30/reports: finished reports with a document. */
export function parseReportsPage(json: unknown): {
  reports: AmazonReport[];
  nextToken: string | null;
} {
  const body = record(json);
  if (!Array.isArray(body.reports)) throw new Error("Unexpected response from Amazon.");
  const reports = body.reports.flatMap((raw): AmazonReport[] => {
    const r = record(raw);
    const reportId = text(r.reportId);
    const reportDocumentId = text(r.reportDocumentId);
    if (!reportId || !reportDocumentId || (r.processingStatus && r.processingStatus !== "DONE")) {
      return [];
    }
    return [{ reportId, reportDocumentId, createdAt: text(r.createdTime) }];
  });
  return { reports, nextToken: text(body.nextToken) || null };
}

/** Parses GET /reports/2021-06-30/documents/{id}: where to download it, and whether it's gzipped. */
export function parseReportDocument(json: unknown): { url: string; gzip: boolean } {
  const body = record(json);
  const url = text(body.url);
  if (!url) throw new Error("Unexpected response from Amazon.");
  return { url, gzip: text(body.compressionAlgorithm).toUpperCase() === "GZIP" };
}

const LINE_LABELS: Record<string, string> = {
  principal: "Item price",
  shipping: "Shipping",
  tax: "Tax collected",
  shippingtax: "Tax on shipping",
  giftwrap: "Gift wrap",
  giftwraptax: "Tax on gift wrap",
  commission: "Referral fee",
  refundcommission: "Refund administration fee",
  fbaperunitfulfillmentfee: "FBA fulfilment fee",
  fbaweightbasedfee: "FBA weight-based fee",
  fbaperorderfulfillmentfee: "FBA per-order fee",
  shippingchargeback: "Shipping chargeback",
  giftwrapchargeback: "Gift wrap chargeback",
  variableclosingfee: "Closing fee",
  digitalservicesfee: "Digital services fee",
  "current reserve amount": "Held back this period",
  "previous reserve amount balance": "Released from last period",
  "storage fee": "FBA storage fee",
  "subscription fee": "Selling plan subscription",
};

/** A line's name in plain words: "Referral fee" for Amazon's "Commission", say. */
export function settlementLineLabel(
  line: Pick<SettlementLine, "transactionType" | "amountType" | "amountDescription">,
): string {
  const key = line.amountDescription.toLowerCase();
  const known = LINE_LABELS[key] ?? LINE_LABELS[key.replace(/[\s_-]/g, "")];
  if (known) return known;
  if (/advertis/i.test(`${line.amountType} ${line.transactionType}`)) return "Sponsored ads";
  // "FBAInventoryReimbursement" → "FBA inventory reimbursement"; "TransactionTotalAmount" → type.
  const words = (/totalamount/i.test(key) ? line.amountType : line.amountDescription)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  const lower = words.toLowerCase().replace(/\bfba\b/g, "FBA");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

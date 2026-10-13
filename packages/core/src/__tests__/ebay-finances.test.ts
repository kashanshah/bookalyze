import { describe, expect, it } from "vitest";
import {
  type EbaySum,
  ebayGroupTotals,
  ebayPayoutSent,
  ebayPayoutsQuery,
  ebayProfitTotals,
  ebayTransactionsQuery,
  parseEbayPayoutsPage,
  parseEbayTransactionsPage,
} from "../commerce/ebay-finances";
import { formatDecimal } from "../money";

const money = (value: string, currency = "CAD") => ({ value, currency });

describe("ebayTransactionsQuery", () => {
  it("asks a window of whole days, 1,000 a page", () => {
    const params = new URL(
      `https://x${ebayTransactionsQuery({ from: "2026-09-01", to: "2026-09-30", offset: 1000 })}`,
    ).searchParams;
    expect(params.get("filter")).toBe(
      "transactionDate:[2026-09-01T00:00:00.000Z..2026-09-30T23:59:59.999Z]",
    );
    expect(params.get("limit")).toBe("1000");
    expect(params.get("offset")).toBe("1000");
  });
});

describe("parseEbayTransactionsPage", () => {
  it("signs amounts by booking entry and keeps no buyer details", () => {
    const page = parseEbayTransactionsPage({
      total: 2,
      offset: 0,
      transactions: [
        {
          transactionId: "T1",
          transactionType: "SALE",
          transactionStatus: "PAYOUT",
          transactionDate: "2026-09-02T14:05:00.000Z",
          orderId: "12-34567-89012",
          payoutId: "P1",
          bookingEntry: "CREDIT",
          amount: money("26.10"),
          totalFeeAmount: money("3.90"),
          ebayCollectedTaxAmount: money("1.95"),
          buyer: { username: "synthetic_buyer" },
        },
        {
          transactionId: "T2",
          transactionType: "NON_SALE_CHARGE",
          transactionDate: "2026-09-03T10:00:00.000Z",
          feeType: "AD_FEE",
          bookingEntry: "DEBIT",
          amount: money("2.50"),
        },
      ],
    });
    expect(page.next).toBeNull();
    expect(page.transactions).toEqual([
      {
        transactionId: "T1",
        transactionType: "SALE",
        status: "PAYOUT",
        transactionDate: "2026-09-02T14:05:00.000Z",
        orderId: "12-34567-89012",
        payoutId: "P1",
        feeType: null,
        currency: "CAD",
        amount: "26.1000",
        fees: "3.9000",
        ebayTax: "1.9500",
      },
      {
        transactionId: "T2",
        transactionType: "NON_SALE_CHARGE",
        status: null,
        transactionDate: "2026-09-03T10:00:00.000Z",
        orderId: null,
        payoutId: null,
        feeType: "AD_FEE",
        currency: "CAD",
        amount: "-2.5000",
        fees: "0.0000",
        ebayTax: "0.0000",
      },
    ]);
    expect(JSON.stringify(page)).not.toContain("synthetic_buyer");
  });

  it("gives the next page's offset, and refuses what isn't a page", () => {
    const transactions = Array.from({ length: 1000 }, (_, i) => ({
      transactionId: `T${i}`,
      transactionType: "SALE",
      transactionDate: "2026-09-02T00:00:00Z",
      bookingEntry: "CREDIT",
      amount: money("1"),
    }));
    expect(parseEbayTransactionsPage({ total: 1500, offset: 0, transactions }).next).toBe(1000);
    expect(parseEbayTransactionsPage({ total: 0, transactions: [] }).transactions).toEqual([]);
    expect(() => parseEbayTransactionsPage({ errors: [] })).toThrow();
  });
});

describe("ebayGroupTotals", () => {
  const sums: EbaySum[] = [
    { transactionType: "SALE", feeType: null, rows: 2, amount: "52.20", fees: "7.80" },
    { transactionType: "REFUND", feeType: null, rows: 1, amount: "-26.10", fees: "1.20" },
    { transactionType: "NON_SALE_CHARGE", feeType: "AD_FEE", rows: 1, amount: "-2.50", fees: "0" },
    {
      transactionType: "NON_SALE_CHARGE",
      feeType: "INSERTION_FEE",
      rows: 1,
      amount: "-0.35",
      fees: "0",
    },
    { transactionType: "SHIPPING_LABEL", feeType: null, rows: 1, amount: "-9.15", fees: "0" },
    { transactionType: "CREDIT", feeType: null, rows: 1, amount: "4.00", fees: "0" },
    { transactionType: "TRANSFER", feeType: null, rows: 1, amount: "-10.00", fees: "0" },
  ];

  it("splits fees out of sales and gives them back on refunds; transfers aren't earnings", () => {
    const { groups, earned } = ebayGroupTotals(sums);
    const out = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, formatDecimal(v)]));
    expect(out).toEqual({
      sales: "60.0000",
      refunds: "-27.3000",
      fees: "-6.9500",
      advertising: "-2.5000",
      shipping: "-9.1500",
      credits: "4.0000",
      other: "0.0000",
      transfers: "-10.0000",
    });
    // Net of everything but transfers: the rows' amounts.
    expect(formatDecimal(earned)).toBe("18.1000");
  });

  it("fills Channel profit's groups", () => {
    const t = ebayProfitTotals(sums);
    expect(formatDecimal(t.sales)).toBe("60.0000");
    expect(formatDecimal(t.fees)).toBe("-6.9500");
    expect(formatDecimal(t.advertising)).toBe("-2.5000");
    expect(formatDecimal(t.reimbursements)).toBe("4.0000");
    expect(formatDecimal(t.other)).toBe("-9.1500");
    expect(t.reserve).toBe(0n);
  });
});

describe("eBay payouts", () => {
  it("asks payouts by date and parses them, sent or not", () => {
    const params = new URL(
      `https://x${ebayPayoutsQuery({ from: "2026-09-01", to: "2026-09-30", offset: 0 })}`,
    ).searchParams;
    expect(params.get("filter")).toBe(
      "payoutDate:[2026-09-01T00:00:00.000Z..2026-09-30T23:59:59.999Z]",
    );
    const page = parseEbayPayoutsPage({
      total: 2,
      offset: 0,
      payouts: [
        {
          payoutId: "P1",
          payoutStatus: "SUCCEEDED",
          payoutDate: "2026-09-05T08:00:00.000Z",
          amount: { value: "120.45", currency: "CAD" },
          payoutInstrument: {
            instrumentType: "BANK",
            nickname: "Chequing",
            accountLastFourDigits: "1234",
          },
        },
        {
          payoutId: "P2",
          payoutStatus: "TERMINAL_FAILED",
          payoutDate: "2026-09-12T08:00:00.000Z",
          amount: { value: "50", currency: "CAD" },
        },
      ],
    });
    expect(page.next).toBeNull();
    expect(page.payouts).toEqual([
      {
        payoutId: "P1",
        status: "SUCCEEDED",
        payoutDate: "2026-09-05T08:00:00.000Z",
        currency: "CAD",
        amount: "120.4500",
        accountLast4: "1234",
      },
      {
        payoutId: "P2",
        status: "TERMINAL_FAILED",
        payoutDate: "2026-09-12T08:00:00.000Z",
        currency: "CAD",
        amount: "50.0000",
        accountLast4: null,
      },
    ]);
    expect(page.payouts.map((p) => ebayPayoutSent(p.status))).toEqual([true, false]);
    expect(() => parseEbayPayoutsPage({ errors: [] })).toThrow();
  });
});

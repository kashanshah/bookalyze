import { describe, expect, it } from "vitest";
import {
  buildSettlementEntry,
  convertSettlementEntry,
  depositFit,
  depositMatchLines,
  parseReportDocument,
  parseReportsPage,
  parseSettlementReport,
  readSettlementAmount,
  readSettlementDate,
  settlementDepositWindow,
  settlementGroup,
  settlementLineLabel,
} from "../commerce/settlements";

// A synthetic settlement report (flat file V2): a summary row, then one row per amount.
const HEADER = [
  "settlement-id",
  "settlement-start-date",
  "settlement-end-date",
  "deposit-date",
  "total-amount",
  "currency",
  "transaction-type",
  "order-id",
  "merchant-order-id",
  "adjustment-id",
  "shipment-id",
  "marketplace-name",
  "amount-type",
  "amount-description",
  "amount",
  "fulfillment-id",
  "posted-date",
  "sku",
  "quantity-purchased",
];
const row = (values: Partial<Record<(typeof HEADER)[number], string>>) =>
  HEADER.map((h) => values[h as keyof typeof values] ?? "").join("\t");
const order = (id: string, type: string, desc: string, amount: string) =>
  row({
    "settlement-id": "11223344556",
    "transaction-type": "Order",
    "order-id": id,
    "marketplace-name": "Amazon.ca",
    "amount-type": type,
    "amount-description": desc,
    amount,
  });
const REPORT = [
  HEADER.join("\t"),
  row({
    "settlement-id": "11223344556",
    "settlement-start-date": "2026-09-01 07:00:00 UTC",
    "settlement-end-date": "2026-09-15 07:00:00 UTC",
    "deposit-date": "2026-09-17 07:00:00 UTC",
    "total-amount": "47.05",
    currency: "CAD",
  }),
  order("702-0000001-0000001", "ItemPrice", "Principal", "39.98"),
  order("702-0000001-0000001", "ItemPrice", "Tax", "5.21"),
  order("702-0000001-0000001", "ItemFees", "Commission", "-6.00"),
  order("702-0000001-0000001", "ItemFees", "FBAPerUnitFulfillmentFee", "-8.24"),
  order("702-0000002-0000002", "ItemPrice", "Principal", "24.77"),
  order("702-0000002-0000002", "ItemPrice", "Tax", "3.22"),
  order("702-0000002-0000002", "ItemFees", "Commission", "-3.72"),
  row({
    "settlement-id": "11223344556",
    "transaction-type": "Refund",
    "order-id": "702-0000001-0000001",
    "marketplace-name": "Amazon.ca",
    "amount-type": "ItemPrice",
    "amount-description": "Principal",
    amount: "-19.99",
  }),
  row({
    "settlement-id": "11223344556",
    "transaction-type": "ServiceFee",
    "amount-type": "Cost of Advertising",
    "amount-description": "TransactionTotalAmount",
    amount: "-12.00",
  }),
  row({
    "settlement-id": "11223344556",
    "transaction-type": "other-transaction",
    "amount-type": "other-transaction",
    "amount-description": "Current Reserve Amount",
    amount: "-5.00",
  }),
  row({
    "settlement-id": "11223344556",
    "transaction-type": "other-transaction",
    "amount-type": "other-transaction",
    "amount-description": "Previous Reserve Amount Balance",
    amount: "28.82",
  }),
].join("\n");

describe("parseSettlementReport", () => {
  it("reads the summary and sums the lines by kind, checking they add up to the payout", () => {
    const s = parseSettlementReport(REPORT);
    expect(s).toMatchObject({
      settlementId: "11223344556",
      startAt: "2026-09-01T07:00:00.000Z",
      endAt: "2026-09-15T07:00:00.000Z",
      depositDate: "2026-09-17",
      total: "47.0500",
      currency: "CAD",
      marketplace: "Amazon.ca",
      orderCount: 2,
      balanced: true,
    });
    const line = (tt: string, at: string, ad: string) =>
      s.lines.find(
        (l) => l.transactionType === tt && l.amountType === at && l.amountDescription === ad,
      );
    expect(line("Order", "ItemPrice", "Principal")).toMatchObject({ amount: "64.7500", count: 2 });
    expect(line("Order", "ItemFees", "Commission")).toMatchObject({ amount: "-9.7200", count: 2 });
    expect(s.lines).toHaveLength(8);
  });

  it("says when the lines don't add up, and refuses a file that isn't a settlement report", () => {
    const off = REPORT.replace("\t47.05\t", "\t48.05\t");
    expect(parseSettlementReport(off).balanced).toBe(false);
    expect(() => parseSettlementReport("date,description,amount\n2026-09-01,x,1")).toThrow(
      /Flat File V2/,
    );
  });

  it("puts each line in a group", () => {
    const g = (transactionType: string, amountType: string, amountDescription: string) =>
      settlementGroup({ transactionType, amountType, amountDescription });
    expect(g("Order", "ItemPrice", "Principal")).toBe("sales");
    expect(g("Order", "ItemPrice", "ShippingTax")).toBe("tax");
    expect(g("Order", "ItemFees", "Commission")).toBe("fees");
    expect(g("Refund", "ItemPrice", "Principal")).toBe("refunds");
    expect(g("Order", "Promotion", "Shipping")).toBe("promotions");
    expect(g("ServiceFee", "Cost of Advertising", "TransactionTotalAmount")).toBe("advertising");
    expect(g("other-transaction", "other-transaction", "Current Reserve Amount")).toBe("reserve");
    expect(g("Order", "ItemWithheldTax", "MarketplaceFacilitatorTax-Principal")).toBe("tax");
    expect(g("other-transaction", "FBA Inventory Reimbursement", "REVERSAL_REIMBURSEMENT")).toBe(
      "reimbursements",
    );
  });

  it("reads amounts and dates the way Amazon prints them", () => {
    expect(readSettlementAmount("1,234.56")).toBe("1234.5600");
    expect(readSettlementAmount("1.234,56")).toBe("1234.5600");
    expect(readSettlementAmount("-12,30")).toBe("-12.3000");
    expect(readSettlementAmount("")).toBeNull();
    expect(readSettlementDate("01.09.2026 07:08:16 UTC")).toBe("2026-09-01T07:08:16.000Z");
    expect(readSettlementDate("2026-09-01T07:08:16+04:00")).toBe("2026-09-01T03:08:16.000Z");
    expect(readSettlementDate("2026-09-01")).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("Amazon's report answers", () => {
  it("lists finished reports and reads where to download one", () => {
    const page = parseReportsPage({
      nextToken: "t2",
      reports: [
        { reportId: "1", reportDocumentId: "d1", processingStatus: "DONE", createdTime: "x" },
        { reportId: "2", processingStatus: "IN_PROGRESS" },
      ],
    });
    expect(page).toEqual({
      reports: [{ reportId: "1", reportDocumentId: "d1", createdAt: "x" }],
      nextToken: "t2",
    });
    expect(parseReportDocument({ url: "https://x", compressionAlgorithm: "GZIP" })).toEqual({
      url: "https://x",
      gzip: true,
    });
    expect(() => parseReportsPage({ errors: [] })).toThrow();
  });
});

describe("settlementLineLabel", () => {
  it("names lines in plain words", () => {
    const l = (transactionType: string, amountType: string, amountDescription: string) =>
      settlementLineLabel({ transactionType, amountType, amountDescription });
    expect(l("Order", "ItemFees", "Commission")).toBe("Referral fee");
    expect(l("Order", "ItemFees", "FBAPerUnitFulfillmentFee")).toBe("FBA fulfilment fee");
    expect(l("ServiceFee", "Cost of Advertising", "TransactionTotalAmount")).toBe("Sponsored ads");
    expect(l("other-transaction", "other-transaction", "Current Reserve Amount")).toBe(
      "Held back this period",
    );
    expect(l("other-transaction", "FBA Inventory Reimbursement", "REVERSAL_REIMBURSEMENT")).toBe(
      "Reversal reimbursement",
    );
    expect(l("Order", "ItemFees", "FBAInboundPlacementFee")).toBe("FBA inbound placement fee");
  });
});

describe("buildSettlementEntry", () => {
  const s = parseSettlementReport(REPORT);
  const accounts = {
    sales: "sales",
    refunds: "sales",
    fees: "fees",
    advertising: "ads",
    tax: "tax",
    reserve: "clearing",
    clearing: "clearing",
  };
  it("posts each group's subtotal to its account and the payout to clearing, balanced", () => {
    const entry = buildSettlementEntry({ total: s.total, lines: s.lines, accounts });
    expect(entry.ok).toBe(true);
    if (!entry.ok) return;
    const by = Object.fromEntries(entry.lines.map((l) => [l.accountId, l.amount]));
    // Sales 64.75 − 19.99 refunded = 44.76 credit; the 8.43 tax buyers paid isn't income.
    expect(by.sales).toBe("-44.7600");
    expect(by.tax).toBe("-8.4300");
    expect(by.fees).toBe("17.9600");
    expect(by.ads).toBe("12.0000");
    // Payout 47.05 debit, less 23.82 reserve released (credit) = 23.23.
    expect(by.clearing).toBe("23.2300");
    expect(entry.lines.reduce((t, l) => t + Number(l.amount), 0)).toBeCloseTo(0, 6);
  });
  it("says what's missing", () => {
    const missing = buildSettlementEntry({
      total: s.total,
      lines: s.lines,
      accounts: { ...accounts, fees: undefined },
    });
    expect(missing).toEqual({ ok: false, error: "Choose an account for “Amazon fees”." });
    expect(buildSettlementEntry({ total: "1.00", lines: s.lines, accounts })).toMatchObject({
      ok: false,
    });
    expect(buildSettlementEntry({ total: s.total, lines: s.lines, accounts: {} })).toEqual({
      ok: false,
      error: "Choose the clearing account first.",
    });
  });
});

describe("settlementDepositWindow", () => {
  it("looks a few days before Amazon's deposit date and up to ten after", () => {
    expect(settlementDepositWindow({ depositDate: "2026-07-20", endDate: "2026-07-17" })).toEqual({
      from: "2026-07-17",
      to: "2026-07-30",
    });
  });

  it("starts at the period's end when Amazon gave no deposit date", () => {
    expect(settlementDepositWindow({ depositDate: null, endDate: "2026-12-28" })).toEqual({
      from: "2026-12-28",
      to: "2027-01-07",
    });
  });
});

describe("convertSettlementEntry", () => {
  const lines = [
    { accountId: "sales", amount: "-100.0000", description: "Sales" },
    { accountId: "fees", amount: "33.3300", description: "Amazon fees" },
    { accountId: "clearing", amount: "66.6700", description: "Payout" },
  ];
  it("keeps the main currency as it is", () => {
    const r = convertSettlementEntry({
      lines,
      total: "66.6700",
      clearingAccountId: "clearing",
      clearingCurrency: null,
      currency: "CAD",
      baseCurrency: "CAD",
      rate: "1",
    });
    expect(r.ok && r.lines.map((l) => [l.currency, l.amount, l.baseAmount])).toEqual([
      ["CAD", "-100.0000", "-100.0000"],
      ["CAD", "33.3300", "33.3300"],
      ["CAD", "66.6700", "66.6700"],
    ]);
    expect(r.ok && r.payoutBase).toBe("66.6700");
  });

  it("converts another currency at the rate, balancing the rounding on the largest line", () => {
    const r = convertSettlementEntry({
      lines,
      total: "66.6700",
      clearingAccountId: "clearing",
      clearingCurrency: "CAD",
      currency: "AED",
      baseCurrency: "CAD",
      rate: "0.3715",
    });
    if (!r.ok) throw new Error(r.error);
    // 100 → 37.15, 33.33 → 12.38, 66.67 → 24.77: 12.38 + 24.77 = 37.15.
    expect(r.lines.map((l) => [l.accountId, l.currency, l.amount, l.baseAmount])).toEqual([
      ["sales", "AED", "-100.0000", "-37.1500"],
      ["fees", "AED", "33.3300", "12.3800"],
      ["clearing", "CAD", "24.7700", "24.7700"],
    ]);
    expect(r.lines.reduce((t, l) => t + Number(l.baseAmount), 0)).toBeCloseTo(0, 6);
    expect(r.payoutBase).toBe("24.7700");
  });

  it("refuses a clearing account held in a third currency", () => {
    const r = convertSettlementEntry({
      lines,
      total: "66.6700",
      clearingAccountId: "clearing",
      clearingCurrency: "USD",
      currency: "AED",
      baseCurrency: "CAD",
      rate: "0.3715",
    });
    expect(r.ok).toBe(false);
  });
});

describe("depositFit", () => {
  it("is exact in the same currency, for the same amount only", () => {
    const base = { total: "2163.45", currency: "AED", depositCurrency: "AED", rate: null };
    expect(depositFit({ ...base, depositAmount: "2163.45" })).toEqual({ kind: "exact" });
    expect(depositFit({ ...base, depositAmount: "2163.46" })).toBeNull();
  });

  it("is close in another currency, within 10% of the market rate", () => {
    const base = { total: "1000", currency: "AED", depositCurrency: "CAD", rate: "0.3720" };
    expect(depositFit({ ...base, depositAmount: "365.00" })).toEqual({
      kind: "converted",
      impliedRate: "0.3650000000",
      marketRate: "0.3720",
      differenceBp: -188,
    });
    // 8% under the market rate is still offered; 19% isn't.
    expect(depositFit({ ...base, depositAmount: "342.00" })).toMatchObject({ differenceBp: -806 });
    expect(depositFit({ ...base, depositAmount: "300.00" })).toBeNull();
    expect(depositFit({ ...base, depositAmount: "365.00", rate: null })).toBeNull();
    // Market rates come with up to 10 decimal places.
    expect(depositFit({ ...base, depositAmount: "365.00", rate: "0.3716814159" })).toMatchObject({
      kind: "converted",
      differenceBp: -179,
    });
  });
});

describe("depositMatchLines", () => {
  const money = {
    accountId: "bank",
    description: null,
    currency: "CAD",
    amount: "365.0000",
    baseAmount: "365.0000",
  };
  const base = {
    clearingAccountId: "clearing",
    clearingCurrency: "CAD",
    currency: "AED",
    baseCurrency: "CAD",
    total: "1000.0000",
    fxGainAccountId: "gain",
    fxLossAccountId: "loss",
    description: "Amazon settlement 1",
  };
  it("clears the payout at its posted value and books the difference as an exchange loss", () => {
    const r = depositMatchLines({ ...base, money, payoutBase: "372.0000" });
    expect(r.ok && r.lines.map((l) => [l.accountId, l.currency, l.amount, l.baseAmount])).toEqual([
      ["bank", "CAD", "365.0000", "365.0000"],
      ["clearing", "CAD", "-372.0000", "-372.0000"],
      ["loss", "CAD", "7.0000", "7.0000"],
    ]);
  });

  it("books a gain when the deposit is worth more, and nothing when it's the same", () => {
    const gain = depositMatchLines({ ...base, money, payoutBase: "360.0000" });
    expect(gain.ok && gain.lines[2]).toMatchObject({ accountId: "gain", amount: "-5.0000" });
    const same = depositMatchLines({
      ...base,
      currency: "CAD",
      total: "365.0000",
      money,
      payoutBase: "365.0000",
    });
    expect(same.ok && same.lines).toHaveLength(2);
  });

  it("keeps a clearing account in the payout's currency in that currency", () => {
    const aed = {
      ...money,
      currency: "AED",
      amount: "1000.0000",
      baseAmount: "371.0000",
    };
    const r = depositMatchLines({
      ...base,
      clearingCurrency: null,
      money: aed,
      payoutBase: "372.0000",
    });
    expect(r.ok && r.lines.map((l) => [l.accountId, l.currency, l.amount, l.baseAmount])).toEqual([
      ["bank", "AED", "1000.0000", "371.0000"],
      ["clearing", "AED", "-1000.0000", "-372.0000"],
      ["loss", "CAD", "1.0000", "1.0000"],
    ]);
  });
});

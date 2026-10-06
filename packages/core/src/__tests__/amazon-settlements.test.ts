import { describe, expect, it } from "vitest";
import {
  parseReportDocument,
  parseReportsPage,
  parseSettlementReport,
  readSettlementAmount,
  readSettlementDate,
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

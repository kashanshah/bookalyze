import { describe, expect, it } from "vitest";
import {
  isTransactionReport,
  parseTransactionReport,
  parseTransactionReportOrders,
  readReportDate,
  settlementGroup,
} from "../commerce";

const HEADER =
  '"date/time","settlement id","type","order id","sku","description","quantity","marketplace","fulfillment","order city","order state","order postal","product sales","shipping credits","gift wrap credits","promotional rebates","selling fees","fba fees","other transaction fees","other","total"';

const row = (cells: (string | number)[]) => cells.map((c) => `"${c}"`).join(",");

// Two settlements of a made-up Amazon.ae seller. 1001's payout (95.00) is transferred inside
// 1002, which is still open (no transfer for it yet).
const REPORT = [
  '"Includes Amazon Marketplace, Fulfillment by Amazon (FBA), and Amazon Webstore transactions"',
  '"All amounts in local currency, unless specified"',
  HEADER,
  row([
    "2 Feb 2026 9:15:00 AM UTC",
    "1001",
    "Order",
    "406-1",
    "MUG",
    "Mug",
    1,
    "amazon.ae",
    "Amazon",
    "",
    "",
    "",
    "120.00",
    "5.00",
    0,
    "-5.00",
    "-12.00",
    "-14.00",
    0,
    0,
    "94.00",
  ]),
  row([
    "3 Feb 2026 1:00:00 PM UTC",
    "1001",
    "Order",
    "406-2",
    "MUG",
    "Mug",
    1,
    "amazon.ae",
    "Amazon",
    "",
    "",
    "",
    "60.00",
    0,
    0,
    0,
    "-6.00",
    "-7.00",
    0,
    0,
    "47.00",
  ]),
  row([
    "5 Feb 2026 10:00:00 AM UTC",
    "1001",
    "Refund",
    "406-1",
    "MUG",
    "Mug",
    1,
    "amazon.ae",
    "Amazon",
    "",
    "",
    "",
    "-30.00",
    0,
    0,
    0,
    "3.00",
    0,
    0,
    0,
    "-27.00",
  ]),
  row([
    "6 Feb 2026 10:00:00 AM UTC",
    "1001",
    "Service Fee",
    "",
    "",
    "Cost of Advertising",
    "",
    "",
    "",
    "",
    "",
    "",
    0,
    0,
    0,
    0,
    0,
    0,
    "-10.00",
    "-0.50",
    "-10.50",
  ]),
  row([
    "7 Feb 2026 10:00:00 AM UTC",
    "1001",
    "FBA Inventory Fee",
    "",
    "",
    "FBA storage fee",
    "",
    "",
    "",
    "",
    "",
    "",
    0,
    0,
    0,
    0,
    0,
    "-8.50",
    0,
    0,
    "-8.50",
  ]),
  row([
    "8 Feb 2026 10:00:00 AM UTC",
    "1001",
    "Adjustment",
    "",
    "MUG",
    "FBA Inventory Reimbursement - Lost:Warehouse",
    1,
    "",
    "",
    "",
    "",
    "",
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    "0.00",
    "0.00",
  ]),
  row([
    "11 Feb 2026 6:00:00 AM UTC",
    "1002",
    "Transfer",
    "",
    "",
    "To account ending with: 501",
    "",
    "",
    "",
    "",
    "",
    "",
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    "-95.00",
    "-95.00",
  ]),
  row([
    "12 Feb 2026 6:00:00 PM UTC",
    "1002",
    "Order",
    "406-3",
    "MUG",
    "Mug",
    2,
    "amazon.ae",
    "Amazon",
    "",
    "",
    "",
    "240.00",
    0,
    0,
    0,
    "-24.00",
    "-28.00",
    0,
    0,
    "188.00",
  ]),
].join("\n");

describe("Amazon's date range transaction report", () => {
  it("is told apart from a settlement flat file", () => {
    expect(isTransactionReport(REPORT)).toBe(true);
    expect(isTransactionReport("settlement-id\tsettlement-start-date\ttotal-amount")).toBe(false);
  });

  it("reads its dates, day first or month first, AM/PM, with the time zone", () => {
    expect(readReportDate("6 Oct 2023 8:41:29 PM UTC")).toBe("2023-10-06T20:41:29.000Z");
    expect(readReportDate("Oct 6, 2023 8:41:29 PM PDT")).toBe("2023-10-07T03:41:29.000Z");
    expect(readReportDate("1 Jan 2026 12:05:00 AM UTC")).toBe("2026-01-01T00:05:00.000Z");
    expect(readReportDate("not a date")).toBeNull();
  });

  it("rebuilds each settlement, its lines grouped like the flat file's, transfers left out", () => {
    const [first, second] = parseTransactionReport(REPORT);
    expect(first).toMatchObject({
      settlementId: "1001",
      startAt: "2026-02-02T09:15:00.000Z",
      endAt: "2026-02-08T10:00:00.000Z",
      depositDate: "2026-02-11",
      total: "95.0000",
      currency: "AED",
      marketplace: "Amazon.ae",
      orderCount: 2,
      balanced: true,
    });
    const groups: Record<string, string> = {};
    for (const l of first?.lines ?? []) {
      const g = settlementGroup(l);
      groups[g] = (Number(groups[g] ?? 0) + Number(l.amount)).toFixed(2);
    }
    expect(groups).toEqual({
      sales: "185.00",
      promotions: "-5.00",
      fees: "-44.50",
      refunds: "-30.00",
      advertising: "-10.50",
    });
    // The open one: no payout yet.
    expect(second).toMatchObject({ settlementId: "1002", total: "188.0000", depositDate: null });
  });

  it("carries what Amazon held back into the next payout, like the flat file's reserve lines", () => {
    const sale = (date: string, id: string, order: string, total: string) =>
      row([
        date,
        id,
        "Order",
        order,
        "MUG",
        "Mug",
        1,
        "amazon.ae",
        "Amazon",
        "",
        "",
        "",
        total,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        total,
      ]);
    const transfer = (date: string, id: string, total: string) =>
      row([
        date,
        id,
        "Transfer",
        "",
        "",
        "To account ending with: 501",
        "",
        "",
        "",
        "",
        "",
        "",
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        total,
        total,
      ]);
    const report = [
      HEADER,
      sale("2 Mar 2026 9:00:00 AM UTC", "2001", "406-1", "100.00"),
      // 2001 earned 100 but paid 80: 20 held back.
      transfer("5 Mar 2026 6:00:00 AM UTC", "2002", "-80.00"),
      sale("9 Mar 2026 9:00:00 AM UTC", "2002", "406-2", "50.00"),
      // 2002 earned 50 and paid 70: the 20 released.
      transfer("19 Mar 2026 6:00:00 AM UTC", "2003", "-70.00"),
      sale("23 Mar 2026 9:00:00 AM UTC", "2003", "406-3", "30.00"),
    ].join("\n");
    const [first, second, open] = parseTransactionReport(report);
    const reserves = (s: typeof first) =>
      s?.lines.filter((l) => settlementGroup(l) === "reserve").map((l) => l.amount);
    expect(first).toMatchObject({ total: "80.0000", depositDate: "2026-03-05", balanced: true });
    expect(reserves(first)).toEqual(["-20.0000"]);
    expect(second).toMatchObject({ total: "70.0000", depositDate: "2026-03-19", balanced: true });
    expect(reserves(second)).toEqual(["20.0000"]);
    // Still open: nothing paid after it, so nothing held is known yet.
    expect(open).toMatchObject({ total: "30.0000", depositDate: null });
    expect(reserves(open)).toEqual([]);
  });

  it("reads its orders: SKUs and quantities, dated when they settled, refunds left out", () => {
    const [ae] = parseTransactionReportOrders(REPORT);
    expect(ae).toMatchObject({ marketplace: "Amazon.ae", currency: "AED" });
    expect(ae?.orders.map((o) => o.order.orderId)).toEqual(["406-1", "406-2", "406-3"]);
    expect(ae?.orders[0]).toMatchObject({
      order: {
        purchasedAt: "2026-02-02T09:15:00.000Z",
        status: "Shipped",
        fulfillment: "amazon",
        total: "120.0000",
        itemsShipped: 1,
      },
      items: [
        {
          sku: "MUG",
          quantityShipped: 1,
          itemPrice: "120.0000",
          shippingPrice: "5.0000",
          promotionDiscount: "5.0000",
        },
      ],
    });
    expect(ae?.orders[2]?.items[0]).toMatchObject({ sku: "MUG", quantityShipped: 2 });
  });

  it("refuses a file that isn't the report", () => {
    expect(() => parseTransactionReport('"a","b"\n"1","2"')).toThrow(
      /isn't Amazon's transaction report/,
    );
  });
});

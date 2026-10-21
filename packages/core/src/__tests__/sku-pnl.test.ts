import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseSettlementReport } from "../commerce/settlements";
import {
  amazonSkuKind,
  type ChannelPnlInput,
  channelSkuPnl,
  ebaySkuRows,
  noonSkuRows,
  SKU_PNL_COLUMNS,
  type SkuMoneyRow,
  type SkuOrderLine,
  type SkuPnlEntry,
  skuPnlCsvRows,
  skuWaterfall,
  splitUnits,
  summarizeSkuPnl,
  totalSkuPnl,
  walmartSkuColumns,
  walmartSkuRow,
} from "../commerce/sku-pnl";
import { walmartLayout } from "../commerce/walmart-posting";
import { formatDecimal, parseDecimal } from "../money";

// Synthetic data only: made-up SKUs, orders and amounts.

const line = (over: Partial<SkuOrderLine> = {}): SkuOrderLine => ({
  orderRef: "702-1",
  sku: "MUG-1",
  date: "2026-09-03",
  units: 1,
  gross: "20.0000",
  promotions: "0",
  refunded: "0",
  returnedUnits: 0,
  ...over,
});
const money = (over: Partial<SkuMoneyRow>): SkuMoneyRow => ({
  orderRef: "702-1",
  sku: "MUG-1",
  date: "2026-09-05",
  kind: "sales",
  amount: "0",
  quantity: 0,
  orderElsewhere: false,
  ...over,
});
const base = (over: Partial<ChannelPnlInput> = {}): ChannelPnlInput => ({
  currency: "CAD",
  costCurrency: "CAD",
  lines: [],
  rows: [],
  keepRate: null,
  feeTaxRecoverable: false,
  hasAdsReports: false,
  ads: [],
  allocateBrands: false,
  links: new Map([["MUG-1", { components: [{ productId: "p1", units: 1 }] }]]),
  postedCosts: new Map(),
  nextCosts: new Map([["p1", "5.0000"]]),
  today: "2026-10-21",
  ...over,
});
const same = (e: SkuPnlEntry) => parseDecimal(e.amount);
const summary = (input: ChannelPnlInput) => {
  const pnl = channelSkuPnl(input);
  return {
    pnl,
    rows: summarizeSkuPnl({
      entries: pnl.entries,
      counts: pnl.counts,
      currency: input.currency,
      convert: same,
      costMissing: pnl.costMissing,
      feesUnknown: pnl.feesUnknown ? new Set(pnl.counts.keys()) : new Set(),
    }),
  };
};
const rowOf = (rows: ReturnType<typeof summary>["rows"], sku: string) => {
  const r = rows.find((x) => x.sku === sku);
  if (!r) throw new Error(`no row ${sku}`);
  return r;
};

describe("parseSettlementReport: amounts by order and SKU", () => {
  const HEADER = [
    "settlement-id",
    "settlement-start-date",
    "settlement-end-date",
    "total-amount",
    "currency",
    "transaction-type",
    "order-id",
    "amount-type",
    "amount-description",
    "amount",
    "posted-date",
    "sku",
    "quantity-purchased",
  ];
  const row = (v: Partial<Record<string, string>>) => HEADER.map((h) => v[h] ?? "").join("\t");
  const order = (sku: string, at: string, ad: string, amount: string, qty = "") =>
    row({
      "settlement-id": "S1",
      "transaction-type": "Order",
      "order-id": "702-1",
      "amount-type": at,
      "amount-description": ad,
      amount,
      "posted-date": "2026-09-04 10:00:00 UTC",
      sku,
      "quantity-purchased": qty,
    });
  const text = [
    HEADER.join("\t"),
    row({
      "settlement-id": "S1",
      "settlement-start-date": "2026-09-01 00:00:00 UTC",
      "settlement-end-date": "2026-09-15 00:00:00 UTC",
      "total-amount": "18.0000",
      currency: "CAD",
    }),
    order("MUG-1", "ItemPrice", "Principal", "20.0000", "2"),
    order("MUG-1", "ItemFees", "Commission", "-3.0000"),
    order("CUP-2", "ItemPrice", "Principal", "10.0000", "1"),
    order("CUP-2", "ItemFees", "Commission", "-1.5000"),
    row({
      "settlement-id": "S1",
      "transaction-type": "ServiceFee",
      "amount-type": "other-transaction",
      "amount-description": "Subscription Fee",
      amount: "-7.5000",
      "posted-date": "2026-09-10 00:00:00 UTC",
    }),
  ].join("\n");

  it("keeps each order's SKU amounts with their units and day, and account fees with neither", () => {
    const s = parseSettlementReport(text);
    expect(s.balanced).toBe(true);
    expect(s.skuLines).toHaveLength(5);
    expect(s.skuLines).toContainEqual(
      expect.objectContaining({
        orderId: "702-1",
        sku: "MUG-1",
        amountDescription: "Principal",
        amount: "20.0000",
        quantity: 2,
        postedDate: "2026-09-04",
      }),
    );
    expect(s.skuLines).toContainEqual(
      expect.objectContaining({
        orderId: null,
        sku: null,
        amount: "-7.5000",
        postedDate: "2026-09-10",
      }),
    );
    // By SKU they add up to the same total as the summed lines.
    const sum = (ls: { amount: string }[]) => ls.reduce((t, l) => t + parseDecimal(l.amount), 0n);
    expect(sum(s.skuLines ?? [])).toBe(sum(s.lines));
  });
});

describe("amazonSkuKind", () => {
  const k = (transactionType: string, amountType: string, amountDescription: string) =>
    amazonSkuKind({ transactionType, amountType, amountDescription });
  it("splits Amazon's fees into referral, fulfilment and other", () => {
    expect(k("Order", "ItemPrice", "Principal")).toBe("sales");
    expect(k("Order", "ItemPrice", "Shipping")).toBe("shipping");
    expect(k("Order", "ItemPrice", "Tax")).toBe("ignore");
    expect(k("Order", "ItemFees", "Commission")).toBe("referral");
    expect(k("Order", "ItemFees", "FBAPerUnitFulfillmentFee")).toBe("fulfilment");
    expect(k("Refund", "ItemFees", "RefundCommission")).toBe("otherFees");
    expect(k("Refund", "ItemPrice", "Principal")).toBe("refunds");
    expect(k("Order", "Promotion", "Principal")).toBe("promotions");
    expect(k("ServiceFee", "Cost of Advertising", "TransactionTotalAmount")).toBe("advertising");
    expect(k("other-transaction", "other-transaction", "Current Reserve Amount")).toBe("ignore");
  });
});

describe("channelSkuPnl", () => {
  it("takes a settled order's amounts from the marketplace's rows, all actual", () => {
    const { rows } = summary(
      base({
        lines: [line({ units: 2, gross: "40.0000" })],
        rows: [
          money({ kind: "sales", amount: "40.0000" }),
          money({ kind: "referral", amount: "-6.0000" }),
          money({ kind: "fulfilment", amount: "-8.0000" }),
          money({ kind: "refunds", amount: "-20.0000", date: "2026-09-20" }),
        ],
      }),
    );
    const r = rowOf(rows, "MUG-1");
    expect(r.unitsSold).toBe(2);
    expect(r.lines.grossSales.amount).toBe("40.0000");
    expect(r.lines.referral.amount).toBe("-6.0000");
    expect(r.lines.refunds.amount).toBe("-20.0000");
    expect(r.cogs).toBe("-10.0000");
    // 40 − 6 − 8 − 20 − 10 (cost estimated: the month isn't posted).
    expect(r.profit).toBe("-4.0000");
    expect(r.lines.cogs.estimated).toBe("-10.0000");
    expect(r.actualShare).toBe(88.1);
  });

  it("estimates an unsettled order's fees at the rates its SKU's settled orders show", () => {
    const { rows } = summary(
      base({
        lines: [line(), line({ orderRef: "702-2", gross: "30.0000", refunded: "30.0000" })],
        rows: [
          money({ kind: "sales", amount: "20.0000" }),
          money({ kind: "referral", amount: "-3.0000" }),
        ],
      }),
    );
    const r = rowOf(rows, "MUG-1");
    // 15% of 20, then 15% of 30 estimated.
    expect(r.lines.referral.amount).toBe("-7.5000");
    expect(r.lines.referral.estimated).toBe("-4.5000");
    // The unsettled order's refund comes from the order, estimated.
    expect(r.lines.refunds).toEqual({ amount: "-30.0000", estimated: "-30.0000" });
    expect(r.lines.grossSales).toEqual({ amount: "50.0000", estimated: "0.0000" });
  });

  it("uses the keep rate when nothing on the channel is settled by product", () => {
    const { rows, pnl } = summary(
      base({
        lines: [line({ gross: "100.0000", promotions: "10.0000" })],
        keepRate: "0.7000000000",
      }),
    );
    expect(pnl.mode).toBe("keep");
    const r = rowOf(rows, "MUG-1");
    expect(r.sales).toBe("90.0000");
    // 90 × 0.7 = 63: 27 to the marketplace.
    expect(r.lines.marketplaceEstimate).toEqual({ amount: "-27.0000", estimated: "-27.0000" });
    expect(r.profit).toBe("58.0000");
  });

  it("leaves profit unknown without a keep rate or a cost", () => {
    const { rows } = summary(
      base({
        lines: [line(), line({ sku: "LOOSE", orderRef: "702-2" })],
        links: new Map([["MUG-1", { components: [{ productId: "p1", units: 1 }] }]]),
      }),
    );
    expect(rowOf(rows, "MUG-1").feesUnknown).toBe(true);
    expect(rowOf(rows, "MUG-1").profit).toBeNull();
    expect(rowOf(rows, "LOOSE").costMissing).toBe(true);
  });

  it("shares an order's rows with no SKU by item price (eBay)", () => {
    const { rows } = summary(
      base({
        lines: [line({ gross: "30.0000" }), line({ sku: "CUP-2", gross: "10.0000" })],
        rows: [
          money({ sku: null, kind: "sales", amount: "40.0000" }),
          money({ sku: null, kind: "referral", amount: "-5.0000" }),
        ],
        links: new Map([
          ["MUG-1", { components: [{ productId: "p1", units: 1 }] }],
          ["CUP-2", { components: [{ productId: "p1", units: 1 }] }],
        ]),
      }),
    );
    expect(rowOf(rows, "MUG-1").lines.referral.amount).toBe("-3.7500");
    expect(rowOf(rows, "CUP-2").lines.referral.amount).toBe("-1.2500");
    expect(rowOf(rows, "CUP-2").lines.grossSales.amount).toBe("10.0000");
  });

  it("shares the account's fees by units, marked estimated", () => {
    const { rows } = summary(
      base({
        lines: [
          line({ units: 3, gross: "60.0000" }),
          line({ sku: "CUP-2", orderRef: "702-2", gross: "10.0000" }),
        ],
        rows: [
          money({ kind: "sales", amount: "60.0000" }),
          money({ orderRef: "702-2", sku: "CUP-2", kind: "sales", amount: "10.0000" }),
          money({
            orderRef: null,
            sku: null,
            kind: "otherFees",
            amount: "-8.0000",
            date: "2026-09-30",
          }),
        ],
      }),
    );
    expect(rowOf(rows, "MUG-1").lines.accountFees).toEqual({
      amount: "-6.0000",
      estimated: "-6.0000",
    });
    expect(rowOf(rows, "CUP-2").lines.accountFees.amount).toBe("-2.0000");
  });

  it("makes a line from the rows of an order Bookalyze doesn't have", () => {
    const { rows } = summary(
      base({
        rows: [
          money({ orderRef: "702-9", kind: "sales", amount: "25.0000", quantity: 1 }),
          money({ orderRef: "702-9", kind: "referral", amount: "-3.7500" }),
        ],
      }),
    );
    const r = rowOf(rows, "MUG-1");
    expect(r.unitsSold).toBe(1);
    expect(r.profit).toBe("16.2500");
  });

  it("costs units at the month's posted cost (actual), else the next unit's (estimated)", () => {
    const { rows } = summary(
      base({
        lines: [line({ units: 2 }), line({ orderRef: "702-2", date: "2026-10-02" })],
        rows: [
          money({ kind: "sales", amount: "20.0000" }),
          money({ orderRef: "702-2", kind: "sales", amount: "20.0000" }),
        ],
        postedCosts: new Map([["2026-09", new Map([["p1", "4.0000"]])]]),
      }),
    );
    const r = rowOf(rows, "MUG-1");
    expect(r.cogs).toBe("-13.0000");
    expect(r.lines.cogs.estimated).toBe("-5.0000");
  });

  it("counts ads once: the reports' spend, estimated for the last 14 days", () => {
    const { rows } = summary(
      base({
        lines: [line({ gross: "100.0000" })],
        rows: [
          money({ kind: "sales", amount: "100.0000" }),
          money({ orderRef: null, sku: null, kind: "advertising", amount: "-50.0000" }),
        ],
        hasAdsReports: true,
        ads: [
          { sku: "MUG-1", date: "2026-09-03", spend: "10.0000", attributedSales: "40.0000" },
          { sku: "MUG-1", date: "2026-10-15", spend: "4.0000", attributedSales: "0" },
        ],
      }),
    );
    const r = rowOf(rows, "MUG-1");
    expect(r.lines.ads).toEqual({ amount: "-14.0000", estimated: "-4.0000" });
    expect(r.tacos).toBe(14);
    expect(rows.find((x) => x.sku === "")).toBeUndefined();
  });

  it("keeps Sponsored Brands as its own line, or shares it by ad sales when chosen", () => {
    const input = base({
      lines: [
        line({ gross: "100.0000" }),
        line({ sku: "CUP-2", orderRef: "702-2", gross: "100.0000" }),
      ],
      rows: [
        money({ kind: "sales", amount: "100.0000" }),
        money({ orderRef: "702-2", sku: "CUP-2", kind: "sales", amount: "100.0000" }),
      ],
      hasAdsReports: true,
      ads: [
        { sku: "MUG-1", date: "2026-09-03", spend: "1.0000", attributedSales: "30.0000" },
        { sku: "CUP-2", date: "2026-09-03", spend: "1.0000", attributedSales: "10.0000" },
        { sku: null, date: "2026-09-03", spend: "20.0000", attributedSales: "50.0000" },
      ],
    });
    const own = summary(input).rows;
    expect(rowOf(own, "").lines.sponsoredBrands.amount).toBe("-20.0000");
    const shared = summary({ ...input, allocateBrands: true }).rows;
    expect(rowOf(shared, "MUG-1").lines.sponsoredBrands).toEqual({
      amount: "-15.0000",
      estimated: "-15.0000",
    });
    expect(rowOf(shared, "CUP-2").lines.sponsoredBrands.amount).toBe("-5.0000");
  });

  it("without ads reports, ad charges on a SKU are its ads and the account's are the books' line", () => {
    const { rows } = summary(
      base({
        lines: [line()],
        rows: [
          money({ kind: "sales", amount: "20.0000" }),
          money({ sku: null, kind: "advertising", amount: "-2.0000" }),
          money({ orderRef: null, sku: null, kind: "advertising", amount: "-9.0000" }),
        ],
      }),
    );
    expect(rowOf(rows, "MUG-1").lines.ads.amount).toBe("-2.0000");
    expect(rowOf(rows, "").lines.booksAdvertising.amount).toBe("-9.0000");
  });

  it("property: the lines always add up to the profit, and the total to the rows", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            units: fc.integer({ min: 1, max: 5 }),
            gross: fc.integer({ min: 0, max: 100_000 }),
            fee: fc.integer({ min: 0, max: 20_000 }),
            settled: fc.boolean(),
            sku: fc.constantFrom("MUG-1", "CUP-2"),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (orders) => {
          const input = base({
            lines: orders.map((o, i) =>
              line({
                orderRef: `o${i}`,
                sku: o.sku,
                units: o.units,
                gross: formatDecimal(BigInt(o.gross) * 100n),
              }),
            ),
            rows: orders.flatMap((o, i) =>
              o.settled
                ? [
                    money({
                      orderRef: `o${i}`,
                      sku: o.sku,
                      kind: "sales",
                      amount: formatDecimal(BigInt(o.gross) * 100n),
                    }),
                    money({
                      orderRef: `o${i}`,
                      sku: o.sku,
                      kind: "referral",
                      amount: formatDecimal(-BigInt(o.fee) * 100n),
                    }),
                  ]
                : [],
            ),
            keepRate: "0.8000000000",
            links: new Map([
              ["MUG-1", { components: [{ productId: "p1", units: 1 }] }],
              ["CUP-2", { components: [{ productId: "p1", units: 2 }] }],
            ]),
          });
          const { rows } = summary(input);
          for (const r of rows) {
            const sum = Object.values(r.lines).reduce((t, l) => t + parseDecimal(l.amount), 0n);
            expect(parseDecimal(r.profit ?? "0")).toBe(sum);
          }
          const total = totalSkuPnl(rows, "CAD");
          expect(parseDecimal(total.profit ?? "0")).toBe(
            rows.reduce((t, r) => t + parseDecimal(r.profit ?? "0"), 0n),
          );
          expect(total.unitsSold).toBe(orders.reduce((t, o) => t + o.units, 0));
        },
      ),
    );
  });
});

describe("splitUnits", () => {
  it("always adds up exactly", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
        fc.array(fc.bigInt({ min: 0n, max: 1_000_000n }), { minLength: 1, maxLength: 6 }),
        (units, weights) => {
          expect(splitUnits(units, weights).reduce((t, v) => t + v, 0n)).toBe(units);
        },
      ),
    );
  });
});

describe("marketplace rows by SKU", () => {
  it("reads Noon's columns, one unit per order row", () => {
    const zero = Object.fromEntries(
      [
        "netProceeds",
        "referralFee",
        "fulfilmentFee",
        "shippingCredits",
        "otherOrderFees",
        "orderSubsidies",
        "nonOrderFees",
        "nonOrderSubsidies",
        "others",
      ].map((f) => [f, "0"]),
    ) as Parameters<typeof noonSkuRows>[0]["amounts"];
    const rows = noonSkuRows({
      orderNr: "N1",
      sku: "Z123",
      partnerSku: "MUG-1",
      transactionDate: "2026-09-03",
      transactionType: "Order",
      advertising: false,
      amounts: {
        ...zero,
        netProceeds: "50.0000",
        referralFee: "-7.5000",
        fulfilmentFee: "-6.0000",
      },
      total: "36.5000",
    });
    expect(rows).toEqual([
      expect.objectContaining({ sku: "MUG-1", kind: "sales", amount: "50.0000", quantity: 1 }),
      expect.objectContaining({ kind: "referral", amount: "-7.5000" }),
      expect.objectContaining({ kind: "fulfilment", amount: "-6.0000" }),
    ]);
    expect(
      noonSkuRows({
        orderNr: null,
        sku: null,
        partnerSku: null,
        transactionDate: "2026-09-03",
        transactionType: "Statement Fee",
        advertising: true,
        amounts: zero,
        total: "-20.0000",
      }),
    ).toEqual([expect.objectContaining({ kind: "advertising", amount: "-20.0000" })]);
  });

  it("splits eBay's sale into the sale before fees and the fees", () => {
    expect(
      ebaySkuRows({
        orderId: "E1",
        transactionDate: "2026-09-03",
        transactionType: "SALE",
        feeType: null,
        amount: "87.0000",
        fees: "13.0000",
      }),
    ).toEqual([
      expect.objectContaining({ kind: "sales", amount: "100.0000" }),
      expect.objectContaining({ kind: "referral", amount: "-13.0000" }),
    ]);
  });

  it("reads Walmart's PO, SKU and quantity columns", () => {
    const columns = [
      "Walmart.com PO #",
      "Partner Item ID",
      "Qty",
      "Transaction Type",
      "Amount Type",
      "Amount",
    ];
    const layout = walmartLayout(columns);
    if (!layout) throw new Error("layout");
    const cols = walmartSkuColumns(columns);
    expect(cols).toEqual({ order: "Walmart.com PO #", sku: "Partner Item ID", quantity: "Qty" });
    const cell = (amountType: string, amount: string) =>
      walmartSkuRow(
        {
          "Walmart.com PO #": "W1",
          "Partner Item ID": "MUG-1",
          Qty: "2",
          "Transaction Type": "Sale",
          "Amount Type": amountType,
          Amount: amount,
        },
        layout,
        cols,
        "2026-09-10",
      );
    expect(cell("Product Price", "40.0000")).toMatchObject({
      orderRef: "W1",
      sku: "MUG-1",
      kind: "sales",
      quantity: 2,
    });
    expect(cell("Commission on Product", "-6.0000")).toMatchObject({
      kind: "referral",
      quantity: 0,
    });
  });
});

describe("waterfall and CSV", () => {
  const { rows } = summary(
    base({
      lines: [line({ gross: "40.0000" })],
      rows: [
        money({ kind: "sales", amount: "40.0000" }),
        money({ kind: "referral", amount: "-6.0000" }),
      ],
    }),
  );
  it("runs each line down to the profit", () => {
    const steps = skuWaterfall(rowOf(rows, "MUG-1"));
    expect(steps.map((s) => [s.line, s.after])).toEqual([
      ["grossSales", "40.0000"],
      ["referral", "34.0000"],
      ["cogs", "29.0000"],
      ["profit", "29.0000"],
    ]);
  });
  it("has a value for every column", () => {
    const csv = skuPnlCsvRows([{ name: "Amazon.ca", currency: "CAD", rows }], (v) => v ?? "");
    expect(csv[0]).toHaveLength(SKU_PNL_COLUMNS.length);
    expect(csv[0]?.slice(0, 4)).toEqual(["Amazon.ca", "CAD", "MUG-1", ""]);
  });
});

import { describe, expect, it } from "vitest";
import {
  monthRange,
  nextNoonWindow,
  parseNoonTransactions,
  readNoonDate,
  sumNoonAmounts,
} from "../commerce/noon-transactions";

// Noon's header exactly as the transaction view prints it (its spelling of "Fullfilment" too).
const HEADER =
  "Contract,Contract Title,Reference Nr,Order Nr,Item Nr,Order Date,Transaction Date,Title,SKUs,Partner SKUs,Transaction Type,Currency,Net Proceeds,Referral Fee including VAT,Fullfilment & Logistics Fees including VAT,Shipping Credits including VAT,Other Order Fees including VAT,Order Subsidies including VAT,Non-Order Fees including VAT,Non-Order Subsidies including VAT,Others including VAT,Total";
// Synthetic rows.
const SALE =
  'C1,Noon UAE,REF-1,NAE001,ITEM-1,2026-09-28,2026-09-30,"Mug, maple",Z1,MUG-1,Order,AED,100.00,-8.40,-6.30,0,0,2.00,0,0,0,87.30';
const FEE_LATER =
  "C1,Noon UAE,REF-1,NAE001,ITEM-1,2026-09-28,2026-10-02,,Z1,MUG-1,Order Update,AED,0,-0.50,0,0,0,0,0,0,0,-0.50";
const STORAGE = "C1,Noon UAE,REF-9,,,,02/10/2026,,,,Storage Fee,AED,0,0,0,0,0,0,-12.00,0,0,-12.00";

describe("parseNoonTransactions", () => {
  it("reads each row's columns, dates and amounts", () => {
    const parsed = parseNoonTransactions([HEADER, SALE, FEE_LATER, STORAGE].join("\r\n"));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toMatchObject({
      contract: "Noon UAE",
      referenceNr: "REF-1",
      orderNr: "NAE001",
      itemNr: "ITEM-1",
      orderDate: "2026-09-28",
      transactionDate: "2026-09-30",
      title: "Mug, maple",
      sku: "Z1",
      partnerSku: "MUG-1",
      transactionType: "Order",
      currency: "AED",
      total: "87.3000",
      balanced: true,
    });
    expect(parsed.rows[0]?.amounts).toMatchObject({
      netProceeds: "100.0000",
      referralFee: "-8.4000",
      fulfilmentFee: "-6.3000",
      orderSubsidies: "2.0000",
    });
    // Day first, as Noon prints it.
    expect(parsed.rows[2]).toMatchObject({ transactionDate: "2026-10-02", orderNr: null });
    expect(parsed).toMatchObject({ skipped: 0, from: "2026-09-30", to: "2026-10-02" });
  });

  it("gives the same row the same key in any copy, and numbers rows that look alike", () => {
    const once = parseNoonTransactions([HEADER, SALE, FEE_LATER].join("\n"));
    const again = parseNoonTransactions([HEADER, FEE_LATER, SALE].join("\n"));
    if (!once.ok || !again.ok) throw new Error("not parsed");
    expect(new Set(once.rows.map((r) => r.key))).toEqual(new Set(again.rows.map((r) => r.key)));
    const twice = parseNoonTransactions([HEADER, STORAGE, STORAGE].join("\n"));
    if (!twice.ok) throw new Error("not parsed");
    expect(twice.rows[0]?.key).not.toBe(twice.rows[1]?.key);
  });

  it("flags a row whose columns don't add up to its total, and skips unreadable rows", () => {
    const off = SALE.replace(/87\.30$/, "90.00");
    const parsed = parseNoonTransactions([HEADER, off, "C1,,,,,,,,,,,,,,,,,,,,,", ",,"].join("\n"));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows[0]?.balanced).toBe(false);
    expect(parsed.skipped).toBe(1);
  });

  it("finds every money column in Noon's real header", () => {
    // Each column a different amount, so a column read into the wrong field shows.
    const row = "C1,T,REF-2,N2,I2,2026-09-01,2026-09-01,,,,Order,AED,1,2,3,4,5,6,7,8,9,45";
    const parsed = parseNoonTransactions([HEADER, row].join("\n"));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows[0]?.amounts).toEqual({
      netProceeds: "1.0000",
      referralFee: "2.0000",
      fulfilmentFee: "3.0000",
      shippingCredits: "4.0000",
      otherOrderFees: "5.0000",
      orderSubsidies: "6.0000",
      nonOrderFees: "7.0000",
      nonOrderSubsidies: "8.0000",
      others: "9.0000",
    });
    expect(parsed.rows[0]).toMatchObject({ total: "45.0000", balanced: true });
  });

  it("says when the file isn't the transaction view", () => {
    expect(parseNoonTransactions("Date,Description,Amount\n2026-10-01,x,1")).toMatchObject({
      ok: false,
    });
    expect(parseNoonTransactions("")).toMatchObject({ ok: false });
  });
});

describe("dates and months", () => {
  it("reads Noon's date formats", () => {
    expect(readNoonDate("2026-10-01 14:03:00")).toBe("2026-10-01");
    expect(readNoonDate("1/10/2026")).toBe("2026-10-01");
    expect(readNoonDate("01-Oct-2026")).toBe("2026-10-01");
    expect(readNoonDate("1 October 2026")).toBe("2026-10-01");
    expect(readNoonDate("Oct 1, 2026")).toBe("2026-10-01");
    expect(readNoonDate("13/13/2026")).toBeNull();
    expect(readNoonDate("")).toBeNull();
  });

  it("gives a month's first and last day", () => {
    expect(monthRange("2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("sums each money column", () => {
    const parsed = parseNoonTransactions([HEADER, SALE, FEE_LATER].join("\n"));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(sumNoonAmounts(parsed.rows)).toMatchObject({
      netProceeds: "100.0000",
      referralFee: "-8.9000",
      total: "86.8000",
    });
  });
});

describe("nextNoonWindow", () => {
  const now = Date.parse("2026-10-09T08:00:00Z");
  it("starts a year back, a calendar month at a time", () => {
    expect(nextNoonWindow({ through: null, refreshedAt: null }, "2026-10-09", now)).toEqual({
      from: "2025-10-01",
      to: "2025-10-31",
      refresh: false,
    });
    expect(nextNoonWindow({ through: "2026-02-28", refreshedAt: null }, "2026-10-09", now)).toEqual(
      { from: "2026-03-01", to: "2026-03-31", refresh: false },
    );
  });

  it("stops at yesterday, then reads the last three weeks again every six hours", () => {
    expect(nextNoonWindow({ through: "2026-09-30", refreshedAt: null }, "2026-10-09", now)).toEqual(
      { from: "2026-10-01", to: "2026-10-08", refresh: false },
    );
    expect(nextNoonWindow({ through: "2026-10-08", refreshedAt: null }, "2026-10-09", now)).toEqual(
      { from: "2026-09-18", to: "2026-10-08", refresh: true },
    );
    expect(
      nextNoonWindow(
        { through: "2026-10-08", refreshedAt: "2026-10-09T05:00:00Z" },
        "2026-10-09",
        now,
      ),
    ).toBeNull();
  });
});

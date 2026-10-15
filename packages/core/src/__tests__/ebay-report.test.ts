import { describe, expect, it } from "vitest";
import {
  type EbaySum,
  ebayGroupTotals,
  parseEbayTransactionReport,
  readEbayReportAmount,
  readEbayReportDate,
} from "../index";

// Synthetic, in the shape Seller Hub downloads: eBay's lines first, then the table.
const REPORT = [
  '"Transaction report"',
  '"Seller ID: synthetic_seller"',
  '"Date range: Aug 1, 2026 - Aug 31, 2026"',
  "",
  '"Transaction creation date","Type","Order number","Legacy order ID","Buyer username","Buyer name","Net amount","Payout currency","Payout date","Payout ID","Payout status","Item ID","Transaction ID","Item title","Custom label","Quantity","Item subtotal","Final Value Fee - fixed","Final Value Fee - variable","International fee","eBay collected tax","Transaction currency","Reference ID","Description"',
  '"Aug 3, 2026","Order","01-11111-22222","--","synthetic_buyer","Synthetic Buyer","36.75","CAD","Aug 5, 2026","PO-9","Succeeded","1001","T-1","Mug","MUG-1","1","43.00","-0.40","-5.85","--","4.30","CAD","--","--"',
  '"Aug 9, 2026","Refund","01-11111-22222","--","synthetic_buyer","Synthetic Buyer","-10.20","CAD","--","--","--","1001","T-1","Mug","MUG-1","1","-11.00","--","0.80","--","--","CAD","--","--"',
  '"Aug 12, 2026","Other fee","--","--","--","--","-4.50","CAD","--","--","--","--","--","--","--","--","--","--","--","--","--","CAD","--","Promoted Listings - General fee"',
  '"Aug 12, 2026","Other fee","--","--","--","--","-4.50","CAD","--","--","--","--","--","--","--","--","--","--","--","--","--","CAD","--","Promoted Listings - General fee"',
  '"Aug 14, 2026","Shipping label","01-11111-22222","--","--","--","-12.65","CAD","--","--","--","--","--","--","--","--","--","--","--","--","--","CAD","--","--"',
  '"Aug 15, 2026","Hold","--","--","--","--","-5.00","CAD","--","--","--","--","--","--","--","--","--","--","--","--","--","CAD","--","--"',
  '"Aug 5, 2026","Payout","--","--","--","--","-22.10","CAD","Aug 5, 2026","PO-9","Succeeded","--","--","--","--","--","--","--","--","--","--","CAD","--","--"',
  '"","Order","x","","","","oops","CAD","","","","","","","","","","","","","","","",""',
].join("\n");

describe("readEbayReportDate", () => {
  it("reads the ways eBay prints a day", () => {
    expect(readEbayReportDate("Aug 3, 2026")).toBe("2026-08-03");
    expect(readEbayReportDate("06-Jul-2026")).toBe("2026-07-06");
    expect(readEbayReportDate("6 Jul 2026 10:22")).toBe("2026-07-06");
    expect(readEbayReportDate("2026-07-06T10:00:00Z")).toBe("2026-07-06");
    expect(readEbayReportDate("06.07.2026")).toBe("2026-07-06");
    expect(readEbayReportDate("--")).toBeNull();
    expect(readEbayReportDate("Foo 40, 2026")).toBeNull();
  });
});

describe("readEbayReportAmount", () => {
  it("reads signs, symbols, thousands and decimal commas", () => {
    expect(readEbayReportAmount("1,234.56")).toBe("1234.5600");
    expect(readEbayReportAmount("-C $5.00")).toBe("-5.0000");
    expect(readEbayReportAmount("(5.00)")).toBe("-5.0000");
    expect(readEbayReportAmount("1.234,56")).toBe("1234.5600");
    expect(readEbayReportAmount("--")).toBeNull();
    expect(readEbayReportAmount("")).toBeNull();
  });
});

describe("parseEbayTransactionReport", () => {
  it("finds the table under eBay's lines and reads rows as the API's", () => {
    const parsed = parseEbayTransactionReport(REPORT);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.skipped).toBe(1);
    expect(parsed.ignored).toBe(1);
    expect(
      parsed.transactions.map((t) => [
        t.transactionType,
        t.transactionDate.slice(0, 10),
        t.amount,
        t.fees,
      ]),
    ).toEqual([
      ["SALE", "2026-08-03", "36.7500", "6.2500"],
      ["REFUND", "2026-08-09", "-10.2000", "0.8000"],
      ["NON_SALE_CHARGE", "2026-08-12", "-4.5000", "0.0000"],
      ["NON_SALE_CHARGE", "2026-08-12", "-4.5000", "0.0000"],
      ["SHIPPING_LABEL", "2026-08-14", "-12.6500", "0.0000"],
    ]);
    const [sale, , fee1, fee2] = parsed.transactions;
    expect(sale).toMatchObject({ orderId: "01-11111-22222", currency: "CAD", ebayTax: "4.3000" });
    expect(fee1?.feeType).toBe("Promoted Listings - General fee");
    // Two identical rows stay two rows, with keys that don't change on a second upload.
    expect(fee1?.transactionId).not.toBe(fee2?.transactionId);
    expect(fee1?.transactionId.startsWith("report:")).toBe(true);
    const again = parseEbayTransactionReport(REPORT);
    expect(again.ok && again.transactions.map((t) => t.transactionId)).toEqual(
      parsed.transactions.map((t) => t.transactionId),
    );
    // No buyer details anywhere.
    expect(JSON.stringify(parsed)).not.toMatch(/synthetic_buyer|Synthetic Buyer/);
    expect(parsed.payouts).toEqual([
      {
        payoutId: "PO-9",
        status: "SUCCEEDED",
        payoutDate: "2026-08-05T00:00:00.000Z",
        currency: "CAD",
        amount: "22.1000",
        accountLast4: null,
      },
    ]);
  });

  it("groups like the API: sales before fees, fees back on a refund, ads apart", () => {
    const parsed = parseEbayTransactionReport(REPORT);
    if (!parsed.ok) throw new Error(parsed.error);
    const sums: EbaySum[] = parsed.transactions.map((t) => ({
      transactionType: t.transactionType,
      feeType: t.feeType,
      rows: 1,
      amount: t.amount,
      fees: t.fees,
    }));
    const { groups } = ebayGroupTotals(sums);
    expect(groups.sales).toBe(430_000n);
    expect(groups.refunds).toBe(-110_000n);
    expect(groups.fees).toBe(-54_500n);
    expect(groups.advertising).toBe(-90_000n);
    expect(groups.shipping).toBe(-126_500n);
  });

  it("reads semicolon files and says what's wrong with others", () => {
    const semi = REPORT.split("\n")
      .map((l) => l.replaceAll('","', '";"'))
      .join("\n");
    const parsed = parseEbayTransactionReport(semi);
    expect(parsed.ok && parsed.transactions.length).toBe(5);
    expect(parseEbayTransactionReport("")).toEqual({ ok: false, error: "The file is empty." });
    const other = parseEbayTransactionReport("Date,Description,Amount\n2026-08-01,Coffee,4.00");
    expect(other.ok).toBe(false);
  });
});

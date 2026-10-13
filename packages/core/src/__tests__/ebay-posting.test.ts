import { describe, expect, it } from "vitest";
import type { EbaySum } from "../commerce/ebay-finances";
import { buildEbayEntry, ebayMonthNet } from "../commerce/ebay-posting";

const sums: EbaySum[] = [
  { transactionType: "SALE", feeType: null, rows: 2, amount: "52.20", fees: "7.80" },
  { transactionType: "REFUND", feeType: null, rows: 1, amount: "-26.10", fees: "1.20" },
  { transactionType: "NON_SALE_CHARGE", feeType: "AD_FEE", rows: 1, amount: "-2.50", fees: "0" },
  { transactionType: "SHIPPING_LABEL", feeType: null, rows: 1, amount: "-9.15", fees: "0" },
  { transactionType: "TRANSFER", feeType: null, rows: 1, amount: "-10.00", fees: "0" },
];

describe("buildEbayEntry", () => {
  it("posts each group to its account (or its fallback) and the net to the eBay balance", () => {
    const built = buildEbayEntry({
      sums,
      accounts: { sales: "S", fees: "F", transfers: "BANK", balance: "BAL" },
    });
    expect(built).toEqual({
      ok: true,
      net: "4.4500",
      lines: [
        { accountId: "S", amount: "-32.7000", description: "Sales, Refunds and disputes" },
        {
          accountId: "F",
          amount: "18.2500",
          description: "eBay's fees, Advertising, Shipping labels",
        },
        { accountId: "BANK", amount: "10.0000", description: "Money moved (not earnings)" },
        { accountId: "BAL", amount: "4.4500", description: "eBay balance" },
      ],
    });
    expect(ebayMonthNet(sums)).toBe("4.4500");
  });

  it("says what's missing", () => {
    expect(buildEbayEntry({ sums, accounts: { sales: "S", fees: "F" } })).toEqual({
      ok: false,
      error: "Choose the eBay balance account first.",
    });
    expect(buildEbayEntry({ sums, accounts: { sales: "S", fees: "F", balance: "BAL" } })).toEqual({
      ok: false,
      error: "Choose an account for “Money moved in or out of your eBay balance”.",
    });
    expect(
      buildEbayEntry({
        sums,
        accounts: { sales: "BAL", fees: "F", transfers: "B", balance: "BAL" },
      }),
    ).toMatchObject({ ok: false });
  });
});

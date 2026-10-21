import { describe, expect, it } from "vitest";
import {
  buildWalmartEntry,
  emptyWalmartGroups,
  walmartLayout,
  walmartProfitTotals,
  walmartRowGroup,
  walmartSettlementProblem,
  walmartSettlementTotals,
} from "../commerce/walmart-posting";

const columns = [
  "Period Start Date",
  "Period End Date",
  "Total Payout",
  "Transaction Type",
  "Amount",
  "Amount Type",
];
const row = (transactionType: string, amount: string, amountType: string) => ({
  "Transaction Type": transactionType,
  Amount: amount,
  "Amount Type": amountType,
});
const rows = [
  row("Sale", "39.98", "Product Price"),
  row("Sale", "5.00", "Shipping Price"),
  row("Sale", "-6.00", "Commission on Product"),
  row("Sale", "2.60", "Product tax"),
  row("Sale", "-2.60", "Product tax withheld"),
  row("Refund", "-19.99", "Product Price"),
  row("Refund", "3.00", "Commission on Product"),
  row("Sale", "-1.90", "Walmart Fulfillment Services Fee"),
  row("Adjustment", "-4.25", "Sponsored Products"),
  row("Adjustment", "1.50", "Reimbursement"),
  row("Deposited in HYPERWALLET account", "-17.34", "Payment"),
];

describe("walmartLayout", () => {
  it("finds the amount, amount type and transaction type columns", () => {
    expect(walmartLayout(columns)).toEqual({
      amount: "Amount",
      amountType: "Amount Type",
      transactionType: "Transaction Type",
      description: null,
    });
  });
  it("is null without an amount column", () => {
    expect(walmartLayout(["Period Start Date", "Total Payout"])).toBeNull();
  });
});

describe("walmartRowGroup", () => {
  const layout = walmartLayout(columns);
  if (!layout) throw new Error("no layout");
  it.each([
    [row("Sale", "1", "Product Price"), "sales"],
    [row("Sale", "1", "Gift Wrap Price"), "sales"],
    [row("Refund", "-1", "Product Price"), "refunds"],
    [row("Refund", "1", "Commission on Product"), "fees"],
    [row("Sale", "1", "Product tax"), "tax"],
    [row("Sale", "-1", "WFS Storage Fee"), "fulfilment"],
    [row("Adjustment", "-1", "Walmart Connect Campaign"), "advertising"],
    [row("Adjustment", "-1", "Shipping Label"), "shipping"],
    [row("Service Fee", "-1", "Item Fees"), "fees"],
    [row("Adjustment", "1", "Reimbursement"), "other"],
    [row("Payment", "-1", ""), "payout"],
  ])("reads %o as %s", (r, group) => {
    expect(walmartRowGroup(r, layout)).toBe(group);
  });
});

describe("walmartSettlementTotals", () => {
  it("adds the rows up by group, the payout rows apart", () => {
    const totals = walmartSettlementTotals(columns, rows);
    expect(totals).toEqual({
      groups: {
        ...emptyWalmartGroups(),
        sales: 449_800n,
        refunds: -199_900n,
        fees: -30_000n,
        fulfilment: -19_000n,
        advertising: -42_500n,
        tax: 0n,
        other: 15_000n,
      },
      net: 173_400n,
      paidOut: -173_400n,
      unreadable: 0,
    });
    expect(walmartSettlementProblem(totals, "17.34")).toBeNull();
  });
  it("says when the rows don't add up to the payout, or can't be read", () => {
    const totals = walmartSettlementTotals(columns, rows);
    expect(walmartSettlementProblem(totals, "20.00")).toBe(
      "The rows add up to 17.3400, not Walmart's payout of 20.0000.",
    );
    expect(walmartSettlementProblem(walmartSettlementTotals(["Total Payout"], []), null)).toMatch(
      /no Amount column/,
    );
    const bad = walmartSettlementTotals(columns, [row("Sale", "abc", "Product Price")]);
    expect(walmartSettlementProblem(bad, null)).toBe("1 row has an amount that couldn't be read.");
  });
});

describe("buildWalmartEntry", () => {
  const groups = walmartSettlementTotals(columns, rows)?.groups ?? emptyWalmartGroups();
  it("posts each group to its account (or its fallback) and the net to the Walmart balance", () => {
    expect(
      buildWalmartEntry({ groups, accounts: { sales: "S", fees: "F", balance: "BAL" } }),
    ).toEqual({
      ok: true,
      net: "17.3400",
      lines: [
        { accountId: "S", amount: "-24.9900", description: "Sales, Refunds" },
        {
          accountId: "F",
          amount: "7.6500",
          description: "Walmart's fees, WFS fees, Advertising, Other",
        },
        { accountId: "BAL", amount: "17.3400", description: "Walmart balance" },
      ],
    });
  });
  it("says what's missing, in plain words", () => {
    expect(buildWalmartEntry({ groups, accounts: { sales: "S" } })).toEqual({
      ok: false,
      error: "Choose the Walmart balance account first.",
    });
    expect(buildWalmartEntry({ groups, accounts: { sales: "S", balance: "BAL" } })).toEqual({
      ok: false,
      error: "Choose an account for “Walmart's fees”.",
    });
    expect(
      buildWalmartEntry({ groups, accounts: { sales: "S", fees: "BAL", balance: "BAL" } }),
    ).toEqual({
      ok: false,
      error:
        "“Walmart's fees” can't go to the Walmart balance account itself. Choose another account.",
    });
    expect(buildWalmartEntry({ groups: emptyWalmartGroups(), accounts: { balance: "B" } })).toEqual(
      { ok: false, error: "This settlement has nothing to post." },
    );
  });
});

describe("walmartProfitTotals", () => {
  it("puts WFS fees with the fees and labels with other, converted", () => {
    const groups = {
      ...emptyWalmartGroups(),
      sales: 100_0000n,
      fees: -15_0000n,
      fulfilment: -4_0000n,
      shipping: -2_0000n,
      tax: 1_0000n,
    };
    const totals = walmartProfitTotals(groups, (u) => u * 2n);
    expect(totals).toMatchObject({
      sales: 200_0000n,
      fees: -38_0000n,
      other: -4_0000n,
      tax: 2_0000n,
    });
  });
});

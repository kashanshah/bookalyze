import { describe, expect, it } from "vitest";
import {
  buildNoonEntry,
  monthEnd,
  type NoonSum,
  noonGroupTotals,
  noonMonthState,
  noonTypeKey,
} from "../commerce/noon-posting";
import { NOON_AMOUNT_FIELDS } from "../commerce/noon-transactions";
import { parseDecimal as u } from "../money";

const zero = Object.fromEntries(NOON_AMOUNT_FIELDS.map((f) => [f, "0"])) as NoonSum["amounts"];
const row = (
  transactionType: string,
  total: string,
  amounts: Partial<NoonSum["amounts"]> = {},
  advertising = false,
): NoonSum => ({ transactionType, total, amounts: { ...zero, ...amounts }, advertising });

// Synthetic: a sale, a return, an advertising fee, a transfer and a payout.
const MONTH = [
  row("order", "87.30", {
    netProceeds: "100",
    referralFee: "-8.40",
    fulfilmentFee: "-6.30",
    orderSubsidies: "2",
  }),
  row("Order Update", "-20", { netProceeds: "-25", referralFee: "5" }),
  row("statement_fee", "-30", { nonOrderFees: "-30" }, true),
  row("balance_transfer", "-12", { others: "-12" }),
  row("payment", "-50", { others: "-50" }),
];

describe("noonGroupTotals", () => {
  it("groups a month's rows, leaving payouts out", () => {
    const { groups, earned, paidOut } = noonGroupTotals(MONTH);
    expect(groups).toEqual({
      sales: u("100"),
      refunds: u("-25"),
      fees: u("-9.70"),
      advertising: u("-30"),
      shippingCredits: 0n,
      subsidies: u("2"),
      transfers: u("-12"),
      other: 0n,
    });
    expect(earned).toBe(u("25.30")); // 87.30 - 20 - 30 - 12
    expect(paidOut).toBe(u("50"));
  });

  it("puts what a row's columns don't explain in Other, and other statement fees in fees", () => {
    const { groups, earned } = noonGroupTotals([
      row("order", "90", { netProceeds: "100", referralFee: "-8.40" }),
      row("statement_fee", "-5", { nonOrderFees: "-5" }),
    ]);
    expect(groups.other).toBe(u("-1.60"));
    expect(groups.fees).toBe(u("-13.40"));
    expect(earned).toBe(u("85"));
  });

  it("reads Noon's type names either way", () => {
    expect(noonTypeKey("Order Update")).toBe("order_update");
    expect(noonTypeKey(" balance_transfer ")).toBe("balance_transfer");
  });
});

describe("buildNoonEntry", () => {
  const { groups } = noonGroupTotals(MONTH);
  it("credits income, debits costs, and puts the net in the Noon balance", () => {
    const built = buildNoonEntry({
      groups,
      accounts: {
        sales: "sales",
        fees: "fees",
        subsidies: "subsidies",
        transfers: "other-charges",
        balance: "noon",
      },
    });
    if (!built.ok) throw new Error(built.error);
    expect(built.earned).toBe("25.3000");
    expect(built.lines).toEqual([
      { accountId: "sales", amount: "-75.0000", description: "Sales, Returns and order changes" },
      { accountId: "fees", amount: "39.7000", description: "Noon's fees, Advertising" },
      { accountId: "subsidies", amount: "-2.0000", description: "Noon's subsidies" },
      {
        accountId: "other-charges",
        amount: "12.0000",
        description: "Moved to another Noon contract",
      },
      { accountId: "noon", amount: "25.3000", description: "Noon balance" },
    ]);
  });

  it("says which account is missing", () => {
    expect(buildNoonEntry({ groups, accounts: { sales: "s" } })).toEqual({
      ok: false,
      error: "Choose the Noon balance account first.",
    });
    expect(
      buildNoonEntry({ groups, accounts: { sales: "s", fees: "f", balance: "n", subsidies: "x" } }),
    ).toEqual({ ok: false, error: "Choose an account for “Moved to another Noon contract”." });
  });
});

describe("noonMonthState", () => {
  const base = { today: "2026-10-09", postFrom: "2026-03-01" };
  const current = { earned: "25.30", rows: 4 };
  it("knows posted, changed, ready, in progress and before", () => {
    expect(noonMonthState({ ...base, month: "2026-09", posted: null, current })).toBe("ready");
    expect(noonMonthState({ ...base, month: "2026-10", posted: null, current })).toBe("inProgress");
    expect(noonMonthState({ ...base, month: "2026-02", posted: null, current })).toBe("before");
    expect(
      noonMonthState({ ...base, month: "2026-09", posted: { earned: "25.3", rows: 4 }, current }),
    ).toBe("posted");
    expect(
      noonMonthState({ ...base, month: "2026-09", posted: { earned: "26", rows: 4 }, current }),
    ).toBe("changed");
    expect(
      noonMonthState({ ...base, postFrom: null, month: "2026-09", posted: null, current }),
    ).toBe("notSetUp");
    expect(
      noonMonthState({
        ...base,
        month: "2026-09",
        posted: null,
        current: { earned: "0", rows: 0 },
      }),
    ).toBe("empty");
    expect(noonMonthState({ ...base, month: "2026-09", posted: null, current, empty: true })).toBe(
      "empty",
    );
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });
});

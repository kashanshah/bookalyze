import { describe, expect, it } from "vitest";
import { type LedgerAccount, prepareJournalEntry } from "../accounting/journal";
import {
  describeTransaction,
  isMoneyAccountSubtype,
  restateAmounts,
  transactionLines,
} from "../accounting/transactions";

const accounts = new Map<string, LedgerAccount>(
  [
    { id: "bank", name: "Chequing", currency: "CAD", isArchived: false },
    { id: "card", name: "Visa", currency: "CAD", isArchived: false },
    { id: "sales", name: "Sales", currency: null, isArchived: false },
    { id: "fees", name: "Fees", currency: null, isArchived: false },
    { id: "rent", name: "Rent", currency: null, isArchived: false },
  ].map((a) => [a.id, a]),
);
const isMoney = (id: string) => id === "bank" || id === "card";
const prepare = (lines: ReturnType<typeof transactionLines>) =>
  prepareJournalEntry({ currency: "CAD", baseCurrency: "CAD", lines }, accounts);

describe("transactions", () => {
  it("knows which subtypes hold money", () => {
    expect(isMoneyAccountSubtype("cash_bank")).toBe(true);
    expect(isMoneyAccountSubtype("credit_card")).toBe(true);
    expect(isMoneyAccountSubtype("income")).toBe(false);
  });

  it("turns a split deposit into balanced lines and back", () => {
    // An Amazon payout: 100 of sales, less 15.50 of fees, so 84.50 reaches the bank.
    const lines = transactionLines(
      {
        kind: "deposit",
        moneyAccountId: "bank",
        splits: [
          { accountId: "sales", amount: "100" },
          { accountId: "fees", amount: "-15.50", description: "Marketplace fees" },
        ],
      },
      "Amazon payout",
    );
    const result = prepare(lines);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.lines.map((l) => [l.accountId, l.amount])).toEqual([
      ["bank", "84.5000"],
      ["sales", "-100.0000"],
      ["fees", "15.5000"],
    ]);
    expect(describeTransaction(result.entry.lines, isMoney)).toEqual({
      kind: "deposit",
      amount: "84.5000",
      moneyAccountIds: ["bank"],
      splits: [
        { accountId: "sales", amount: "100.0000", description: undefined },
        { accountId: "fees", amount: "-15.5000", description: "Marketplace fees" },
      ],
    });
  });

  it("refuses a transaction whose splits net to zero or less", () => {
    const lines = transactionLines({
      kind: "deposit",
      moneyAccountId: "bank",
      splits: [
        { accountId: "sales", amount: "10" },
        { accountId: "fees", amount: "-10" },
      ],
    });
    expect(lines[0]).toMatchObject({ debit: "" });
    expect(prepare(lines).ok).toBe(false);
  });

  it("describes a card expense as money out", () => {
    const result = prepare(
      transactionLines({
        kind: "withdrawal",
        moneyAccountId: "card",
        splits: [{ accountId: "rent", amount: "1200" }],
      }),
    );
    if (!result.ok) throw new Error("expected valid");
    expect(describeTransaction(result.entry.lines, isMoney)).toMatchObject({
      kind: "withdrawal",
      amount: "1200.0000",
      moneyAccountIds: ["card"],
      splits: [{ accountId: "rent", amount: "1200.0000" }],
    });
  });

  it("describes transfers between money accounts", () => {
    const result = prepare(
      transactionLines({
        kind: "transfer",
        fromAccountId: "bank",
        toAccountId: "card",
        amount: "500",
      }),
    );
    if (!result.ok) throw new Error("expected valid");
    expect(describeTransaction(result.entry.lines, isMoney)).toEqual({
      kind: "transfer",
      amount: "500.0000",
      moneyAccountIds: ["card", "bank"],
      fromAccountId: "bank",
      toAccountId: "card",
      splits: [],
    });
  });

  it("ignores entries that don't touch money", () => {
    expect(
      describeTransaction(
        [
          { accountId: "rent", amount: "5" },
          { accountId: "sales", amount: "-5" },
        ],
        isMoney,
      ),
    ).toBeNull();
  });

  it("reads an Uncategorized stand-in as money out of an account nobody chose", () => {
    const isPlaceholder = (id: string) => id === "unc-income" || id === "unc-expense";
    expect(
      describeTransaction(
        [
          { accountId: "unc-income", amount: "-90.39" },
          { accountId: "fees", amount: "90.39" },
        ],
        isMoney,
        isPlaceholder,
      ),
    ).toMatchObject({
      kind: "withdrawal",
      amount: "90.3900",
      moneyAccountIds: [],
      splits: [{ accountId: "fees", amount: "90.3900" }],
      needsAccount: true,
    });
    // Both sides Uncategorized: the credit is the money that went out.
    expect(
      describeTransaction(
        [
          { accountId: "unc-income", amount: "-164.07" },
          { accountId: "unc-expense", amount: "164.07" },
        ],
        isMoney,
        isPlaceholder,
      ),
    ).toMatchObject({
      kind: "withdrawal",
      amount: "164.0700",
      splits: [{ accountId: "unc-expense", amount: "164.0700" }],
    });
    // Without a stand-in, an entry that doesn't touch money still isn't a transaction.
    expect(
      describeTransaction(
        [
          { accountId: "rent", amount: "5" },
          { accountId: "sales", amount: "-5" },
        ],
        isMoney,
        isPlaceholder,
      ),
    ).toBeNull();
  });

  it("leaves the money line empty when splits have no amount yet", () => {
    const lines = transactionLines({
      kind: "withdrawal",
      moneyAccountId: "bank",
      splits: [{ accountId: "rent", amount: "" }],
    });
    expect(lines[0]).toMatchObject({ accountId: "bank", credit: "" });
  });
});

describe("transactions recorded half in the main currency", () => {
  it("shows the categories in the money account's currency", () => {
    // Corrected from Wise before categories moved too: bank US$-200 (CA$-283.27), category CA$283.27.
    const view = describeTransaction(
      [
        { accountId: "usd", currency: "USD", amount: "-200.0000", baseAmount: "-283.2700" },
        { accountId: "fees", currency: "CAD", amount: "200.0000", baseAmount: "200.0000" },
        { accountId: "rent", currency: "CAD", amount: "83.2700", baseAmount: "83.2700" },
      ],
      (id) => id === "usd",
    );
    expect(view?.amount).toBe("200.0000");
    // 200 × 200/283.27 = 141.21 and 83.27 × 200/283.27 = 58.79: they add up to 200 exactly.
    expect(view?.splits.map((s) => s.amount)).toEqual(["141.2100", "58.7900"]);
  });

  it("restates amounts with the rounding on the largest line", () => {
    expect(
      restateAmounts(
        ["1.00", "1.00", "1.00"],
        { amount: "1.00", baseAmount: "3.00" },
        "USD",
        "1.00",
      ),
    ).toEqual(["0.3400", "0.3300", "0.3300"]);
  });
});

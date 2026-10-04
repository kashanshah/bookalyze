import { describe, expect, it } from "vitest";
import { type LedgerAccount, prepareJournalEntry } from "../accounting/journal";
import {
  describeTransaction,
  isMoneyAccountSubtype,
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

  it("leaves the money line empty when splits have no amount yet", () => {
    const lines = transactionLines({
      kind: "withdrawal",
      moneyAccountId: "bank",
      splits: [{ accountId: "rent", amount: "" }],
    });
    expect(lines[0]).toMatchObject({ accountId: "bank", credit: "" });
  });
});

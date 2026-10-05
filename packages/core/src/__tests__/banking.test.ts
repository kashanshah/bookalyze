import { describe, expect, it } from "vitest";
import { transactionLines } from "../accounting/transactions";
import { type BankTransaction, bankTransactionInput, pairConversions } from "../banking/feed";
import {
  localDate,
  parseWiseBalances,
  parseWiseProfiles,
  parseWiseStatement,
  wiseAmount,
} from "../banking/wise";

// Shapes as Wise documents them; names and numbers are synthetic.
const statement = {
  transactions: [
    {
      type: "DEBIT",
      date: "2026-03-01T03:47:05.832Z",
      amount: { value: -7.76, currency: "USD" },
      totalFees: { value: 0.04, currency: "USD" },
      details: {
        type: "CARD",
        description: "Card transaction of 6.80 GBP issued by Example Cafe",
        merchant: { name: "Example Cafe" },
      },
      runningBalance: { value: 16.01, currency: "USD" },
      referenceNumber: "CARD-1001",
    },
    {
      type: "CREDIT",
      date: "2026-03-02T15:00:00.000Z",
      amount: { value: 200, currency: "USD" },
      totalFees: { value: 0, currency: "USD" },
      details: {
        type: "DEPOSIT",
        description: "Received money from Example Client",
        senderName: "Example Client",
        paymentReference: "INV-12",
      },
      referenceNumber: "TRANSFER-2002",
    },
    {
      type: "CREDIT",
      date: "2026-03-03T12:00:00.000Z",
      amount: { value: 9.94, currency: "USD" },
      totalFees: { value: 0, currency: "USD" },
      details: {
        type: "CONVERSION",
        description: "Converted 13.50 CAD to 9.94 USD",
        sourceAmount: { value: 13.5, currency: "CAD" },
        targetAmount: { value: 9.94, currency: "USD" },
      },
      referenceNumber: "CONVERSION-3003",
    },
    {
      type: "CREDIT",
      date: "2026-03-04T12:00:00Z",
      amount: { value: 0, currency: "USD" },
      referenceNumber: "ZERO-1",
    },
  ],
};

describe("Wise parsing", () => {
  it("turns JSON numbers into exact decimals at the currency's precision", () => {
    expect(wiseAmount(16.01, "USD")).toBe("16.0100");
    expect(wiseAmount(-7.76, "USD")).toBe("-7.7600");
    expect(wiseAmount(0.1 + 0.2, "USD")).toBe("0.3000");
    expect(wiseAmount(1234, "JPY")).toBe("1234.0000");
    expect(() => wiseAmount("12", "USD")).toThrow();
  });

  it("reads profiles and balances", () => {
    expect(
      parseWiseProfiles([
        { id: 1, type: "PERSONAL", fullName: "Sam Example" },
        { id: 2, type: "BUSINESS", details: { name: "Example Inc." } },
      ]),
    ).toEqual([
      { id: 1, type: "personal", name: "Sam Example" },
      { id: 2, type: "business", name: "Example Inc." },
    ]);
    expect(
      parseWiseBalances([{ id: 64, currency: "USD", amount: { value: 16.01, currency: "USD" } }]),
    ).toEqual([{ id: 64, currency: "USD", amount: "16.0100", name: null }]);
  });

  it("dates each transaction in the company's time zone", () => {
    expect(localDate("2026-03-01T03:47:05.832Z", "America/Toronto")).toBe("2026-02-28");
    expect(localDate("2026-03-01T03:47:05.832Z", "Asia/Dubai")).toBe("2026-03-01");
  });

  it("reads a statement, skipping empty lines", () => {
    const lines = parseWiseStatement(statement, 64, "America/Toronto");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      externalId: "wise:64:CARD-1001",
      date: "2026-02-28",
      amount: "-7.7600",
      fee: "0.0400",
      kind: "card",
      counterparty: "Example Cafe",
    });
    expect(lines[1]).toMatchObject({
      kind: "deposit",
      counterparty: "Example Client",
      reference: "INV-12",
    });
    expect(lines[2]).toMatchObject({
      kind: "conversion",
      conversion: { otherCurrency: "CAD", otherAmount: "13.5000" },
    });
    expect(() => parseWiseStatement({}, 64, "UTC")).toThrow();
  });
});

const accounts = {
  moneyAccountId: "bank",
  uncategorizedIncomeId: "inc",
  uncategorizedExpenseId: "exp",
  feeAccountId: "fees",
};
const base: BankTransaction = {
  externalId: "x",
  date: "2026-03-01",
  currency: "USD",
  amount: "0",
  fee: "0.0000",
  description: "",
  counterparty: null,
  reference: null,
  kind: "other",
};

describe("posting bank lines", () => {
  it("splits a card payment's fee onto the fee account", () => {
    const input = bankTransactionInput(
      { ...base, amount: "-7.7600", fee: "0.0400", kind: "card" },
      accounts,
    );
    expect(input).toEqual({
      kind: "withdrawal",
      moneyAccountId: "bank",
      splits: [
        { accountId: "exp", amount: "7.7200" },
        { accountId: "fees", amount: "0.0400", description: "Bank fee" },
      ],
    });
    // It balances as a journal entry: 7.76 out of the bank.
    const lines = transactionLines(input);
    expect(lines.find((l) => l.accountId === "bank")?.credit).toBe("7.7600");
  });

  it("records the full amount of a deposit that had a fee taken off", () => {
    expect(
      bankTransactionInput(
        { ...base, amount: "195.0000", fee: "5.0000", kind: "deposit" },
        accounts,
      ).splits,
    ).toEqual([
      { accountId: "inc", amount: "200.0000" },
      { accountId: "fees", amount: "-5.0000", description: "Bank fee" },
    ]);
  });

  it("sends a bank's own charges straight to the fee account", () => {
    expect(
      bankTransactionInput({ ...base, amount: "-2.0000", fee: "2.0000", kind: "fee" }, accounts)
        .splits,
    ).toEqual([{ accountId: "fees", amount: "2.0000" }]);
  });

  it("pairs both sides of a conversion and leaves the rest alone", () => {
    const out = {
      ...base,
      externalId: "wise:1:C-1",
      pairKey: "C-1",
      currency: "CAD",
      amount: "-13.5000",
      kind: "conversion" as const,
    };
    const into = {
      ...base,
      externalId: "wise:2:C-1",
      pairKey: "C-1",
      currency: "USD",
      amount: "9.9400",
      kind: "conversion" as const,
    };
    const lonely = {
      ...base,
      externalId: "wise:2:C-2",
      pairKey: "C-2",
      amount: "5.0000",
      kind: "conversion" as const,
    };
    const card = { ...base, externalId: "wise:1:K-1", amount: "-1.0000", kind: "card" as const };
    const { pairs, singles } = pairConversions([out, card, into, lonely]);
    expect(pairs).toEqual([{ from: out, to: into }]);
    expect(singles.map((s) => s.externalId)).toEqual(["wise:1:K-1", "wise:2:C-2"]);
  });
});

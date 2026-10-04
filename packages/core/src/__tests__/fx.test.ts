import { describe, expect, it } from "vitest";
import { cadRatesNeeded, crossRate, parseBankOfCanada } from "../accounting/fx";
import type { LedgerAccount } from "../accounting/journal";
import { describeTransaction, prepareTransfer } from "../accounting/transactions";
import { divideDecimals, multiplyDecimals, parseDecimal } from "../money";

// Shaped like a real Valet response; the numbers are made up.
const valet = {
  seriesDetail: { FXUSDCAD: { label: "USD/CAD" }, FXEURCAD: { label: "EUR/CAD" } },
  observations: [
    { d: "2026-10-01", FXUSDCAD: { v: "1.3650" }, FXEURCAD: { v: "1.4800" } },
    { d: "2026-10-02", FXUSDCAD: { v: "1.3700" }, FXEURCAD: { v: "" } },
    { d: "not-a-date", FXUSDCAD: { v: "1.1" } },
  ],
};

describe("exchange rates", () => {
  it("parses Bank of Canada observations, skipping blanks", () => {
    expect(parseBankOfCanada(valet)).toEqual([
      { date: "2026-10-01", base: "CAD", quote: "USD", rate: "1.3650" },
      { date: "2026-10-01", base: "CAD", quote: "EUR", rate: "1.4800" },
      { date: "2026-10-02", base: "CAD", quote: "USD", rate: "1.3700" },
    ]);
    expect(parseBankOfCanada({ nope: true })).toEqual([]);
  });

  it("derives any pair through CAD and the AED peg", () => {
    const cad: Record<string, string> = { USD: "1.3650", EUR: "1.4800" };
    const cadPer = (code: string) => cad[code] ?? null;
    expect(crossRate("CAD", "USD", cadPer)).toBe("1.3650000000");
    expect(crossRate("USD", "USD", cadPer)).toBe("1");
    expect(crossRate("AED", "USD", cadPer)).toBe("3.6725");
    expect(crossRate("USD", "AED", cadPer)).toBe(divideDecimals("1", "3.6725"));
    // 1 CAD in AED = 3.6725 / 1.3650
    expect(crossRate("AED", "CAD", cadPer)).toBe(divideDecimals("3.6725", "1.3650"));
    // 1 EUR in USD = 1.48 / 1.365
    expect(crossRate("USD", "EUR", cadPer)).toBe(divideDecimals("1.4800", "1.3650"));
    expect(crossRate("CAD", "PKR", cadPer)).toBeNull();
    expect(cadRatesNeeded("AED", "CAD")).toEqual(["USD"]);
    expect(cadRatesNeeded("CAD", "EUR")).toEqual(["EUR"]);
  });

  it("divides and multiplies decimals exactly", () => {
    expect(divideDecimals("1", "3")).toBe("0.3333333333");
    expect(multiplyDecimals("1000", "1.365", 4)).toBe("1365.0000");
  });
});

const accounts = new Map<string, LedgerAccount>(
  [
    { id: "rbc", name: "RBC Chequing", currency: "CAD", isArchived: false },
    { id: "wise-usd", name: "Wise USD", currency: "USD", isArchived: false },
    { id: "wise-eur", name: "Wise EUR", currency: "EUR", isArchived: false },
    { id: "rbc2", name: "RBC Savings", currency: "CAD", isArchived: false },
  ].map((a) => [a.id, a]),
);
const isMoney = () => true;

describe("transfers", () => {
  it("records what left and what arrived between currencies, priced by the base side", () => {
    const result = prepareTransfer(
      {
        fromAccountId: "wise-usd",
        toAccountId: "rbc",
        sent: "1000",
        received: "1,362.40",
        baseCurrency: "CAD",
      },
      accounts,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.currency).toBe("USD");
    expect(result.entry.fxRate).toBe("1.3624000000");
    expect(
      result.entry.lines.map((l) => [l.accountId, l.currency, l.amount, l.baseAmount]),
    ).toEqual([
      ["rbc", "CAD", "1362.4000", "1362.4000"],
      ["wise-usd", "USD", "-1000.0000", "-1362.4000"],
    ]);
    const view = describeTransaction(result.entry.lines, isMoney);
    expect(view).toMatchObject({
      kind: "transfer",
      amount: "1000.0000",
      fromAccountId: "wise-usd",
      toAccountId: "rbc",
      receivedAmount: "1362.4000",
      receivedCurrency: "CAD",
    });
  });

  it("uses the sending side when that's the base currency", () => {
    const result = prepareTransfer(
      {
        fromAccountId: "rbc",
        toAccountId: "wise-usd",
        sent: "500",
        received: "365.10",
        baseCurrency: "CAD",
      },
      accounts,
    );
    if (!result.ok) throw new Error("expected valid");
    expect(result.entry.lines.map((l) => l.baseAmount)).toEqual(["500.0000", "-500.0000"]);
  });

  it("needs a rate when neither side is the base currency", () => {
    const input = {
      fromAccountId: "wise-usd",
      toAccountId: "wise-eur",
      sent: "100",
      received: "92",
      baseCurrency: "CAD",
    };
    const missing = prepareTransfer(input, accounts);
    expect(!missing.ok && missing.errors.fxRate).toMatch(/how many CAD one USD/);
    const ok = prepareTransfer({ ...input, fxRate: "1.37" }, accounts);
    if (!ok.ok) throw new Error("expected valid");
    expect(ok.entry.lines.map((l) => l.baseAmount)).toEqual(["137.0000", "-137.0000"]);
  });

  it("asks for both amounts between currencies", () => {
    const result = prepareTransfer(
      {
        fromAccountId: "wise-usd",
        toAccountId: "rbc",
        sent: "",
        received: "",
        baseCurrency: "CAD",
      },
      accounts,
    );
    expect(!result.ok && result.errors.lines).toEqual({
      0: "Enter how much CAD arrived.",
      1: "Enter how much USD was sent.",
    });
  });

  it("keeps same-currency transfers as ordinary entries", () => {
    const result = prepareTransfer(
      { fromAccountId: "rbc", toAccountId: "rbc2", sent: "250", baseCurrency: "CAD" },
      accounts,
    );
    if (!result.ok) throw new Error("expected valid");
    expect(result.entry.lines.map((l) => [l.currency, l.amount])).toEqual([
      ["CAD", "250.0000"],
      ["CAD", "-250.0000"],
    ]);
    expect(parseDecimal(result.entry.fxRate)).toBe(parseDecimal("1"));
  });
});

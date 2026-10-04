import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type JournalLineInput,
  journalTotals,
  type LedgerAccount,
  prepareJournalEntry,
  reversingLines,
} from "../accounting/journal";
import { formatDecimal, parseDecimal } from "../money";

const accounts = new Map<string, LedgerAccount>(
  [
    { id: "bank", name: "Chequing", currency: "CAD", isArchived: false },
    { id: "usd", name: "USD account", currency: "USD", isArchived: false },
    { id: "sales", name: "Sales", currency: null, isArchived: false },
    { id: "rent", name: "Rent", currency: null, isArchived: false },
    { id: "old", name: "Old account", currency: null, isArchived: true },
  ].map((a) => [a.id, a]),
);

const cad = (lines: JournalLineInput[]) =>
  prepareJournalEntry({ currency: "CAD", baseCurrency: "CAD", lines }, accounts);

describe("prepareJournalEntry", () => {
  it("signs debits positive and credits negative", () => {
    const result = cad([
      { accountId: "rent", debit: "1,200.00" },
      { accountId: "bank", credit: "1200" },
    ]);
    expect(result).toEqual({
      ok: true,
      entry: {
        currency: "CAD",
        fxRate: "1",
        total: "1200.0000",
        lines: [
          {
            index: 0,
            accountId: "rent",
            description: null,
            currency: "CAD",
            amount: "1200.0000",
            baseAmount: "1200.0000",
          },
          {
            index: 1,
            accountId: "bank",
            description: null,
            currency: "CAD",
            amount: "-1200.0000",
            baseAmount: "-1200.0000",
          },
        ],
      },
    });
  });

  it("skips blank rows and reports per-line problems", () => {
    const result = cad([
      { accountId: "rent", debit: "10", credit: "10" },
      { accountId: "", debit: "" },
      { accountId: "", credit: "5" },
      { accountId: "old", debit: "1" },
      { accountId: "usd", debit: "1" },
      { accountId: "sales", credit: "1.234" },
      { accountId: "sales", debit: "-4" },
      { accountId: "sales" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.lines).toEqual({
      0: "Enter a debit or a credit, not both.",
      2: "Choose an account.",
      3: "Old account is archived. Choose another account.",
      4: "USD account only holds USD.",
      5: "CAD amounts have at most 2 decimal places.",
      6: "Amounts must be more than zero.",
      7: "Enter a debit or a credit.",
    });
  });

  it("requires two lines that balance", () => {
    expect(cad([{ accountId: "rent", debit: "5" }])).toEqual({
      ok: false,
      errors: { form: "An entry needs at least two lines." },
    });
    expect(
      cad([
        { accountId: "rent", debit: "5" },
        { accountId: "bank", credit: "4.5" },
      ]),
    ).toEqual({
      ok: false,
      errors: { form: "Debits and credits must be equal. They're 0.50 CAD apart." },
    });
  });

  it("requires a positive exchange rate for foreign-currency entries", () => {
    const lines = [
      { accountId: "usd", credit: "10" },
      { accountId: "rent", debit: "10" },
    ];
    const missing = prepareJournalEntry({ currency: "USD", baseCurrency: "CAD", lines }, accounts);
    expect(!missing.ok && missing.errors.fxRate).toMatch(/how many CAD one USD/);
    const zero = prepareJournalEntry(
      { currency: "USD", baseCurrency: "CAD", fxRate: "0", lines },
      accounts,
    );
    expect(!zero.ok && zero.errors.fxRate).toMatch(/more than zero/);
  });

  it("converts to the base currency and absorbs rounding on the largest line", () => {
    const result = prepareJournalEntry(
      {
        currency: "USD",
        baseCurrency: "CAD",
        fxRate: "1.3333",
        lines: [
          { accountId: "rent", debit: "0.01" },
          { accountId: "rent", debit: "0.01" },
          { accountId: "rent", debit: "0.01" },
          { accountId: "usd", credit: "0.03" },
        ],
      },
      accounts,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.fxRate).toBe("1.3333000000");
    // 0.01 × 1.3333 → 0.01 each; 0.03 × 1.3333 → 0.04; the residual lands on the credit.
    expect(result.entry.lines.map((l) => l.baseAmount)).toEqual([
      "0.0100",
      "0.0100",
      "0.0100",
      "-0.0300",
    ]);
  });

  it("always balances in both currencies (property)", () => {
    const amount = fc.integer({ min: 1, max: 10_000_000 }).map((c) => formatDecimal(BigInt(c), 2));
    fc.assert(
      fc.property(
        fc.array(amount, { minLength: 1, maxLength: 8 }),
        fc.array(amount, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 99_999_999 }).map((r) => formatDecimal(BigInt(r), 6)),
        (debits, credits, rate) => {
          // Make the two sides equal by appending the difference to the smaller side.
          const sum = (xs: string[]) => xs.reduce((t, x) => t + parseDecimal(x), 0n);
          const diff = sum(debits) - sum(credits);
          if (diff > 0n) credits.push(formatDecimal(diff));
          if (diff < 0n) debits.push(formatDecimal(-diff));
          const lines = [
            ...debits.map((d) => ({ accountId: "rent", debit: d })),
            ...credits.map((c) => ({ accountId: "usd", credit: c })),
          ];
          const result = prepareJournalEntry(
            { currency: "USD", baseCurrency: "CAD", fxRate: rate, lines },
            accounts,
          );
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const amounts = result.entry.lines.map((l) => parseDecimal(l.amount));
          const bases = result.entry.lines.map((l) => parseDecimal(l.baseAmount));
          expect(amounts.reduce((t, a) => t + a, 0n)).toBe(0n);
          expect(bases.reduce((t, a) => t + a, 0n)).toBe(0n);
          // Base amounts are whole cents.
          for (const b of bases) expect(b % 100n).toBe(0n);
        },
      ),
    );
  });
});

describe("journal helpers", () => {
  it("totals a partly filled form", () => {
    expect(
      journalTotals([
        { accountId: "a", debit: "10.50" },
        { accountId: "b", credit: "abc" },
        { accountId: "c", credit: "10.5" },
      ]),
    ).toEqual({ debit: "10.5000", credit: "10.5000", difference: "0.0000", balanced: true });
    expect(journalTotals([]).balanced).toBe(false);
  });

  it("reverses lines", () => {
    expect(reversingLines([{ amount: "5.0000", baseAmount: "6.8000", id: 1 }])).toEqual([
      { amount: "-5.0000", baseAmount: "-6.8000", id: 1 },
    ]);
  });
});

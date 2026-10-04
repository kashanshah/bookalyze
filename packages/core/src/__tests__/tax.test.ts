import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type LedgerAccount, prepareJournalEntry } from "../accounting/journal";
import {
  defaultPackRates,
  isValidTaxRate,
  salesTaxSummary,
  splitTaxIncluded,
  TAX_PACKS,
  type TaxRateInfo,
  taxPackFor,
} from "../accounting/tax";
import { describeTransaction, transactionLines } from "../accounting/transactions";
import { formatDecimal, parseDecimal } from "../money";

const hst: TaxRateInfo = {
  id: "hst",
  name: "HST 13%",
  rate: "13",
  accountId: "hst-payable",
  isRecoverable: true,
};
const pst: TaxRateInfo = {
  id: "pst",
  name: "PST 7%",
  rate: "7",
  accountId: "pst-payable",
  isRecoverable: false,
};
const zero: TaxRateInfo = {
  id: "zero",
  name: "Zero-rated",
  rate: "0",
  accountId: "hst-payable",
  isRecoverable: true,
};
const tax = { rates: new Map([hst, pst, zero].map((r) => [r.id, r])), decimals: 2 };
const accounts = new Map<string, LedgerAccount>(
  ["bank", "sales", "supplies", "hst-payable", "pst-payable"].map((id) => [
    id,
    { id, name: id, currency: null, isArchived: false },
  ]),
);
const prepare = (lines: ReturnType<typeof transactionLines>) =>
  prepareJournalEntry({ currency: "CAD", baseCurrency: "CAD", lines }, accounts);

describe("sales tax maths", () => {
  it("splits tax out of a tax-inclusive amount", () => {
    expect(splitTaxIncluded(parseDecimal("113"), "13", 2)).toEqual({
      net: parseDecimal("100"),
      tax: parseDecimal("13"),
    });
    expect(splitTaxIncluded(parseDecimal("10"), "13", 2)).toEqual({
      net: parseDecimal("8.85"),
      tax: parseDecimal("1.15"),
    });
    expect(splitTaxIncluded(parseDecimal("-56.50"), "13", 2)).toEqual({
      net: parseDecimal("-50"),
      tax: parseDecimal("-6.50"),
    });
    expect(splitTaxIncluded(parseDecimal("100"), "0", 2)).toEqual({
      net: parseDecimal("100"),
      tax: 0n,
    });
    expect(splitTaxIncluded(parseDecimal("114.98"), "14.975", 2).tax).toBe(parseDecimal("14.98"));
  });

  it("never loses a cent (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.constantFrom("5", "13", "14", "15", "9.975", "7", "0"),
        (cents, rate) => {
          const amount = BigInt(cents) * 100n;
          const { net, tax: t } = splitTaxIncluded(amount, rate, 2);
          expect(net + t).toBe(amount);
          expect(t % 100n).toBe(0n);
        },
      ),
    );
  });

  it("validates rates", () => {
    expect(isValidTaxRate("13")).toBe(true);
    expect(isValidTaxRate("9.975")).toBe(true);
    expect(isValidTaxRate("101")).toBe(false);
    expect(isValidTaxRate("-1")).toBe(false);
    expect(isValidTaxRate("abc")).toBe(false);
  });
});

describe("sales tax on transactions", () => {
  it("collects tax on a sale and reads it back as one tax-inclusive split", () => {
    const lines = transactionLines(
      {
        kind: "deposit",
        moneyAccountId: "bank",
        splits: [{ accountId: "sales", amount: "113", taxRateId: "hst" }],
      },
      "Invoice 7",
      tax,
    );
    const result = prepare(lines);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.entry.lines.map((l) => [l.accountId, l.amount, l.taxRateId ?? null])).toEqual([
      ["bank", "113.0000", null],
      ["sales", "-100.0000", "hst"],
      ["hst-payable", "-13.0000", "hst"],
    ]);
    expect(describeTransaction(result.entry.lines, (id) => id === "bank")?.splits).toEqual([
      { accountId: "sales", amount: "113.0000", description: undefined, taxRateId: "hst" },
    ]);
  });

  it("claims recoverable tax on purchases, and folds non-recoverable tax into the cost", () => {
    const lines = transactionLines(
      {
        kind: "withdrawal",
        moneyAccountId: "bank",
        splits: [
          { accountId: "supplies", amount: "56.50", taxRateId: "hst" },
          { accountId: "supplies", amount: "10.70", taxRateId: "pst" },
          { accountId: "supplies", amount: "20", taxRateId: "zero" },
        ],
      },
      null,
      tax,
    );
    const result = prepare(lines);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.entry.lines.map((l) => [l.accountId, l.amount, l.taxRateId ?? null])).toEqual([
      ["bank", "-87.2000", null],
      ["supplies", "50.0000", "hst"],
      ["hst-payable", "6.5000", "hst"],
      ["supplies", "10.7000", "pst"],
      ["supplies", "20.0000", "zero"],
    ]);
    expect(
      describeTransaction(result.entry.lines, (id) => id === "bank")?.splits.map((s) => [
        s.amount,
        s.taxRateId,
      ]),
    ).toEqual([
      ["56.5000", "hst"],
      ["10.7000", "pst"],
      ["20.0000", "zero"],
    ]);
  });
});

describe("tax packs and summary", () => {
  it("offers sensible defaults per province", () => {
    const ca = taxPackFor("CA");
    if (!ca) throw new Error("missing pack");
    expect(defaultPackRates(ca, "CA-ON").map((r) => r.key)).toEqual([
      "hst-13",
      "gst-5",
      "zero-rated",
    ]);
    expect(defaultPackRates(ca, "CA-QC").map((r) => r.key)).toContain("qst-9975");
    expect(defaultPackRates(ca, "CA-YT").length).toBe(ca.rates.length);
    for (const pack of TAX_PACKS) {
      for (const r of pack.rates) {
        expect(isValidTaxRate(r.rate)).toBe(true);
        expect(pack.accounts.some((a) => a.key === r.account)).toBe(true);
      }
    }
  });

  it("nets collected tax against claimable tax", () => {
    const summary = salesTaxSummary([
      {
        taxRateId: "hst",
        name: "HST",
        rate: "13",
        isRecoverable: true,
        sales: "1000.0000",
        taxCollected: "130.0000",
        purchases: "200.0000",
        taxPaid: "26.0000",
      },
      {
        taxRateId: "pst",
        name: "PST",
        rate: "7",
        isRecoverable: false,
        sales: "0.0000",
        taxCollected: "0.0000",
        purchases: "100.0000",
        taxPaid: "7.0000",
      },
    ]);
    expect(summary.totalCollected).toBe("130.0000");
    expect(summary.totalClaimable).toBe("26.0000");
    expect(summary.netOwing).toBe(formatDecimal(parseDecimal("104")));
  });
});

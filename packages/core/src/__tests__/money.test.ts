import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  convertUnits,
  decimalPlaces,
  divRound,
  formatDecimal,
  isDecimal,
  parseDecimal,
  roundUnits,
  sumDecimals,
} from "../money";

describe("money", () => {
  it("parses and formats decimal strings exactly", () => {
    expect(parseDecimal("12.5")).toBe(125000n);
    expect(parseDecimal("-0.0001")).toBe(-1n);
    expect(parseDecimal("1,250.00")).toBe(12500000n);
    expect(parseDecimal(".5")).toBe(5000n);
    expect(formatDecimal(125000n)).toBe("12.5000");
    expect(formatDecimal(-1n)).toBe("-0.0001");
    expect(formatDecimal(0n)).toBe("0.0000");
    expect(formatDecimal(12345n, 2)).toBe("123.45");
  });

  it("rejects non-numbers and excess precision", () => {
    expect(() => parseDecimal("abc")).toThrow();
    expect(() => parseDecimal("1.23456")).toThrow();
    expect(isDecimal("12.")).toBe(true);
    expect(isDecimal("1e5")).toBe(false);
    expect(decimalPlaces("12.340")).toBe(3);
  });

  it("rounds half away from zero", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(roundUnits(parseDecimal("1.005"), 2)).toBe(parseDecimal("1.01"));
    expect(roundUnits(parseDecimal("-1.005"), 2)).toBe(parseDecimal("-1.01"));
    expect(roundUnits(parseDecimal("1.5"), 0)).toBe(parseDecimal("2"));
  });

  it("converts with a single rounding step", () => {
    // 0.0099 × 0.5 = 0.00495 → 0.00 (rounding to 4 places first would give 0.0050 → 0.01).
    expect(convertUnits(parseDecimal("0.0099"), "0.5", 2)).toBe(0n);
    expect(convertUnits(parseDecimal("100"), "1.3650", 2)).toBe(parseDecimal("136.50"));
    expect(convertUnits(parseDecimal("-33.33"), "3.6725", 2)).toBe(parseDecimal("-122.40"));
  });

  it("sums exactly where floats would drift", () => {
    expect(sumDecimals(["0.1", "0.2", "-0.3"])).toBe("0.0000");
  });

  it("round-trips any amount", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 16n), max: 10n ** 16n }), (units) => {
        expect(parseDecimal(formatDecimal(units))).toBe(units);
      }),
    );
  });
});

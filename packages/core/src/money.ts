/**
 * Exact decimal arithmetic for money. Amounts travel as strings (from NUMERIC columns and form
 * inputs) and are computed as BigInt "units" at a fixed scale, so floating point never touches
 * money. The database stores amounts as NUMERIC(20,4), so 1 unit = 0.0001.
 */

/** Decimal places stored for amounts (matches NUMERIC(20,4)). */
export const AMOUNT_SCALE = 4;
/** Decimal places stored for exchange rates (matches NUMERIC(20,10)). */
export const RATE_SCALE = 10;

const DECIMAL = /^([+-])?(\d+)(?:\.(\d*))?$|^([+-])?\.(\d+)$/;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Number of decimal places written in a decimal string ("12.50" → 2). */
export function decimalPlaces(value: string): number {
  const dot = value.trim().indexOf(".");
  return dot === -1 ? 0 : value.trim().length - dot - 1;
}

/** Whether `value` is a plain decimal number like "12", "-3.5" or "0.0001". */
export function isDecimal(value: string): boolean {
  return DECIMAL.test(value.trim().replace(/,/g, ""));
}

/**
 * Parses a decimal string into integer units at `scale` decimal places. Commas are ignored
 * ("1,250.00"). Throws if the string isn't a number or has more decimals than `scale`.
 */
export function parseDecimal(value: string, scale: number = AMOUNT_SCALE): bigint {
  const match = DECIMAL.exec(value.trim().replace(/,/g, ""));
  if (!match) throw new Error(`Not a decimal number: "${value}"`);
  const sign = match[1] ?? match[4];
  const whole = match[2] ?? "0";
  const fraction = match[3] ?? match[5] ?? "";
  if (fraction.length > scale) {
    throw new Error(`"${value}" has more than ${scale} decimal places`);
  }
  const units = BigInt(whole) * pow10(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
  return sign === "-" ? -units : units;
}

/** Formats integer units at `scale` as a decimal string with exactly `scale` places. */
export function formatDecimal(units: bigint, scale: number = AMOUNT_SCALE): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = pow10(scale);
  const whole = (abs / base).toString();
  const fraction = scale > 0 ? `.${(abs % base).toString().padStart(scale, "0")}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Divides with rounding half away from zero (the usual rule for money). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/** Rounds amount units (at AMOUNT_SCALE) to `decimals` places, half away from zero. */
export function roundUnits(units: bigint, decimals: number): bigint {
  if (decimals >= AMOUNT_SCALE) return units;
  const step = pow10(AMOUNT_SCALE - decimals);
  return divRound(units, step) * step;
}

/**
 * Converts amount units with an exchange rate (a decimal string, up to RATE_SCALE places) and
 * rounds the result to `decimals` places, e.g. the base currency's minor units.
 */
export function convertUnits(units: bigint, rate: string, decimals: number): bigint {
  const rateUnits = parseDecimal(rate, RATE_SCALE);
  const places = Math.min(decimals, AMOUNT_SCALE);
  // Round once, straight to the target precision, to avoid double-rounding errors.
  const step = pow10(AMOUNT_SCALE - places);
  return divRound(units * rateUnits, pow10(RATE_SCALE) * step) * step;
}

/** Sums decimal strings exactly. */
export function sumDecimals(values: readonly string[]): string {
  return formatDecimal(values.reduce((total, v) => total + parseDecimal(v), 0n));
}

/** Divides two decimal strings exactly, rounding the result to `scale` places. */
export function divideDecimals(
  numerator: string,
  denominator: string,
  scale: number = RATE_SCALE,
): string {
  const n = parseDecimal(numerator, RATE_SCALE);
  const d = parseDecimal(denominator, RATE_SCALE);
  return formatDecimal(divRound(n * pow10(scale), d), scale);
}

/** Multiplies two decimal strings exactly, rounding the result to `scale` places. */
export function multiplyDecimals(a: string, b: string, scale: number = RATE_SCALE): string {
  const product = parseDecimal(a, RATE_SCALE) * parseDecimal(b, RATE_SCALE);
  return formatDecimal(divRound(product, pow10(2 * RATE_SCALE - scale)), scale);
}

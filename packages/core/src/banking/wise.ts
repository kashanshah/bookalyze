import { minorUnits } from "../currency";
import { formatDecimal, parseDecimal } from "../money";
import type { BankTransaction } from "./feed";

/**
 * Reading Wise API responses. Wise sends amounts as JSON numbers; they're turned into decimal
 * strings at once (never added up as floats), rounded to the currency's minor units.
 */

export const WISE_API = "https://api.wise.com";

export type WiseProfile = { id: number; type: "personal" | "business"; name: string };
export type WiseBalance = { id: number; currency: string; amount: string; name: string | null };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A JSON number as an exact decimal string at the currency's precision (16.01 → "16.0100"). */
export function wiseAmount(value: unknown, currency: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Wise sent an amount that isn't a number.");
  }
  // toFixed works from the double's exact value; Wise amounts have at most 2–3 decimals, so
  // fixing to the currency's places reproduces what Wise meant.
  const fixed = value.toFixed(Math.min(minorUnits(currency), 4));
  return formatDecimal(parseDecimal(fixed));
}

function money(value: unknown): { value: string; currency: string } | null {
  if (!isObject(value)) return null;
  const currency = str(value.currency)?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  return { value: wiseAmount(value.value, currency), currency };
}

/** Profiles from GET /v2/profiles (or /v1/profiles): the personal one and any businesses. */
export function parseWiseProfiles(json: unknown): WiseProfile[] {
  if (!Array.isArray(json)) throw new Error("Wise didn't return a list of profiles.");
  return json.flatMap((p): WiseProfile[] => {
    if (!isObject(p) || typeof p.id !== "number") return [];
    const type = String(p.type ?? "").toLowerCase() === "business" ? "business" : "personal";
    const details = isObject(p.details) ? p.details : {};
    const name =
      str(p.fullName) ??
      str(p.businessName) ??
      str(details.name) ??
      ([str(details.firstName), str(details.lastName)].filter(Boolean).join(" ") || null) ??
      `Profile ${p.id}`;
    return [{ id: p.id, type, name }];
  });
}

/** Balances from GET /v4/profiles/{profileId}/balances?types=STANDARD. */
export function parseWiseBalances(json: unknown): WiseBalance[] {
  if (!Array.isArray(json)) throw new Error("Wise didn't return a list of balances.");
  return json.flatMap((b): WiseBalance[] => {
    if (!isObject(b) || typeof b.id !== "number") return [];
    const amount = money(b.amount);
    const currency = str(b.currency)?.toUpperCase() ?? amount?.currency;
    if (!currency) return [];
    return [{ id: b.id, currency, amount: amount?.value ?? "0.0000", name: str(b.name) }];
  });
}

/** The calendar date of an instant in a time zone: "2026-03-01T03:00:00Z" in Toronto → "2026-02-28". */
export function localDate(instant: string, timeZone: string): string {
  const time = new Date(instant);
  if (Number.isNaN(time.getTime())) throw new Error(`"${instant}" isn't a date.`);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}

const KINDS: Record<string, BankTransaction["kind"]> = {
  CARD: "card",
  DEPOSIT: "deposit",
  TRANSFER: "transfer",
  CONVERSION: "conversion",
  MONEY_ADDED: "deposit",
  DIRECT_DEBIT: "transfer",
  INCOMING_CROSS_BALANCE: "conversion",
  OUTGOING_CROSS_BALANCE: "conversion",
  BALANCE_INTEREST: "interest",
  ACCRUAL_CHARGE: "fee",
  BALANCE_CASHBACK: "deposit",
};

/**
 * Transactions from a balance statement (GET /v1/profiles/{profileId}/balance-statements/
 * {balanceId}/statement.json, type COMPACT): one per Wise transaction, its fee included in
 * `amount` and also given as `fee`. `timeZone` decides each transaction's date.
 */
export function parseWiseStatement(
  json: unknown,
  balanceId: number,
  timeZone: string,
): BankTransaction[] {
  if (!isObject(json) || !Array.isArray(json.transactions)) {
    throw new Error("Wise didn't return a statement.");
  }
  return json.transactions.flatMap((t): BankTransaction[] => {
    if (!isObject(t)) return [];
    const amount = money(t.amount);
    const ref = str(t.referenceNumber);
    const when = str(t.date);
    if (!amount || !ref || !when || parseDecimal(amount.value) === 0n) return [];
    const fee = money(t.totalFees);
    const details = isObject(t.details) ? t.details : {};
    const kind = KINDS[String(details.type ?? "").toUpperCase()] ?? "other";
    const merchant = isObject(details.merchant) ? str(details.merchant.name) : null;
    const counterparty = merchant ?? str(details.senderName) ?? str(details.recipientName) ?? null;
    let conversion: BankTransaction["conversion"];
    if (kind === "conversion") {
      const source = money(details.sourceAmount);
      const target = money(details.targetAmount);
      const other = parseDecimal(amount.value) > 0n ? source : target;
      if (other && other.currency !== amount.currency) {
        conversion = { otherCurrency: other.currency, otherAmount: other.value };
      }
    }
    return [
      {
        // Wise reference numbers are unique per transaction; the balance keeps both sides of a
        // conversion (same reference) apart.
        externalId: `wise:${balanceId}:${ref}`,
        pairKey: ref,
        date: localDate(when, timeZone),
        currency: amount.currency,
        amount: amount.value,
        fee: fee && fee.currency === amount.currency ? fee.value.replace("-", "") : "0.0000",
        description:
          str(details.description) ??
          merchant ??
          (kind === "fee" ? "Wise fee" : "Wise transaction"),
        counterparty,
        reference: str(details.paymentReference),
        kind,
        ...(conversion ? { conversion } : {}),
      },
    ];
  });
}

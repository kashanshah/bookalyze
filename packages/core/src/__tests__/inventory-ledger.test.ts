import { describe, expect, it } from "vitest";
import { ledgerStockChanges, parseInventoryLedger } from "../commerce/inventory-ledger";

const TSV = [
  "Date\tFNSKU\tASIN\tMSKU\tTitle\tEvent Type\tReference ID\tQuantity\tFulfillment Center\tDisposition\tReason\tCountry\tReconciled Quantity\tUnreconciled Quantity\tDate and Time",
  "09/05/2026\tX001\tB0MUG\tMUG\tMug\tShipments\t702-1\t-2\tYYZ4\tSELLABLE\t\tCA\t\t\t2026-09-05T10:00:00-07:00",
  "09/12/2026\tX001\tB0MUG\tMUG\tMug\tCustomerReturns\t702-1\t1\tYYZ4\tCUSTOMER_DAMAGED\t\tCA\t\t\t2026-09-12T10:00:00-07:00",
  "09/20/2026\tX001\tB0MUG\tMUG\tMug\tAdjustments\t\t-1\tYYZ4\tSELLABLE\tM\tCA\t\t\t2026-09-20T10:00:00-07:00",
  "09/20/2026\tX001\tB0MUG\tMUG\tMug\tAdjustments\t\t-1\tYYZ4\tSELLABLE\tM\tCA\t\t\t2026-09-20T10:00:00-07:00",
  "09/25/2026\tX001\tB0MUG\tMUG\tMug\tAdjustments\t\t1\tYYZ4\tSELLABLE\tF\tCA\t\t\t2026-09-25T10:00:00-07:00",
  "09/26/2026\tX001\tB0MUG\tMUG\tMug\tAdjustments\t\t-1\tYYZ4\tSELLABLE\t6\tCA\t\t\t2026-09-26T10:00:00-07:00",
  "09/26/2026\tX001\tB0MUG\tMUG\tMug\tAdjustments\t\t1\tYYZ4\tUNSELLABLE\t6\tCA\t\t\t2026-09-26T10:00:00-07:00",
  "09/28/2026\tX001\tB0MUG\tMUG\tMug\tVendorReturns\tR-1\t-3\tYYZ4\tSELLABLE\t\tCA\t\t\t2026-09-28T10:00:00-07:00",
].join("\n");

describe("FBA inventory ledger", () => {
  it("reads the detailed view, and numbers identical rows so both count", () => {
    const parsed = parseInventoryLedger(TSV);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.events).toHaveLength(8);
    expect(parsed.from).toBe("2026-09-05");
    expect(parsed.to).toBe("2026-09-28");
    const lost = parsed.events.filter((e) => e.reason === "M");
    expect(lost.map((e) => e.key.endsWith("|1") || e.key.endsWith("|2"))).toEqual([true, true]);
    expect(new Set(lost.map((e) => e.key)).size).toBe(2);
    // The same file again gives the same keys.
    const again = parseInventoryLedger(TSV);
    expect(again.ok && again.events.map((e) => e.key)).toEqual(parsed.events.map((e) => e.key));
  });

  it("counts returns in any condition and nets adjustments (lost, found, condition changes)", () => {
    const parsed = parseInventoryLedger(TSV);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(ledgerStockChanges(parsed.events).get("MUG")).toEqual({ returned: 1, adjusted: -1 });
  });

  it("says when the file isn't the ledger", () => {
    expect(parseInventoryLedger("a,b\n1,2")).toMatchObject({ ok: false });
    expect(parseInventoryLedger("")).toMatchObject({ ok: false, error: "The file is empty." });
  });
});

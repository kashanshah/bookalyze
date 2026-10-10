import { describe, expect, it } from "vitest";
import { ledgerStockChanges } from "../commerce/inventory-ledger";
import { noonLedgerEventType, parseNoonLedger } from "../commerce/noon-ledger";

// Noon's header (fbn_inventoryv2_ledgerdetailedview); synthetic rows.
const HEADER =
  "transaction_date,transaction_type,reference_nr,reference_type,country_code,warehouse_code,fulfillment_type,nfsku,sku,partner_sku,partner_barcode,inventory_condition,quantity_delta,qc_fail_item_identifier";

describe("Noon's FBN inventory ledger", () => {
  it("reads Noon's movement types in Amazon's terms", () => {
    expect(noonLedgerEventType("customer_return")).toBe("CustomerReturns");
    expect(noonLedgerEventType("Return", "Customer Order")).toBe("CustomerReturns");
    expect(noonLedgerEventType("partner_return")).toBe("VendorReturns");
    expect(noonLedgerEventType("Removal")).toBe("VendorReturns");
    expect(noonLedgerEventType("lost")).toBe("Adjustments");
    expect(noonLedgerEventType("Inventory Adjustment", "cycle_count")).toBe("Adjustments");
    expect(noonLedgerEventType("damaged")).toBe("Adjustments");
    expect(noonLedgerEventType("inbound", "ASN")).toBe("Receipts");
    expect(noonLedgerEventType("outbound", "customer_order")).toBe("Shipments");
    expect(noonLedgerEventType("stock_transfer")).toBe("WhseTransfers");
    expect(noonLedgerEventType("mystery")).toBe("Other");
  });

  it("reads the rows by the seller's SKU, with country, warehouse and condition", () => {
    const parsed = parseNoonLedger(
      [
        HEADER,
        "2026-09-02 10:00:00,outbound,NAE001,customer_order,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,-2,",
        "2026-09-10,customer_return,NAE001,customer_order,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,1,",
        "2026-09-12,lost,ADJ-1,adjustment,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,-1,",
        "2026-09-12,lost,ADJ-1,adjustment,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,-1,",
        "2026-09-20,found,ADJ-2,adjustment,ae,DXB01,FBN,N1,Z1,MUG-1,111,sellable,1,",
        "2026-09-21,mystery,X-1,,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,3,",
        ",lost,ADJ-3,adjustment,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,-1,",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.skipped).toBe(1);
    expect(parsed.from).toBe("2026-09-02");
    expect(parsed.to).toBe("2026-09-21");
    expect(parsed.events.map((e) => [e.date, e.sku, e.eventType, e.quantity, e.country])).toEqual([
      ["2026-09-02", "MUG-1", "Shipments", -2, "AE"],
      ["2026-09-10", "MUG-1", "CustomerReturns", 1, "AE"],
      ["2026-09-12", "MUG-1", "Adjustments", -1, "AE"],
      ["2026-09-12", "MUG-1", "Adjustments", -1, "AE"],
      ["2026-09-20", "MUG-1", "Adjustments", 1, "AE"],
      ["2026-09-21", "MUG-1", "Other", 3, "AE"],
    ]);
    expect(parsed.events[2]).toMatchObject({
      fnsku: "N1",
      referenceId: "ADJ-1",
      fulfillmentCenter: "DXB01",
      disposition: "sellable",
      reason: "lost · adjustment",
    });
    // Two identical losses are two units, and keep two keys; the same file again keeps them.
    expect(new Set(parsed.events.map((e) => e.key)).size).toBe(6);
    // A month's stock changes: one returned, one lost net (two lost, one found).
    expect(ledgerStockChanges(parsed.events).get("MUG-1")).toEqual({ returned: 1, adjusted: -1 });
  });

  it("falls back to Noon's SKU and refuses other files", () => {
    const parsed = parseNoonLedger(
      [HEADER, "05/09/2026,lost,A,,AE,W,FBN,N2,Z2,,,sellable,-1,"].join("\n"),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.events[0]).toMatchObject({ date: "2026-09-05", sku: "Z2" });
    const amazon = parseNoonLedger("Date,MSKU,Event Type,Quantity\n2026-09-01,A,Shipments,-1");
    expect(amazon.ok).toBe(false);
  });
});

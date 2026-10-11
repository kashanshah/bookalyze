import { describe, expect, it } from "vitest";
import {
  isNoonSummaryHeader,
  noonLedgerMismatches,
  parseNoonStockSummary,
} from "../commerce/noon-stock";

// Noon's header (fbn_inventoryv2_ledgersummaryview); synthetic rows.
const HEADER =
  "date,location,nfsku,sku,partner_sku,partner_barcode,inventory_condition,opening_quantity,inbound_quantity,vendor_return_quantity,disposal_quantity,customer_outbound_quantity,customer_return_quantity,transfer_in_quantity,transfer_out_quantity,transit_quantity,lost_quantity,found_quantity,damaged_quantity,other_quantity,closing_quantity";

describe("Noon's FBN ledger summary", () => {
  it("tells its header apart", () => {
    expect(isNoonSummaryHeader(HEADER.split(","))).toBe(true);
    expect(isNoonSummaryHeader(["transaction_date", "quantity_delta"])).toBe(false);
  });

  it("reads each day's opening, closing and movements by the seller's SKU", () => {
    const parsed = parseNoonStockSummary(
      [
        HEADER,
        "2026-09-02,DXB01,N1,Z1,MUG-1,111,Sellable,10,0,0,0,2,0,0,0,0,0,0,0,0,8",
        "2026-09-02,DXB01,N1,Z1,MUG-1,111,Sellable,1,0,0,0,0,1,0,0,0,0,0,0,0,2",
        "03/09/2026,DXB01,N1,Z1,MUG-1,111,damaged,0,0,0,0,0,0,0,0,0,0,0,1,0,1",
        "2026-09-04,DXB01,N2,Z2,,222,,5,0,0,0,0,0,0,0,0,0,0,0,0,5",
        ",DXB01,N1,Z1,MUG-1,111,sellable,1,0,0,0,0,0,0,0,0,0,0,0,0,1",
        "2026-09-05,DXB01,N1,Z1,MUG-1,111,sellable,x,0,0,0,0,0,0,0,0,0,0,0,0,1",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.skipped).toBe(2);
    expect(parsed.from).toBe("2026-09-02");
    expect(parsed.to).toBe("2026-09-04");
    expect(parsed.rows).toEqual([
      {
        date: "2026-09-02",
        location: "DXB01",
        sku: "MUG-1",
        nfsku: "N1",
        condition: "sellable",
        opening: 11,
        closing: 10,
        movements: { customerOutbound: 2, customerReturn: 1 },
      },
      expect.objectContaining({ date: "2026-09-03", condition: "damaged", closing: 1 }),
      expect.objectContaining({ sku: "Z2", condition: "sellable", opening: 5, closing: 5 }),
    ]);
  });

  it("refuses another file", () => {
    expect(parseNoonStockSummary("a,b\n1,2")).toEqual({
      ok: false,
      error: expect.stringContaining("summary view"),
    });
  });
});

describe("noonLedgerMismatches", () => {
  it("lists days where the summary and the detailed ledger move a SKU differently", () => {
    expect(
      noonLedgerMismatches(
        [
          { date: "2026-09-02", sku: "MUG-1", change: -2 },
          { date: "2026-09-02", sku: "MUG-1", change: 1 },
          { date: "2026-09-03", sku: "MUG-1", change: -1 },
          { date: "2026-09-04", sku: "CUP-1", change: 0 },
          { date: "2026-09-05", sku: "CUP-1", change: 3 },
        ],
        [
          { date: "2026-09-02", sku: "MUG-1", quantity: -1 },
          { date: "2026-09-03", sku: "MUG-1", quantity: -2 },
          { date: "2026-09-06", sku: "CUP-1", quantity: 4 },
        ],
      ),
    ).toEqual([
      { date: "2026-09-05", sku: "CUP-1", summary: 3, ledger: 0 },
      { date: "2026-09-03", sku: "MUG-1", summary: -1, ledger: -2 },
    ]);
  });
});

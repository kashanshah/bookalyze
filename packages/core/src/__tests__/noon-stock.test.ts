import { describe, expect, it } from "vitest";
import {
  isNoonPeriodSummaryHeader,
  isNoonSummaryHeader,
  noonLedgerMismatches,
  parseNoonPeriodSummary,
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
  it("lists days where the summary and the detailed ledger move a product differently", () => {
    expect(
      noonLedgerMismatches(
        [
          { date: "2026-09-02", key: "mug", label: "Mug", change: -2 },
          { date: "2026-09-02", key: "mug", label: "Mug", change: 1 },
          { date: "2026-09-03", key: "mug", label: "Mug", change: -1 },
          { date: "2026-09-04", key: "cup", label: "Cup", change: 0 },
          { date: "2026-09-05", key: "cup", label: "Cup", change: 3 },
        ],
        [
          { date: "2026-09-02", key: "mug", quantity: -1 },
          { date: "2026-09-03", key: "mug", quantity: -2 },
          { date: "2026-09-06", key: "cup", quantity: 4 },
        ],
      ),
    ).toEqual([
      { date: "2026-09-05", from: null, sku: "Cup", summary: 3, ledger: 0 },
      { date: "2026-09-03", from: null, sku: "Mug", summary: -1, ledger: -2 },
    ]);
  });

  it("adds the ledger up over a period report's days", () => {
    const ledger = [
      { date: "2026-10-08", key: "mug", quantity: -2 },
      { date: "2026-10-12", key: "mug", quantity: -3 },
      { date: "2026-10-20", key: "mug", quantity: -9 },
    ];
    const period = { date: "2026-10-19", from: "2026-10-08", key: "mug", label: "Mug" };
    expect(noonLedgerMismatches([{ ...period, change: -5 }], ledger)).toEqual([]);
    expect(noonLedgerMismatches([{ ...period, change: -6 }], ledger)).toEqual([
      { date: "2026-10-19", from: "2026-10-08", sku: "Mug", summary: -6, ledger: -5 },
    ]);
  });
});

describe("parseNoonPeriodSummary", () => {
  it("reads Noon's period report as the dates chosen, netting each kind of movement", () => {
    const text = [
      "fulfillment_type,id_partner,country_code,warehouse_code,pbarcode,sku,opening_stock,in_transit,inbound_received,customer_shipment,return_reinbound,qc_fail_return,vendor_return,liquidation,dispose,relabel,warehouse_transfer,lost_and_found,unknown_transactions,closing_stock",
      "fbn,1,AE,DXB01,111,Z1-1,25,1,0,-5,0,0,0,0,0,0,-1,0,0,20",
      "fbn,1,AE,DXB01,111,Z1-1,0,0,0,0,0,0,0,0,0,0,2,1,0,3",
      "fbn,1,AE,AUH01,222,Z2-1,10,0,0,0,0,0,0,0,0,0,0,,0,10",
      "fbn,1,AE,AUH01,333,,1,0,0,0,0,0,0,0,0,0,0,0,0,1",
    ].join("\n");
    expect(isNoonPeriodSummaryHeader(text.split("\n")[0]?.split(",") ?? [])).toBe(true);
    const parsed = parseNoonPeriodSummary(text, { from: "2026-10-08", to: "2026-10-19" });
    expect(parsed).toEqual({
      ok: true,
      from: "2026-10-08",
      to: "2026-10-19",
      skipped: 1,
      rows: [
        {
          date: "2026-10-19",
          fromDate: "2026-10-08",
          location: "DXB01",
          sku: "Z1-1",
          nfsku: null,
          condition: "sellable",
          opening: 25,
          closing: 23,
          movements: { transit: 1, customerOutbound: -5, transferOut: -1, transferIn: 2, found: 1 },
        },
        {
          date: "2026-10-19",
          fromDate: "2026-10-08",
          location: "AUH01",
          sku: "Z2-1",
          nfsku: null,
          condition: "sellable",
          opening: 10,
          closing: 10,
          movements: {},
        },
      ],
    });
    expect(parseNoonPeriodSummary(text, { from: "2026-10-19", to: "2026-10-08" })).toEqual({
      ok: false,
      error: "Enter the first and last day the report covers.",
    });
  });
});

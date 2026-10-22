import { describe, expect, it } from "vitest";
import {
  readWalmartSettlement,
  walmartAmount,
  walmartDay,
  walmartSettlementDate,
} from "../commerce/walmart-settlement-file";

const CSV = [
  "Period Start Date,Period End Date,Total Payout,Currency,Transaction Type,Purchase Order #,Amount,Amount Type,Ship to City,Ship to State,Ship to Zipcode,Customer Name",
  '10/01/2026,10/14/2026,"1,052.07",cad,Sale,108800000001,39.98,Product Price,Toronto,ON,M0M 0M0,Synthetic Buyer',
  '10/01/2026,10/14/2026,"1,052.07",cad,Sale,108800000001,-6.00,Commission on Product,Toronto,ON,M0M 0M0,Synthetic Buyer',
  ",,,,,,,,,,,",
].join("\n");

describe("Walmart settlement file", () => {
  it("keeps each row by column name, without anything that could say who or where a buyer is", () => {
    const file = readWalmartSettlement(`﻿${CSV}`);
    expect(file.columns).toEqual([
      "Period Start Date",
      "Period End Date",
      "Total Payout",
      "Currency",
      "Transaction Type",
      "Purchase Order #",
      "Amount",
      "Amount Type",
    ]);
    expect(file.dropped).toEqual([
      "Ship to City",
      "Ship to State",
      "Ship to Zipcode",
      "Customer Name",
    ]);
    expect(file.rows).toHaveLength(2);
    expect(file.rows[1]).toMatchObject({ Amount: "-6.00", "Amount Type": "Commission on Product" });
    expect(JSON.stringify(file.rows)).not.toMatch(/Toronto|M0M|Synthetic Buyer/);
  });

  it("picks out the period, the payout and its currency", () => {
    expect(readWalmartSettlement(CSV)).toMatchObject({
      periodFrom: "2026-10-01",
      periodTo: "2026-10-14",
      payout: "1052.0700",
      currency: "CAD",
    });
  });

  it("leaves them empty when no column says, and refuses a file with no columns", () => {
    const file = readWalmartSettlement("Date,Amount\n2026-10-01,5\n");
    expect(file).toMatchObject({ periodFrom: null, periodTo: null, payout: null, currency: null });
    expect(() => readWalmartSettlement("just text")).toThrow(/no columns/);
  });

  it("reads Walmart's dates and amounts", () => {
    expect(walmartDay("10/7/2026")).toBe("2026-10-07");
    expect(walmartDay("2026-10-07T00:00:00")).toBe("2026-10-07");
    expect(walmartDay("10072026")).toBe("2026-10-07");
    expect(walmartDay("soon")).toBeNull();
    expect(walmartAmount("1,234.50")).toBe("1234.5000");
    expect(walmartAmount("(6.00)")).toBe("-6.0000");
    expect(walmartAmount("$6")).toBe("6.0000");
    expect(walmartAmount("")).toBeNull();
    expect(walmartAmount("n/a")).toBeNull();
  });

  it("files an uploaded report under its settlement date, else its period's last day", () => {
    expect(walmartSettlementDate(readWalmartSettlement(CSV))).toBe("2026-10-14");
    const paid = readWalmartSettlement(
      "Period Start Date,Period End Date,Settlement Date,Amount\n10/01/2026,10/14/2026,10/16/2026,5\n",
    );
    expect(walmartSettlementDate(paid)).toBe("2026-10-16");
    expect(walmartSettlementDate(readWalmartSettlement("Date,Amount\n2026-10-01,5\n"))).toBeNull();
  });
});

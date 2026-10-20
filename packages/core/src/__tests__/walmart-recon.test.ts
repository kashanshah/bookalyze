import { describe, expect, it } from "vitest";
import {
  parseWalmartReconDates,
  walmartReconDatesQuery,
  walmartReconFileQuery,
  walmartReportDate,
  zipFirstFile,
} from "../commerce/walmart-recon";

/** A one-file zip, stored (not compressed), the way any zip tool can make it. */
function storedZip(name: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const file = enc.encode(name);
  const data = enc.encode(content);
  const local = new Uint8Array(30 + file.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 0, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, file.length, true);
  local.set(file, 30);
  local.set(data, 30 + file.length);
  const central = new Uint8Array(46 + file.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 0, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, file.length, true);
  cv.setUint32(42, 0, true);
  central.set(file, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

describe("Walmart settlement reports", () => {
  it("asks for the list and for one settlement's file, by Walmart's MMDDYYYY date", () => {
    expect(walmartReconDatesQuery()).toBe(
      "/v3/report/reconreport/availableReconFiles?reportVersion=v1",
    );
    expect(walmartReportDate("2026-10-07")).toBe("10072026");
    expect(walmartReconFileQuery("2026-10-07")).toBe(
      "/v3/report/reconreport/reconFile?reportDate=10072026&reportVersion=v1",
    );
  });

  it("reads the dates in each shape Walmart has used, newest first, once each", () => {
    expect(
      parseWalmartReconDates({ availableApReportDates: ["09232026", "10072026", "09232026"] }),
    ).toEqual(["2026-10-07", "2026-09-23"]);
    expect(parseWalmartReconDates({ availableReportDates: ["10-07-2026"] })).toEqual([
      "2026-10-07",
    ]);
    expect(parseWalmartReconDates(["2026-08-26"])).toEqual(["2026-08-26"]);
    expect(parseWalmartReconDates({ availableApReportDates: ["soon", 7] })).toEqual([]);
    expect(parseWalmartReconDates(null)).toEqual([]);
  });

  it("finds the first file in a zip", () => {
    const zip = storedZip("recon_10072026.csv", "Walmart.com PO #,Amount\n1,2\n");
    const first = zipFirstFile(zip);
    expect(first?.name).toBe("recon_10072026.csv");
    expect(first?.method).toBe(0);
    expect(new TextDecoder().decode(first?.data)).toBe("Walmart.com PO #,Amount\n1,2\n");
    expect(zipFirstFile(new TextEncoder().encode("a,b\n1,2"))).toBeNull();
  });
});

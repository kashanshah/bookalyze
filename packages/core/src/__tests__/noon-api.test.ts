import { describe, expect, it } from "vitest";
import {
  noonCookieHeader,
  noonErrorDetail,
  noonLoginClaims,
  parseExportCategories,
  parseExportCreated,
  parseExportStatus,
  parseNoonKeyFile,
  previewReport,
  splitDelimitedLine,
  zipEntryNames,
} from "../commerce/noon-api";

// Synthetic: not a real key, only shaped like one (built so scanners don't take it for one).
const armor = (edge: string) => `-----${edge} ${["PRIVATE", "KEY"].join(" ")}-----`;
const PEM = `${armor("BEGIN")}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n${armor("END")}\n`;
const keyFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    key_id: "key-0001",
    private_key: PEM,
    project_code: "PRJ000001",
    channel_identifier: "channel-0001",
    ...over,
  });

describe("parseNoonKeyFile", () => {
  it("keeps the key ID, private key and project code", () => {
    expect(parseNoonKeyFile(keyFile())).toEqual({
      keyId: "key-0001",
      privateKey: PEM.trim(),
      projectCode: "PRJ000001",
    });
  });

  it("reads a file with a byte-order mark and escaped line breaks", () => {
    const escaped = keyFile({ private_key: PEM.replace(/\n/g, "\\n") });
    expect(parseNoonKeyFile(`﻿${escaped}`).privateKey).toContain("\n");
  });

  it("says what's wrong with other files", () => {
    expect(() => parseNoonKeyFile("not json")).toThrow(/isn't JSON/);
    expect(() => parseNoonKeyFile(keyFile({ project_code: "" }))).toThrow(/isn't a Noon key file/);
    expect(() => parseNoonKeyFile(keyFile({ private_key: "abc" }))).toThrow(/can't be read/);
    // A Google service-account file is close, but not Noon's.
    expect(() =>
      parseNoonKeyFile(JSON.stringify({ type: "service_account", private_key: PEM })),
    ).toThrow(/isn't a Noon key file/);
  });
});

describe("noonLoginClaims", () => {
  it("signs in as the key, with the time in whole seconds", () => {
    const { header, payload } = noonLoginClaims({
      keyId: "key-0001",
      now: new Date("2026-10-08T12:00:00.987Z"),
      jti: "a-b-c",
    });
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload).toEqual({ sub: "key-0001", iat: 1791460800, jti: "a-b-c" });
  });
});

describe("noonCookieHeader", () => {
  it("keeps each cookie's name and value", () => {
    expect(
      noonCookieHeader([
        "_npsid=abc123; Path=/; HttpOnly; Secure",
        "_nprj=PRJ000001; Path=/",
        "broken",
      ]),
    ).toBe("_npsid=abc123; _nprj=PRJ000001");
  });
});

describe("noonErrorDetail", () => {
  it("reads the error envelope with its fields", () => {
    expect(
      noonErrorDetail({
        error: {
          status_id: 3,
          code: "INVALID_ARGUMENT",
          message: "Invalid argument.",
          fields: [{ name: "params.from_date", descriptions: ["is required"] }],
        },
      }),
    ).toBe("INVALID_ARGUMENT: Invalid argument. · params.from_date: is required");
  });

  it("reads the older status shape, and nothing when there's nothing", () => {
    expect(noonErrorDetail({ status_code: "PERMISSION_DENIED", message: "No access" })).toBe(
      "PERMISSION_DENIED: No access",
    );
    expect(noonErrorDetail(null)).toBeNull();
    expect(noonErrorDetail({})).toBeNull();
  });
});

describe("parseExportCategories", () => {
  it("lists each report with its inputs", () => {
    expect(
      parseExportCategories({
        export_categories: [
          {
            export_category_code: "noon_financeweb_transactionviewreportonitemlevel",
            params: { from_date: "date", to_date: "date" },
          },
          { export_category_code: "", params: {} },
          { export_category_code: "catalog", params: null },
        ],
      }),
    ).toEqual([
      {
        code: "noon_financeweb_transactionviewreportonitemlevel",
        params: ["from_date", "to_date"],
        spec: { from_date: "date", to_date: "date" },
      },
      { code: "catalog", params: [], spec: {} },
    ]);
    expect(() => parseExportCategories({})).toThrow(/Unexpected/);
  });
});

describe("exports", () => {
  it("reads the export's code, and refuses an answer without one", () => {
    expect(parseExportCreated({ export_code: " EXP-1 " })).toBe("EXP-1");
    expect(() => parseExportCreated({})).toThrow(/didn't say/);
  });

  it("is ready once there's a link, failed when Noon says so, working otherwise", () => {
    expect(
      parseExportStatus({
        export_code: "E1",
        export_status: "COMPLETED",
        download_url: "https://x/y",
      }),
    ).toMatchObject({ state: "ready", downloadUrl: "https://x/y", status: "COMPLETED" });
    expect(
      parseExportStatus({ export_code: "E1", export_status: "PROCESSING", download_url: null }),
    ).toMatchObject({ state: "working", downloadUrl: null });
    expect(
      parseExportStatus({
        export_code: "E1",
        export_status: "FAILED",
        download_url: "https://x/y",
      }),
    ).toMatchObject({ state: "failed", downloadUrl: null });
  });
});

describe("previewReport", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("reads a CSV's header, quoted cells included, and counts its rows", () => {
    const csv =
      '\uFEFFReference Number,"Order Nr",Net Proceeds,"Fee, referral"\r\nR1,N1,10,1\r\nR2,N2,20,2\r\n';
    expect(previewReport(bytes(csv))).toEqual({
      kind: "csv",
      columns: ["Reference Number", "Order Nr", "Net Proceeds", "Fee, referral"],
      rows: 2,
      gzip: false,
    });
  });

  it("tells a TSV and JSON apart from a CSV", () => {
    expect(previewReport(bytes("a\tb\tc\n1\t2\t3\n"))).toMatchObject({
      kind: "tsv",
      columns: ["a", "b", "c"],
      rows: 1,
    });
    expect(previewReport(bytes('[{"sku":"A","amount":1}]'))).toMatchObject({
      kind: "json",
      columns: ["sku", "amount"],
    });
  });

  it("splits quoted cells with doubled quotes", () => {
    expect(splitDelimitedLine('a,"b ""c"", d",e', ",")).toEqual(["a", 'b "c", d', "e"]);
  });

  it("lists the files in a zip, and knows an Excel file by its sheets", () => {
    const zip = storedZip(["xl/workbook.xml", "xl/worksheets/sheet1.xml", "[Content_Types].xml"]);
    expect(zipEntryNames(zip)).toEqual([
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "[Content_Types].xml",
    ]);
    expect(previewReport(zip)).toMatchObject({ kind: "xlsx", rows: null });
    expect(previewReport(storedZip(["report.csv"]))).toMatchObject({
      kind: "zip",
      columns: ["report.csv"],
    });
  });
});

/** A minimal zip (empty, stored files): just enough central directory to read names from. */
function storedZip(names: string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const name of names) {
    const offset = parts.length;
    const n = [...enc.encode(name)];
    parts.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(0),
      ...u32(0),
      ...u32(0),
      ...u16(n.length),
      ...u16(0),
      ...n,
    );
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(0),
      ...u32(0),
      ...u32(0),
      ...u16(n.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...n,
    );
  }
  const start = parts.length;
  return new Uint8Array([
    ...parts,
    ...central,
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(names.length),
    ...u16(names.length),
    ...u32(central.length),
    ...u32(start),
    ...u16(0),
  ]);
}

describe("any report's inputs and name", () => {
  it("fills date inputs, leaves reports without dates alone, and names reports plainly", async () => {
    const { noonReportParams, noonReportName } = await import("../commerce/noon-api");
    expect(
      noonReportParams({ start_date: "string", end_date: "string" }, "2026-10-01", "2026-10-07"),
    ).toEqual({
      start_date: "2026-10-01",
      end_date: "2026-10-07",
    });
    expect(noonReportParams({ warehouse_code: "string" }, "2026-10-01", "2026-10-07")).toEqual({});
    expect(noonReportParams(null, "2026-10-01", "2026-10-07")).toEqual({
      from_date: "2026-10-01",
      to_date: "2026-10-07",
    });
    expect(noonReportName("noon_fbn_inventory_report")).toBe("Fbn inventory report");
    expect(noonReportName("noon_financeweb_transactionviewreportonitemlevel")).toBe(
      "Transaction view (payouts)",
    );
  });
});

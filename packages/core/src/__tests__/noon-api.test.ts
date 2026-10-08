import { describe, expect, it } from "vitest";
import {
  noonCookieHeader,
  noonErrorDetail,
  noonLoginClaims,
  parseExportCategories,
  parseNoonKeyFile,
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
      },
      { code: "catalog", params: [] },
    ]);
    expect(() => parseExportCategories({})).toThrow(/Unexpected/);
  });
});

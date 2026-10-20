import { describe, expect, it } from "vitest";
import {
  missingWalmartAccess,
  parseWalmartCredentials,
  parseWalmartToken,
  parseWalmartTokenDetail,
  walmartBasicAuth,
  walmartErrorDetail,
  walmartHeaders,
} from "../commerce/walmart-api";

describe("Walmart API keys", () => {
  it("keeps a pasted client ID and secret, trimmed", () => {
    expect(parseWalmartCredentials({ clientId: "  abc-123 ", clientSecret: "s3cr3t\n" })).toEqual({
      clientId: "abc-123",
      clientSecret: "s3cr3t",
    });
  });

  it("says what's wrong with a missing or mangled key", () => {
    expect(() => parseWalmartCredentials({ clientId: "abc", clientSecret: "" })).toThrow(
      /both the client ID and the client secret/,
    );
    expect(() => parseWalmartCredentials({ clientId: "ab c", clientSecret: "x" })).toThrow(
      /no spaces/,
    );
    expect(() => parseWalmartCredentials({ clientId: "a".repeat(201), clientSecret: "x" })).toThrow(
      /too long/,
    );
  });

  it("signs the token call with Basic client ID and secret", () => {
    expect(walmartBasicAuth({ clientId: "id", clientSecret: "secret" })).toBe(
      `Basic ${Buffer.from("id:secret").toString("base64")}`,
    );
  });

  it("sends Walmart's headers, with the market and the token once there is one", () => {
    expect(walmartHeaders({ market: "ca", correlationId: "c-1" })).toEqual({
      Accept: "application/json",
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": "c-1",
      WM_MARKET: "ca",
    });
    expect(walmartHeaders({ market: "us", correlationId: "c-2", accessToken: "t" })).toMatchObject({
      "WM_SEC.ACCESS_TOKEN": "t",
      WM_MARKET: "us",
    });
  });
});

describe("Walmart token answers", () => {
  it("reads the access token and its lifetime", () => {
    expect(
      parseWalmartToken({ access_token: "eyJ", token_type: "Bearer", expires_in: 900 }),
    ).toEqual({ accessToken: "eyJ", expiresIn: 900 });
    expect(parseWalmartToken({ access_token: "eyJ" }).expiresIn).toBe(900);
    expect(() => parseWalmartToken({})).toThrow(/no access token/);
  });

  it("reads what the key may do, area by area, missing areas as no access", () => {
    const scopes = parseWalmartTokenDetail({
      expire_at: "2026-10-20T23:15:00Z",
      is_valid: true,
      scopes: { Orders: "VIEW_ONLY", reports: "full_access", item: "full_access" },
    });
    expect(scopes).toEqual({ orders: "view_only", reports: "full_access", inventory: "no_access" });
    expect(missingWalmartAccess(scopes).map((a) => a.label)).toEqual(["Inventory"]);
    expect(parseWalmartTokenDetail(null)).toEqual({
      orders: "no_access",
      reports: "no_access",
      inventory: "no_access",
    });
  });

  it("finds Walmart's own words in each of its error shapes", () => {
    expect(
      walmartErrorDetail({
        error: [{ code: "UNAUTHORIZED.GMP_GATEWAY_API", description: "Unauthorized" }],
      }),
    ).toBe("Unauthorized");
    expect(
      walmartErrorDetail({ errors: { error: [{ code: "SYSTEM_ERROR.GMP", info: "Try later" }] } }),
    ).toBe("Try later");
    expect(
      walmartErrorDetail({ error: "invalid_client", error_description: "Bad client secret" }),
    ).toBe("Bad client secret");
    expect(walmartErrorDetail({ error: "invalid_client" })).toBe("invalid_client");
    expect(walmartErrorDetail("nope")).toBeNull();
  });
});

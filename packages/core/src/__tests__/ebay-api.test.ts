import { describe, expect, it } from "vitest";
import {
  EBAY_SCOPES,
  ebayConsentUrl,
  ebayErrorDetail,
  ebayPublicKeyPem,
  parseEbayDeletionNotice,
  parseEbaySignatureHeader,
  parseEbayTokens,
  parseEbayUser,
} from "../commerce/ebay-api";

describe("eBay's API", () => {
  it("sends a seller to eBay's consent page with the app's redirect name and read scopes", () => {
    const url = new URL(
      ebayConsentUrl({
        authBase: "https://auth.sandbox.ebay.com",
        clientId: "Bookalyz-App-SBX-0000",
        ruName: "Bookalyze-Bookalyz-App-abc",
        state: "s.t.a.t.e",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.sandbox.ebay.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("Bookalyz-App-SBX-0000");
    expect(url.searchParams.get("redirect_uri")).toBe("Bookalyze-Bookalyz-App-abc");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("s.t.a.t.e");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...EBAY_SCOPES]);
    // Read-only, apart from the finances scope (eBay has no read-only one).
    expect(EBAY_SCOPES.some((s) => s.endsWith("sell.fulfillment"))).toBe(false);
  });

  it("reads the token endpoint's answers", () => {
    expect(
      parseEbayTokens({
        access_token: "v^1.1#a",
        expires_in: 7200,
        refresh_token: "v^1.1#r",
        refresh_token_expires_in: 47304000,
        token_type: "User Access Token",
      }),
    ).toEqual({
      accessToken: "v^1.1#a",
      expiresIn: 7200,
      refreshToken: "v^1.1#r",
      refreshTokenExpiresIn: 47304000,
    });
    expect(parseEbayTokens({ access_token: "v^1.1#b", expires_in: 7200 }).refreshToken).toBeNull();
    expect(() => parseEbayTokens({ error: "invalid_grant" })).toThrow(/access token/);
  });

  it("reads who the account is", () => {
    expect(
      parseEbayUser({
        userId: "abc123",
        username: "maple_goods",
        accountType: "BUSINESS",
        registrationMarketplaceId: "EBAY_CA",
        businessAccount: { name: "Synthetic" },
      }),
    ).toEqual({
      userId: "abc123",
      username: "maple_goods",
      accountType: "BUSINESS",
      registrationMarketplaceId: "EBAY_CA",
    });
    expect(() => parseEbayUser({ username: "x" })).toThrow(/which account/);
  });

  it("says why eBay refused, in its words", () => {
    expect(
      ebayErrorDetail({
        error: "invalid_grant",
        error_description: "the provided authorization grant code is invalid",
      }),
    ).toBe("invalid_grant: the provided authorization grant code is invalid");
    expect(
      ebayErrorDetail({ errors: [{ errorId: 1100, message: "Access denied", longMessage: "" }] }),
    ).toBe("Access denied");
    expect(ebayErrorDetail("nope")).toBeNull();
  });

  it("reads an account-deletion notice and its signature header", () => {
    expect(
      parseEbayDeletionNotice({
        metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0" },
        notification: { data: { username: "maple_goods", userId: "abc123", eiasToken: "x" } },
      }),
    ).toEqual({ userId: "abc123", username: "maple_goods" });
    expect(parseEbayDeletionNotice({ metadata: { topic: "OTHER" } })).toBeNull();

    const header = btoa(
      JSON.stringify({ alg: "ECDSA", kid: "k1", signature: "c2ln", digest: "SHA1" }),
    );
    expect(parseEbaySignatureHeader(header)).toEqual({
      kid: "k1",
      signature: "c2ln",
      alg: "ECDSA",
    });
    expect(parseEbaySignatureHeader("not base64 json")).toBeNull();
    expect(parseEbaySignatureHeader(null)).toBeNull();
  });

  it("puts eBay's one-line public keys into PEM form", () => {
    const body = "A".repeat(100);
    expect(ebayPublicKeyPem(`-----BEGIN PUBLIC KEY-----${body}-----END PUBLIC KEY-----`)).toBe(
      `-----BEGIN PUBLIC KEY-----\n${"A".repeat(64)}\n${"A".repeat(36)}\n-----END PUBLIC KEY-----\n`,
    );
  });
});

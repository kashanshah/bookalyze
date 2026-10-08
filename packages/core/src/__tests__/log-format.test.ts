import { describe, expect, it } from "vitest";
import { describeError, redactForLog, scrub } from "../log-format";

// Synthetic values shaped like credentials, built so scanners don't take them for real ones.
const armor = (edge: string) => `-----${edge} ${["PRIVATE", "KEY"].join(" ")}-----`;
const PEM = `${armor("BEGIN")}\nMIIEvQIBADANBg\n${armor("END")}`;
const JWT = ["eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJrZXkifQ", "c2lnbmF0dXJl"].join(".");

describe("scrub", () => {
  it("takes credentials out of free text", () => {
    const text = scrub(
      `key ${PEM} sent Bearer abc.def-123 and token ${JWT}, refresh Atzr|IwEBIabc, to jane.doe@example.com`,
    );
    expect(text).toBe(
      "key [pem] sent Bearer [redacted] and token [jwt], refresh Atzr|[redacted], to j…@example.com",
    );
  });

  it("keeps ordinary messages as they are, and long ones short", () => {
    expect(scrub("Amazon answered with an error (400).")).toBe(
      "Amazon answered with an error (400).",
    );
    expect(scrub("x".repeat(5000))).toHaveLength(2000);
  });
});

describe("redactForLog", () => {
  it("replaces secret-sounding keys and keeps IDs", () => {
    expect(
      redactForLog({
        orgId: "org-1",
        keyId: "key-0001",
        privateKey: "anything",
        clientSecret: "anything",
        refreshToken: "anything",
        headers: { Cookie: "_npsid=1", Authorization: "Bearer x", accept: "json" },
        nested: [{ password: "x", status: 403 }],
        when: new Date("2026-10-08T00:00:00Z"),
        big: 10n,
      }),
    ).toEqual({
      orgId: "org-1",
      keyId: "key-0001",
      privateKey: "[redacted]",
      clientSecret: "[redacted]",
      refreshToken: "[redacted]",
      headers: { Cookie: "[redacted]", Authorization: "[redacted]", accept: "json" },
      nested: [{ password: "[redacted]", status: 403 }],
      when: "2026-10-08T00:00:00.000Z",
      big: "10",
    });
  });

  it("stops at a reasonable depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redactForLog(deep))).toContain("[…]");
  });
});

describe("describeError", () => {
  it("keeps the name, message, our codes and the cause chain", () => {
    class ProviderError extends Error {
      constructor(
        message: string,
        readonly code: string,
        options?: { cause?: unknown },
      ) {
        super(message, options);
        this.name = "ProviderError";
      }
    }
    const cause = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    const error = new ProviderError("Noon couldn't be reached.", "unavailable", { cause });
    const described = describeError(error);
    expect(described).toMatchObject({
      name: "ProviderError",
      message: "Noon couldn't be reached.",
      code: "unavailable",
      cause: {
        name: "TypeError",
        message: "fetch failed",
        cause: { message: "connect ECONNREFUSED", code: "ECONNREFUSED" },
      },
    });
    expect(String(described.stack)).toContain("log-format.test");
  });

  it("keeps a Postgres error's code and constraint, and Next's digest", () => {
    const pg = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "contacts_name_key",
      digest: "2419504582",
    });
    expect(describeError(pg)).toMatchObject({
      code: "23505",
      constraint: "contacts_name_key",
      digest: "2419504582",
    });
  });

  it("describes things that aren't errors, scrubbed", () => {
    expect(describeError(`token ${JWT}`)).toEqual({ message: "token [jwt]" });
  });
});

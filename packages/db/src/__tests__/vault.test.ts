import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret, VaultError } from "../vault";

const key = randomBytes(32).toString("base64");

describe("vault", () => {
  it("round-trips a secret and never stores it in the clear", () => {
    const sealed = sealSecret("wise-token-123", "connection:a:b", key);
    expect(sealed).not.toContain("wise-token-123");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(openSecret(sealed, "connection:a:b", key)).toBe("wise-token-123");
  });

  it("uses a fresh nonce every time", () => {
    expect(sealSecret("same", "ctx", key)).not.toBe(sealSecret("same", "ctx", key));
  });

  it("refuses a secret moved to another connection, a wrong key or a tampered value", () => {
    const sealed = sealSecret("token", "connection:a:b", key);
    expect(() => openSecret(sealed, "connection:a:c", key)).toThrow(VaultError);
    expect(() => openSecret(sealed, "connection:a:b", randomBytes(32).toString("base64"))).toThrow(
      VaultError,
    );
    const parts = sealed.split(".");
    const tampered = [...parts.slice(0, 3), `${parts[3]?.slice(0, -2)}AA`].join(".");
    expect(() => openSecret(tampered, "connection:a:b", key)).toThrow(VaultError);
  });

  it("explains a missing or malformed key", () => {
    expect(() => sealSecret("x", "c", "")).toThrow(/APP_ENCRYPTION_KEY isn't set/);
    expect(() => sealSecret("x", "c", "short")).toThrow(/32 random bytes/);
  });
});

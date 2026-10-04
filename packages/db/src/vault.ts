import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts connection credentials at rest with AES-256-GCM. The key is APP_ENCRYPTION_KEY
 * (32 random bytes, base64). Each value is bound to where it belongs (`context`, e.g. the
 * organization and connection IDs), so a secret copied to another row won't decrypt.
 *
 * Format: "v1.<iv>.<tag>.<ciphertext>", each part base64url. The version lets the key or
 * algorithm change later without guessing.
 */

const VERSION = "v1";

export class VaultError extends Error {}

function keyFrom(raw: string | undefined): Buffer {
  if (!raw) throw new VaultError("APP_ENCRYPTION_KEY isn't set. See docs/SETUP.md.");
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    throw new VaultError(
      "APP_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32).",
    );
  }
  return key;
}

export function sealSecret(
  plaintext: string,
  context: string,
  rawKey: string | undefined = process.env.APP_ENCRYPTION_KEY,
): string {
  const key = keyFrom(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function openSecret(
  sealed: string,
  context: string,
  rawKey: string | undefined = process.env.APP_ENCRYPTION_KEY,
): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new VaultError("This saved credential is in a format we don't recognise.");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new VaultError(
      "This saved credential can't be decrypted. The encryption key may have changed; reconnect to save it again.",
    );
  }
}

/** The context a connection's secret is bound to. */
export const connectionSecretContext = (orgId: string, connectionId: string) =>
  `connection:${orgId}:${connectionId}`;

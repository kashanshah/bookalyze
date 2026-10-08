/**
 * Noon's partner API (noon-docs.noonpartners.dev). A seller makes a service account at
 * access.noon.partners → User & Access → API Users and downloads its key file once: a JSON file
 * with the key ID, an RSA private key (PEM) and the project code. Each login signs a short JWT
 * (RS256; `sub` = key ID, `iat` in whole seconds, a fresh `jti`) and posts it to the login
 * endpoint, which answers with session cookies used by every later call (valid for 30 days).
 * The HTTP side lives in the web app (server/noon.ts); this file only reads and shapes data.
 */

export const NOON_API_URL = "https://noon-api-gateway.noon.partners";
export const NOON_LOGIN_PATH = "/identity/public/v1/api/login";
export const NOON_EXPORT_CATEGORIES_PATH = "/impex/v1/export/category/list";

/** What Bookalyze keeps (sealed) from the key file. */
export type NoonCredentials = {
  keyId: string;
  /** PEM, "-----BEGIN PRIVATE KEY-----…". */
  privateKey: string;
  projectCode: string;
};

const KEY_FILE_HELP =
  "Choose the .json key file Noon downloaded when you added the service account (access.noon.partners → User & Access → API Users).";

/** Reads a Noon service-account key file. Throws, in plain words, when it isn't one. */
export function parseNoonKeyFile(text: string): NoonCredentials {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error(`This file isn't JSON. ${KEY_FILE_HELP}`);
  }
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const keyId = str(body.key_id);
  const privateKey = str(body.private_key).replace(/\\n/g, "\n");
  const projectCode = str(body.project_code);
  if (!keyId || !privateKey || !projectCode) {
    throw new Error(
      `This isn't a Noon key file: it needs a key ID, a private key and a project code. ${KEY_FILE_HELP}`,
    );
  }
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(privateKey)) {
    throw new Error(`The key file's private key can't be read. ${KEY_FILE_HELP}`);
  }
  if (keyId.length > 200 || projectCode.length > 100 || privateKey.length > 10_000) {
    throw new Error(`This file is too large to be a Noon key file. ${KEY_FILE_HELP}`);
  }
  return { keyId, privateKey, projectCode };
}

/** The JWT's header and claims; the web app signs them with the private key (RS256). */
export function noonLoginClaims(input: { keyId: string; now: Date; jti: string }) {
  return {
    header: { alg: "RS256", typ: "JWT" },
    // Whole seconds, no time zone: Noon refuses tokens more than five minutes off its clock.
    payload: { sub: input.keyId, iat: Math.floor(input.now.getTime() / 1000), jti: input.jti },
  };
}

/** `Set-Cookie` values as one `Cookie` header (name=value pairs only). */
export function noonCookieHeader(setCookies: readonly string[]): string {
  return setCookies
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter((c) => c.includes("="))
    .join("; ");
}

/**
 * Noon's error body, in one line: the new envelope `{ error: { code, message, fields } }` or the
 * older `{ status_code, message }`. Field problems are added after the message.
 */
export function noonErrorDetail(json: unknown): string | null {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const inner =
    body.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : body;
  const message = typeof inner.message === "string" ? inner.message.trim() : "";
  const code =
    typeof inner.code === "string"
      ? inner.code
      : typeof inner.status_code === "string"
        ? inner.status_code
        : "";
  const fields = Array.isArray(inner.fields)
    ? inner.fields.flatMap((f) => {
        const field = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
        const descriptions = Array.isArray(field.descriptions)
          ? field.descriptions.filter((d): d is string => typeof d === "string")
          : [];
        return descriptions.length
          ? [`${String(field.name ?? "")}: ${descriptions.join(", ")}`]
          : [];
      })
    : [];
  const text = [message, ...fields].filter(Boolean).join(" · ");
  if (!text && !code) return null;
  return (code && !text.includes(code) ? `${code}: ${text}` : text).slice(0, 300) || code;
}

export type NoonExportCategory = { code: string; params: string[] };

/** GET /impex/v1/export/category/list: the reports this project can download, with their inputs. */
export function parseExportCategories(json: unknown): NoonExportCategory[] {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (!Array.isArray(body.export_categories)) throw new Error("Unexpected response from Noon.");
  return body.export_categories.flatMap((raw): NoonExportCategory[] => {
    const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const code = typeof c.export_category_code === "string" ? c.export_category_code : "";
    if (!code) return [];
    const params = c.params && typeof c.params === "object" ? Object.keys(c.params) : [];
    return [{ code, params }];
  });
}

/** The item-level transaction view (sales, fees, refunds, payouts): what payouts come from. */
export const NOON_TRANSACTIONS_EXPORT = "noon_financeweb_transactionviewreportonitemlevel";

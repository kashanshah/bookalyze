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

export type NoonExportCategory = {
  code: string;
  params: string[];
  /** The params as Noon describes them (types or examples), shown when a report is checked. */
  spec: Record<string, string>;
};

/** GET /impex/v1/export/category/list: the reports this project can download, with their inputs. */
export function parseExportCategories(json: unknown): NoonExportCategory[] {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (!Array.isArray(body.export_categories)) throw new Error("Unexpected response from Noon.");
  return body.export_categories.flatMap((raw): NoonExportCategory[] => {
    const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const code = typeof c.export_category_code === "string" ? c.export_category_code : "";
    if (!code) return [];
    const raw_params =
      c.params && typeof c.params === "object" ? (c.params as Record<string, unknown>) : {};
    const spec = Object.fromEntries(
      Object.entries(raw_params).map(([k, v]) => [
        k,
        (typeof v === "string" ? v : (JSON.stringify(v) ?? "")).slice(0, 200),
      ]),
    );
    return [{ code, params: Object.keys(spec), spec }];
  });
}

/** The item-level transaction view (sales, fees, refunds, payouts): what payouts come from. */
export const NOON_TRANSACTIONS_EXPORT = "noon_financeweb_transactionviewreportonitemlevel";

export const NOON_EXPORT_CREATE_PATH = "/impex/v1/export/create";
export const NOON_EXPORT_STATUS_PATH = "/impex/v1/export/status";

/** POST /impex/v1/export/create: the export's code, to ask its status with. */
export function parseExportCreated(json: unknown): string {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const code = typeof body.export_code === "string" ? body.export_code.trim() : "";
  if (!code) throw new Error("Noon didn't say which export it made.");
  return code;
}

export type NoonExportStatus = {
  exportCode: string;
  /** Noon's own word for it, e.g. "PROCESSING" or "COMPLETED". */
  status: string;
  state: "ready" | "failed" | "working";
  downloadUrl: string | null;
};

/**
 * POST /impex/v1/export/status. Ready once Noon gives a download link; failed when its status
 * says so (failed, error, cancelled, expired); otherwise still being made.
 */
export function parseExportStatus(json: unknown): NoonExportStatus {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const status = typeof body.export_status === "string" ? body.export_status.trim() : "";
  const downloadUrl =
    typeof body.download_url === "string" && body.download_url.trim()
      ? body.download_url.trim()
      : null;
  const failed = /fail|error|cancel|expire|reject/i.test(status);
  return {
    exportCode: typeof body.export_code === "string" ? body.export_code : "",
    status: status || "unknown",
    state: failed ? "failed" : downloadUrl ? "ready" : "working",
    downloadUrl: failed ? null : downloadUrl,
  };
}

export type ReportFileKind = "csv" | "tsv" | "xlsx" | "zip" | "json" | "unknown";

export type ReportPreview = {
  kind: ReportFileKind;
  /** The header row (CSV/TSV), or the files inside (zip, xlsx). */
  columns: string[];
  /** Data rows after the header (CSV/TSV only). */
  rows: number | null;
  gzip: boolean;
};

/** Splits one CSV/TSV line, honouring double quotes ("a, b" stays one cell). */
export function splitDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/** File names inside a zip, from its central directory (no unpacking). */
export function zipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is in the last 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return [];
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names: string[] = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    names.push(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + extra + comment;
  }
  return names;
}

/**
 * What a downloaded report is (already gunzipped when `gzip`): its kind, and its columns
 * (CSV/TSV header) or the files inside (zip, xlsx). Never returns data rows' contents.
 */
export function previewReport(bytes: Uint8Array, gzip = false): ReportPreview {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zip) {
    const names = zipEntryNames(bytes);
    const xlsx = names.some((n) => n.startsWith("xl/"));
    return { kind: xlsx ? "xlsx" : "zip", columns: names.slice(0, 50), rows: null, gzip };
  }
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let keys: string[] = [];
    try {
      const json = JSON.parse(trimmed) as unknown;
      const first = Array.isArray(json) ? json[0] : json;
      if (first && typeof first === "object") keys = Object.keys(first).slice(0, 100);
    } catch {
      // Not JSON after all: fall through to the delimited reading.
    }
    if (keys.length) return { kind: "json", columns: keys, rows: null, gzip };
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0] ?? "";
  if (!header) return { kind: "unknown", columns: [], rows: null, gzip };
  const tabs = (header.match(/\t/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  if (!tabs && !commas)
    return { kind: "unknown", columns: [header.slice(0, 200)], rows: null, gzip };
  const delimiter = tabs > commas ? "\t" : ",";
  return {
    kind: delimiter === "\t" ? "tsv" : "csv",
    columns: splitDelimitedLine(header, delimiter)
      .map((c) => c.slice(0, 120))
      .slice(0, 200),
    rows: lines.length - 1,
    gzip,
  };
}

/**
 * The payouts report's inputs for a date range, named as Noon names them: a "from"/"start"
 * param gets the first day and a "to"/"end" param the last (YYYY-MM-DD). Without Noon's own
 * description, from_date and to_date.
 */
export function noonPayoutsParams(spec: unknown, from: string, to: string): Record<string, string> {
  const names =
    spec && typeof spec === "object" ? Object.keys(spec as Record<string, unknown>) : [];
  const params: Record<string, string> = {};
  for (const name of names) {
    if (/from|start/i.test(name)) params[name] = from;
    else if (/(^|_)to($|_)|end|until/i.test(name)) params[name] = to;
  }
  return Object.keys(params).length ? params : { from_date: from, to_date: to };
}

/**
 * Any report's inputs for a date range (`noonPayoutsParams`'s rule). A report Noon describes
 * without any date input gets none; one it doesn't describe gets from_date and to_date.
 */
export function noonReportParams(spec: unknown, from: string, to: string): Record<string, string> {
  const described = spec && typeof spec === "object" && Object.keys(spec).length > 0;
  const params = noonPayoutsParams(spec, from, to);
  if (!described) return params;
  const names = Object.keys(spec as Record<string, unknown>);
  return Object.fromEntries(Object.entries(params).filter(([k]) => names.includes(k)));
}

/** Plain names for Noon's report codes we know; others are spelled out from the code. */
const NOON_REPORT_NAMES: Record<string, string> = {
  [NOON_TRANSACTIONS_EXPORT]: "Transaction view (payouts)",
};

/** "noon_fbn_inventory_report" → "Fbn inventory report", or a known report's own name. */
export function noonReportName(code: string): string {
  const known = NOON_REPORT_NAMES[code];
  if (known) return known;
  const words = code
    .replace(/^noon_+/i, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

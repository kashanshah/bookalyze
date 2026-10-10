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
    const role = noonDateRole(name);
    if (role) params[name] = role === "from" ? from : to;
  }
  return Object.keys(params).length ? params : { from_date: from, to_date: to };
}

/** A name's words: from_date → from, date; fromDate → from, date. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whether an input is a range's first day ("from", "start") or last ("to", "end", "until"). */
export function noonDateRole(name: string): "from" | "to" | null {
  const words = nameWords(name);
  if (words.some((w) => w === "from" || w === "start")) return "from";
  if (words.some((w) => w === "to" || w === "end" || w === "until")) return "to";
  return null;
}

/** Whether a report input is a day (a range's ends, or any "…date", "…_at", "…_on" input). */
export function isNoonDateInput(name: string): boolean {
  const words = nameWords(name);
  return (
    noonDateRole(name) !== null ||
    words.includes("date") ||
    words.includes("day") ||
    /_(at|on)$/i.test(name)
  );
}

/** Words of a JSON schema, not input names. */
const SCHEMA_WORDS = new Set([
  "type",
  "format",
  "description",
  "title",
  "enum",
  "items",
  "default",
  "example",
  "examples",
  "pattern",
  "nullable",
  "required",
  "properties",
  "additionalProperties",
  "$schema",
]);

/** A value kept as text (the category list keeps each param as a string, cut at 200 characters). */
function specValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Quoted names in a JSON text that may have been cut short: an object's keys, or a list's items. */
function quotedNames(text: string, keys: boolean): string[] {
  const pattern = keys ? /"([A-Za-z0-9_]{1,60})"\s*:/g : /"([A-Za-z0-9_]{1,60})"/g;
  return [...text.matchAll(pattern)]
    .map((m) => m[1] ?? "")
    .filter((n) => n && !SCHEMA_WORDS.has(n));
}

/**
 * The names of a report's inputs as Noon describes them: plain names (`{ from_date: "string" }`),
 * or a JSON schema (`{ type, properties: {…}, required: […] }`, whole or cut short). Null when
 * Noon describes nothing.
 */
export function noonSpecFields(spec: unknown): string[] | null {
  if (!spec || typeof spec !== "object") return null;
  const entries = Object.entries(spec as Record<string, unknown>);
  if (!entries.length) return null;
  const names = new Set<string>();
  for (const [key, raw] of entries) {
    if (key === "properties") {
      const value = specValue(raw);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const name of Object.keys(value)) names.add(name);
      } else if (typeof value === "string") {
        for (const name of quotedNames(value, true)) names.add(name);
      }
    } else if (key === "required") {
      const value = specValue(raw);
      if (Array.isArray(value)) {
        for (const name of value) if (typeof name === "string") names.add(name);
      } else if (typeof value === "string") {
        for (const name of quotedNames(value, false)) names.add(name);
      }
    } else if (!SCHEMA_WORDS.has(key)) {
      names.add(key);
    }
  }
  return [...names].filter((n) => NOON_INPUT_NAME.test(n));
}

/**
 * Any report's inputs for a date range: the date inputs Noon names get the first and last day
 * (YYYY-MM-DD); a report Noon describes with inputs but no dates gets none; one it doesn't
 * describe (or describes in a way that names nothing) gets from_date and to_date. Inputs a person
 * typed win, dates included.
 */
export function noonReportParams(
  spec: unknown,
  from: string,
  to: string,
  /** Inputs a person filled in (country, status, or dates); blanks are left out. */
  inputs: Record<string, string> = {},
): Record<string, string> {
  const fields = noonSpecFields(spec);
  const params: Record<string, string> = {};
  for (const name of fields ?? []) {
    const role = noonDateRole(name);
    if (role) params[name] = role === "from" ? from : to;
  }
  if (!Object.keys(params).length && !fields?.length) {
    params.from_date = from;
    params.to_date = to;
  }
  for (const [k, v] of Object.entries(inputs)) {
    if (v.trim()) params[k] = v.trim();
  }
  return params;
}

/** A date input the check fills by itself: a range's first or last day. */
function isNoonDateParam(name: string): boolean {
  return noonDateRole(name) !== null;
}

/** A report input's name as Noon sends it (letters, digits and underscores). */
export const NOON_INPUT_NAME = /^[A-Za-z0-9_]{1,60}$/;

/**
 * A report's inputs other than its dates (country, status…), with Noon's description of each
 * (its type, or the values it takes): what a person fills in to check the report.
 */
export function noonReportInputs(spec: unknown): { name: string; hint: string }[] {
  const flat =
    spec && typeof spec === "object"
      ? (spec as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return (noonSpecFields(spec) ?? [])
    .filter((name) => !isNoonDateParam(name))
    .map((name) => {
      const v = flat[name];
      return {
        name,
        hint:
          v === undefined
            ? ""
            : (typeof v === "string" ? v : (JSON.stringify(v) ?? "")).slice(0, 200),
      };
    });
}

/**
 * The inputs Noon says a report is missing, from its answer ("Missing required fields: country,
 * noon_status"), so the check can ask for them.
 */
export function noonMissingFields(message: string): string[] {
  const match = /missing required fields?:?\s*([A-Za-z0-9_,\s]+)/i.exec(message);
  if (!match?.[1]) return [];
  return [
    ...new Set(
      match[1]
        .split(/[,\s]+/)
        .map((f) => f.trim())
        .filter((f) => NOON_INPUT_NAME.test(f) && f.toLowerCase() !== "and"),
    ),
  ];
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

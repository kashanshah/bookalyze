/**
 * Walmart's reconciliation (settlement) reports: one file per settlement, by its date. The list
 * of dates comes first (`availableReconFiles`, dates as MMDDYYYY), then a date's file
 * (`reconFile`, a CSV, sometimes zipped). Every sale, refund, commission, WFS fee, adjustment
 * and the payout are rows in it. This file only shapes requests and reads the list; the HTTP
 * side lives in the web app (server/walmart.ts).
 */

export const WALMART_RECON_DATES_PATH = "/v3/report/reconreport/availableReconFiles";
export const WALMART_RECON_FILE_PATH = "/v3/report/reconreport/reconFile";
/** The report's current version (the older "legacy" one has other columns). */
export const WALMART_RECON_VERSION = "v1";

/** The query for the list of settlement dates. */
export const walmartReconDatesQuery = () =>
  `${WALMART_RECON_DATES_PATH}?reportVersion=${WALMART_RECON_VERSION}`;

/** YYYY-MM-DD as Walmart's MMDDYYYY. */
export function walmartReportDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}${d}${y}`;
}

/** The query for one settlement's file. */
export function walmartReconFileQuery(iso: string): string {
  const params = new URLSearchParams({
    reportDate: walmartReportDate(iso),
    reportVersion: WALMART_RECON_VERSION,
  });
  return `${WALMART_RECON_FILE_PATH}?${params.toString()}`;
}

/** MMDDYYYY (or MM-DD-YYYY, or YYYY-MM-DD) as YYYY-MM-DD, or null. */
function isoOf(value: string): string | null {
  const s = value.trim();
  let m = /^(\d{2})-?(\d{2})-?(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Reads the list of settlement dates, newest first. Walmart has named the list
 * `availableApReportDates` and `availableReportDates`; any array of dates is taken.
 */
export function parseWalmartReconDates(json: unknown): string[] {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const arrays = [body.availableApReportDates, body.availableReportDates, json].filter(
    Array.isArray,
  ) as unknown[][];
  const dates = new Set<string>();
  for (const list of arrays) {
    for (const v of list) {
      const iso = typeof v === "string" ? isoOf(v) : null;
      if (iso) dates.add(iso);
    }
  }
  return [...dates].sort().reverse();
}

/**
 * The first file inside a zip archive: its name, how it's compressed (0 stored, 8 deflated) and
 * its bytes as stored. Null when it isn't a zip. The web app inflates deflated files.
 */
export function zipFirstFile(
  bytes: Uint8Array,
): { name: string; method: number; data: Uint8Array } | null {
  if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The central directory knows each file's size even when the local header doesn't.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const count = view.getUint16(end + 10, true);
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (name.endsWith("/")) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return null;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    return { name, method, data: bytes.subarray(start, start + size) };
  }
  return null;
}

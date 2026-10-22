import { readCsvTable } from "../import/csv";
import { formatDecimal, parseDecimal } from "../money";
import type { AdMetricRow } from "./ads";

/**
 * Walmart Connect's Sponsored Search API (docs/ADS.md §9), for what Walmart's ads cost per item
 * per day. Bookalyze is one API partner (its consumer ID, signing key and token); each advertiser
 * gives Bookalyze access in Walmart Connect's Ad Center and enters its advertiser ID here. Only
 * spend and attributed sales, from the item report (`adItem`): no keywords or bids. Walmart's
 * item IDs become the seller's SKUs through the Marketplace catalog. The HTTP side lives in the
 * web app (server/walmart-ads.ts). Built from Walmart's published API: confirm on a live account.
 */

export const WALMART_ADS_API_URL = "https://advertising.walmart.com/api";
export const WALMART_ADS_CAMPAIGNS_PATH = "/v1/campaigns";
export const WALMART_ADS_REPORT_PATH = "/v2/snapshot/report";
export const WALMART_ADS_SNAPSHOT_PATH = "/v1/snapshot";
/** The Marketplace catalog search, which finds a seller's SKU by Walmart's item ID. */
export const WALMART_CATALOG_SEARCH_PATH = "/v3/items/catalog/search";
/** Day-by-day rows are only given for the trailing 30 days. */
export const WALMART_ADS_MAX_REPORT_DAYS = 30;
export const WALMART_ADS_BACKFILL_DAYS = 30;
/** Attribution is 14 days, so the last 15 days are fetched again. */
export const WALMART_ADS_LOOKBACK_DAYS = 15;
/** A snapshot still pending after this long is given up on and asked again. */
export const WALMART_ADS_PENDING_LIMIT_MS = 6 * 60 * 60 * 1000;
export const WALMART_ADS_ATTRIBUTION = "14d";

/** The columns asked of the item report, one row per day, campaign, ad group and item. */
export const WALMART_ADS_METRICS = [
  "date",
  "campaignId",
  "campaignName",
  "adGroupId",
  "itemId",
  "itemName",
  "adSpend",
  "numAdsShown",
  "numAdsClicks",
  "attributedSales14days",
  "attributedOrders14days",
  "attributedUnits14days",
] as const;

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
const count = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
/** An amount as Walmart sends it (12.34, "12.34", "$1,234.5") as an exact 4-place decimal. */
function money(v: unknown): string {
  const raw =
    typeof v === "number"
      ? Number.isFinite(v)
        ? v.toFixed(4)
        : ""
      : text(v).replace(/[$,\s]/g, "");
  if (!raw) return "0.0000";
  try {
    return formatDecimal(parseDecimal(raw.replace(/(\.\d{4})\d+$/, "$1")));
  } catch {
    return "0.0000";
  }
}

/** An advertiser ID as Walmart shows it in Ad Center: digits only. */
export function parseWalmartAdvertiserId(value: string): string | null {
  const id = value.trim().replace(/\s+/g, "");
  return /^\d{1,20}$/.test(id) ? id : null;
}

/** What Walmart's request signature signs: consumer ID, timestamp and key version, each on a line. */
export function walmartAdsSignedText(input: {
  consumerId: string;
  timestamp: string;
  keyVersion: string;
}): string {
  return `${input.consumerId}\n${input.timestamp}\n${input.keyVersion}\n`;
}

/** The query that lists an advertiser's campaigns: how access is checked. */
export function walmartAdsCampaignsQuery(advertiserId: string): string {
  return `${WALMART_ADS_CAMPAIGNS_PATH}?advertiserId=${encodeURIComponent(advertiserId)}`;
}

/** GET /v1/campaigns: how many campaigns the advertiser has (an array, or `{ campaigns }`). */
export function parseWalmartAdsCampaigns(json: unknown): number {
  const list = Array.isArray(json) ? json : record(json).campaigns;
  if (!Array.isArray(list)) throw new Error("Walmart's list of campaigns didn't make sense.");
  return list.length;
}

/** The body of POST /v2/snapshot/report for the item report over some days. */
export function walmartAdsReportRequest(advertiserId: string, from: string, to: string) {
  return {
    advertiserId: Number(advertiserId),
    reportType: "adItem",
    // "date" among the metrics gives one row per day.
    reportMetrics: [...WALMART_ADS_METRICS],
    startDate: from,
    endDate: to,
  };
}

export type WalmartAdsSnapshot = {
  snapshotId: string;
  status: "pending" | "done" | "failed";
  url: string | null;
  failure: string | null;
};

/** POST /v2/snapshot/report and GET /v1/snapshot: the snapshot's state and its file. */
export function parseWalmartAdsSnapshot(json: unknown): WalmartAdsSnapshot {
  const body = Array.isArray(json) ? record(json[0]) : record(json);
  const snapshotId = text(body.snapshotId) || text(body.snapshot_id);
  if (!snapshotId) throw new Error("Walmart's report answer didn't make sense.");
  const status = text(body.jobStatus || body.status).toLowerCase();
  return {
    snapshotId,
    status:
      status === "done"
        ? "done"
        : ["failed", "expired", "error"].includes(status)
          ? "failed"
          : "pending",
    url: text(body.details) || text(body.url) || null,
    failure: text(body.error) || text(body.message) || (status === "expired" ? "expired" : null),
  };
}

/** "2026-10-09", "2026-10-09T00:00:00", "10/09/2026" or "20261009" as YYYY-MM-DD, or null. */
function day(value: string): string | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  if (m) return `${m[3]}-${m[1]?.padStart(2, "0")}-${m[2]?.padStart(2, "0")}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** The report file's rows as objects: a JSON array, lines of JSON, or CSV. */
function reportRecords(file: string): Record<string, unknown>[] {
  const s = file.replace(/^﻿/, "").trim();
  if (!s) return [];
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const json = JSON.parse(s) as unknown;
      if (Array.isArray(json)) return json.map(record);
      const body = record(json);
      const list = body.data ?? body.rows ?? body.report;
      if (Array.isArray(list)) return list.map(record);
      return [body];
    } catch {
      // One JSON object per line.
      return s
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return record(JSON.parse(l));
          } catch {
            return {};
          }
        });
    }
  }
  const table = readCsvTable(s);
  return table.rows.map((cells) =>
    Object.fromEntries(table.headers.map((h, i) => [h.trim(), cells[i] ?? ""])),
  );
}

/** A value by any of its names, case and spacing aside. */
function field(r: Record<string, unknown>, ...names: string[]): unknown {
  const wanted = names.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const [k, v] of Object.entries(r)) {
    if (wanted.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ""))) return v;
  }
  return undefined;
}

/**
 * The item report's file as ad metric rows (Walmart's Sponsored Products), one per day, campaign
 * and item: the item ID is the listing; its SKU is filled in from the catalog. Rows outside the
 * asked days, or without a day or an item, are dropped.
 */
export function parseWalmartAdsReport(
  file: string,
  range: { from: string; to: string },
): AdMetricRow[] {
  return reportRecords(file).flatMap((r): AdMetricRow[] => {
    const date = day(text(field(r, "date", "reportDate")));
    const itemId = text(field(r, "itemId", "item_id"));
    if (!date || !itemId || date < range.from || date > range.to) return [];
    return [
      {
        date,
        adType: "sponsored_products",
        campaignId: text(field(r, "campaignId")),
        campaignName: text(field(r, "campaignName")) || null,
        sku: null,
        listingRef: itemId,
        spend: money(field(r, "adSpend", "spend")),
        impressions: count(field(r, "numAdsShown", "impressions")),
        clicks: count(field(r, "numAdsClicks", "clicks")),
        attributedSales: money(field(r, "attributedSales14days", "attributedSales")),
        attributedOrders: count(field(r, "attributedOrders14days", "attributedOrders")),
        attributedUnits: count(field(r, "attributedUnits14days", "attributedUnits")),
        attributionWindow: WALMART_ADS_ATTRIBUTION,
      },
    ];
  });
}

/** The body of the Marketplace catalog search for one Walmart item ID. */
export function walmartCatalogSearchBody(itemId: string) {
  return { query: { field: "itemId", value: itemId } };
}

/** The catalog search's answer: the seller's SKU for the item ID, or null. */
export function parseWalmartCatalogSku(json: unknown, itemId: string): string | null {
  const body = record(json);
  const lists = [body.items, body.ItemResponse, record(body.payload).items, json];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const items = list.map(record);
    const match =
      items.find((i) => text(i.itemId ?? i.itemid ?? i.item_id) === itemId) ??
      (items.length === 1 ? items[0] : undefined);
    const sku = match ? text(match.sku) : "";
    if (sku) return sku;
  }
  return null;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The next days to ask Walmart for: the first time, the last 30 days; then on from where the last
 * report ended, but always the last 15 days again (attribution changes for 14). Null when there's
 * nothing to ask (today's report is in).
 */
export function nextWalmartAdsWindow(input: {
  today: string;
  doneThrough: string | null;
  doneOn: string | null;
}): { from: string; to: string } | null {
  const yesterday = addDays(input.today, -1);
  const earliest = addDays(input.today, -WALMART_ADS_BACKFILL_DAYS);
  if (input.doneThrough && input.doneThrough >= yesterday && input.doneOn === input.today) {
    return null;
  }
  let from = input.doneThrough ? addDays(input.doneThrough, 1) : earliest;
  const lookback = addDays(input.today, -WALMART_ADS_LOOKBACK_DAYS);
  if (from > lookback) from = lookback;
  if (from < earliest) from = earliest;
  const last = addDays(from, WALMART_ADS_MAX_REPORT_DAYS - 1);
  const to = last < yesterday ? last : yesterday;
  return from <= to ? { from, to } : null;
}

/** Walmart's own words from an error body ({ errors: [{ description }] }, { message }…). */
export function walmartAdsErrorDetail(json: unknown): string | null {
  const body = Array.isArray(json) ? record(json[0]) : record(json);
  const errors = Array.isArray(body.errors) ? body.errors.map(record) : [];
  const first = errors[0] ?? body;
  const why =
    text(first.description) || text(first.message) || text(first.info) || text(body.error);
  const code = text(first.code);
  if (!why && !code) return null;
  return [code, why].filter(Boolean).join(": ").slice(0, 300);
}

import "server-only";
import { createSign } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import {
  parseWalmartAdsCampaigns,
  parseWalmartAdsSnapshot,
  WALMART_ADS_API_URL,
  WALMART_ADS_REPORT_PATH,
  WALMART_ADS_SNAPSHOT_PATH,
  type WalmartAdsSnapshot,
  walmartAdsCampaignsQuery,
  walmartAdsErrorDetail,
  walmartAdsReportRequest,
  walmartAdsSignedText,
  zipFirstFile,
} from "@bookalyze/core";
import { env } from "./env";
import { logError, logWarn } from "./log";

/**
 * Walmart Connect's Sponsored Search API, as Bookalyze the API partner (docs/ADS.md §9): every
 * call carries the partner token, its consumer ID, the time and a signature made with the
 * partner's private key. Advertisers give Bookalyze access in Ad Center; nothing of theirs is
 * kept but their advertiser ID. Responses are parsed in @bookalyze/core.
 */

export class WalmartAdsError extends Error {
  constructor(
    message: string,
    readonly code: "no_access" | "throttled" | "unavailable" | "unexpected",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WalmartAdsError";
  }
}

/** Bookalyze's Walmart Connect partner keys, or null when this server has none. */
export function walmartAdsApp() {
  const e = env();
  if (!e.WALMART_ADS_CONSUMER_ID || !e.WALMART_ADS_PRIVATE_KEY || !e.WALMART_ADS_TOKEN) {
    return null;
  }
  return {
    consumerId: e.WALMART_ADS_CONSUMER_ID,
    privateKey: e.WALMART_ADS_PRIVATE_KEY.replace(/\\n/g, "\n"),
    keyVersion: e.WALMART_ADS_KEY_VERSION,
    token: e.WALMART_ADS_TOKEN,
    base: e.WALMART_ADS_API_URL ?? WALMART_ADS_API_URL,
  };
}

function requireApp() {
  const app = walmartAdsApp();
  if (!app) {
    throw new WalmartAdsError(
      "Walmart Connect isn't set up on this server yet: Bookalyze's partner keys are missing (docs/SETUP.md → Walmart Connect).",
      "unavailable",
    );
  }
  return app;
}

/** Walmart's signed headers for one call. */
function headers(app: NonNullable<ReturnType<typeof walmartAdsApp>>) {
  const timestamp = String(Date.now());
  let signature: string;
  try {
    signature = createSign("RSA-SHA256")
      .update(
        walmartAdsSignedText({ consumerId: app.consumerId, timestamp, keyVersion: app.keyVersion }),
      )
      .sign(app.privateKey, "base64");
  } catch (cause) {
    logError("walmart_ads.bad_key", cause);
    throw new WalmartAdsError(
      "Bookalyze's Walmart Connect signing key can't be read (WALMART_ADS_PRIVATE_KEY).",
      "unavailable",
      { cause },
    );
  }
  return {
    Authorization: `Bearer ${app.token}`,
    "WM_CONSUMER.ID": app.consumerId,
    "WM_CONSUMER.intimestamp": timestamp,
    "WM_SEC.KEY_VERSION": app.keyVersion,
    "WM_SEC.AUTH_SIGNATURE": signature,
    Accept: "application/json",
  };
}

async function call(path: string, init: { method?: string; body?: unknown } = {}) {
  const app = requireApp();
  let response: Response;
  try {
    response = await fetch(`${app.base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...headers(app),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    logError("walmart_ads.unreachable", cause, { path });
    throw new WalmartAdsError(
      "Walmart Connect couldn't be reached. Try again in a minute.",
      "unavailable",
      { cause },
    );
  }
  if (response.ok) return response.json().catch(() => ({}));
  const why = walmartAdsErrorDetail(await response.json().catch(() => null));
  logWarn("walmart_ads.request_failed", { path: path.split("?")[0], status: response.status, why });
  if (response.status === 401 || response.status === 403) {
    throw new WalmartAdsError(
      `Walmart Connect didn't give Bookalyze access to this advertiser${why ? ` (${why})` : ""}. In Ad Center, open Admin → API partners, add Bookalyze with reporting access, and check the advertiser ID.`,
      "no_access",
    );
  }
  if (response.status === 429) {
    throw new WalmartAdsError(
      "Walmart Connect is limiting requests right now. Try again later.",
      "throttled",
    );
  }
  if (response.status >= 500) {
    throw new WalmartAdsError("Walmart Connect is having trouble. Try again soon.", "unavailable");
  }
  throw new WalmartAdsError(
    `Walmart Connect answered with an error (${response.status})${why ? `: ${why}` : ""}.`,
    "unexpected",
  );
}

/** Checks Bookalyze can read an advertiser: how many campaigns it has. */
export async function checkWalmartAdvertiser(advertiserId: string): Promise<number> {
  try {
    return parseWalmartAdsCampaigns(await call(walmartAdsCampaignsQuery(advertiserId)));
  } catch (cause) {
    if (cause instanceof WalmartAdsError) throw cause;
    throw new WalmartAdsError("Walmart Connect's answer didn't make sense.", "unexpected", {
      cause,
    });
  }
}

/** Asks for the item report over some days; Walmart makes it in the background. */
export async function createWalmartAdsReport(
  advertiserId: string,
  from: string,
  to: string,
): Promise<string> {
  const json = await call(WALMART_ADS_REPORT_PATH, {
    method: "POST",
    body: walmartAdsReportRequest(advertiserId, from, to),
  });
  try {
    return parseWalmartAdsSnapshot(json).snapshotId;
  } catch (cause) {
    throw new WalmartAdsError("Walmart Connect didn't start the report.", "unexpected", { cause });
  }
}

export async function walmartAdsSnapshot(
  advertiserId: string,
  snapshotId: string,
): Promise<WalmartAdsSnapshot> {
  const query = new URLSearchParams({ advertiserId, snapshotId });
  const json = await call(`${WALMART_ADS_SNAPSHOT_PATH}?${query.toString()}`);
  try {
    return parseWalmartAdsSnapshot(json);
  } catch (cause) {
    throw new WalmartAdsError("Walmart Connect's report answer didn't make sense.", "unexpected", {
      cause,
    });
  }
}

/** A finished snapshot's file as text: gzipped, zipped or plain. Signed when it's Walmart's API. */
export async function downloadWalmartAdsReport(url: string): Promise<string> {
  const app = requireApp();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: url.startsWith(app.base) ? headers(app) : {},
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (cause) {
    throw new WalmartAdsError(
      "Walmart Connect's report couldn't be downloaded. Try again soon.",
      "unavailable",
      { cause },
    );
  }
  if (!response.ok) {
    throw new WalmartAdsError(
      `Walmart Connect's report couldn't be downloaded (${response.status}).`,
      "unavailable",
    );
  }
  let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
  try {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(gunzipSync(bytes));
    const zipped = zipFirstFile(bytes);
    if (zipped) {
      bytes = zipped.method === 8 ? new Uint8Array(inflateRawSync(zipped.data)) : zipped.data;
    }
  } catch (cause) {
    throw new WalmartAdsError("Walmart Connect's report file couldn't be opened.", "unexpected", {
      cause,
    });
  }
  return new TextDecoder("utf-8").decode(bytes);
}

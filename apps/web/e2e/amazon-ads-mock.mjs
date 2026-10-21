// A stand-in for Amazon Ads: Login with Amazon's consent page and token endpoint, the Ads API's
// profiles and v3 asynchronous reports, and the report files (gzipped JSON), for end-to-end tests
// only. Synthetic data. Reports are ready at once.
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

const port = Number(process.env.AMAZON_ADS_MOCK_PORT ?? 4016);
const base = `http://localhost:${port}`;
const CLIENT_ID = "amzn1.application-oa2-client.e2e0000000000000000000000000000";
const CLIENT_SECRET = "amzn1.oa2-cs.v1.e2e-client-secret-0000";
const CODE = "e2e-ads-consent-code";
const REFRESH = "Atzr|e2e-ads-refresh-token";
const ACCESS = "Atza|e2e-ads-access-token";
const PROFILE_CA = "3456789012345678";

let declineNext = false;
const reports = new Map();
let nextReport = 1;

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
  });

const days = (from, to) => {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); ) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

/**
 * Every day: the maple mug's exact-match campaign (spend, and a sale every other day), an oak
 * board advertised with no sales at all, and a Sponsored Brands campaign with no SKU.
 */
function rowsFor(report) {
  const all = days(report.startDate, report.endDate);
  if (report.configuration.reportTypeId === "spAdvertisedProduct") {
    return all.flatMap((date, i) => [
      {
        date,
        campaignId: 51001,
        campaignName: "Maple mug – exact",
        advertisedAsin: "B0E2E00001",
        advertisedSku: "MAPLE-MUG",
        impressions: 820,
        clicks: 6,
        cost: 4.25,
        sales7d: i % 2 === 0 ? 24.99 : 0,
        purchases7d: i % 2 === 0 ? 1 : 0,
        unitsSoldClicks7d: i % 2 === 0 ? 1 : 0,
      },
      // The same SKU in a second ad group of the campaign: added to the row above.
      {
        date,
        campaignId: 51001,
        campaignName: "Maple mug – exact",
        advertisedAsin: "B0E2E00001",
        advertisedSku: "MAPLE-MUG",
        impressions: 100,
        clicks: 1,
        cost: 0.75,
        sales7d: 0,
        purchases7d: 0,
        unitsSoldClicks7d: 0,
      },
      {
        date,
        campaignId: 51002,
        campaignName: "Oak board – auto",
        advertisedAsin: "B0E2E00009",
        advertisedSku: "OAK-BOARD",
        impressions: 300,
        clicks: 2,
        cost: 1.5,
        sales7d: 0,
        purchases7d: 0,
        unitsSoldClicks7d: 0,
      },
    ]);
  }
  return all.map((date) => ({
    date,
    campaignId: 61001,
    campaignName: "Brand – kitchen",
    impressions: 2000,
    clicks: 3,
    cost: 2.1,
    sales: 0,
    purchases: 0,
    unitsSold: 0,
  }));
}

const authorized = (req) =>
  req.headers.authorization === `Bearer ${ACCESS}` &&
  req.headers["amazon-advertising-api-clientid"] === CLIENT_ID;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", base);
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (url.pathname === "/test/decline-next") {
    declineNext = true;
    return send(res, 200, { ok: true });
  }

  // Login with Amazon's consent page: agrees (or declines) at once and sends the browser back.
  if (url.pathname === "/ap/oa") {
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const back = new URL(redirect);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    if (
      url.searchParams.get("client_id") !== CLIENT_ID ||
      url.searchParams.get("scope") !== "advertising::campaign_management"
    ) {
      back.searchParams.set("error", "invalid_request");
    } else if (declineNext) {
      declineNext = false;
      back.searchParams.set("error", "access_denied");
    } else {
      back.searchParams.set("code", CODE);
    }
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }

  if (url.pathname === "/auth/o2/token" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) {
      return send(res, 401, { error: "invalid_client" });
    }
    if (form.get("grant_type") === "authorization_code" && form.get("code") === CODE) {
      return send(res, 200, {
        access_token: ACCESS,
        refresh_token: REFRESH,
        token_type: "bearer",
        expires_in: 3600,
      });
    }
    if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === REFRESH) {
      return send(res, 200, { access_token: ACCESS, token_type: "bearer", expires_in: 3600 });
    }
    return send(res, 400, { error: "invalid_grant" });
  }

  if (url.pathname === "/v2/profiles") {
    if (!authorized(req))
      return send(res, 401, { code: "UNAUTHORIZED", details: "Not authorized" });
    return send(res, 200, [
      {
        profileId: Number(PROFILE_CA),
        countryCode: "CA",
        currencyCode: "CAD",
        timezone: "America/Toronto",
        accountInfo: {
          marketplaceStringId: "A2EUQ1WTGCTBG2",
          id: "A1E2EADVERTISER",
          type: "seller",
          name: "Maple Goods",
        },
      },
      {
        profileId: 9876543210,
        countryCode: "US",
        currencyCode: "USD",
        timezone: "America/Los_Angeles",
        accountInfo: {
          marketplaceStringId: "ATVPDKIKX0DER",
          id: "A1E2EADVERTISER",
          type: "seller",
          name: "Maple Goods US",
        },
      },
    ]);
  }

  if (url.pathname === "/reporting/reports" && req.method === "POST") {
    if (!authorized(req) || req.headers["amazon-advertising-api-scope"] !== PROFILE_CA) {
      return send(res, 401, { code: "UNAUTHORIZED", details: "Not authorized" });
    }
    if (req.headers["content-type"] !== "application/vnd.createasyncreportrequest.v3+json") {
      return send(res, 415, { code: "415", detail: "Unsupported media type" });
    }
    const body = JSON.parse(await readBody(req));
    const reportId = `e2e0000-0000-4000-8000-${String(nextReport++).padStart(12, "0")}`;
    reports.set(reportId, body);
    return send(res, 200, { reportId, status: "PENDING", name: body.name });
  }

  const status = /^\/reporting\/reports\/([\w-]+)$/.exec(url.pathname);
  if (status && req.method === "GET") {
    if (!authorized(req))
      return send(res, 401, { code: "UNAUTHORIZED", details: "Not authorized" });
    const report = reports.get(status[1]);
    if (!report) return send(res, 404, { code: "NOT_FOUND", detail: "No such report" });
    return send(res, 200, {
      reportId: status[1],
      status: "COMPLETED",
      url: `${base}/download/${status[1]}`,
    });
  }

  const download = /^\/download\/([\w-]+)$/.exec(url.pathname);
  if (download) {
    const report = reports.get(download[1]);
    if (!report) return send(res, 404, { message: "No such file" });
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    return res.end(gzipSync(JSON.stringify(rowsFor(report))));
  }

  send(res, 404, { message: `No stand-in for ${req.method} ${url.pathname}` });
});

server.listen(port);

// A stand-in for Walmart's Marketplace API (token and token detail), for end-to-end tests only.
// Synthetic keys: nothing real is kept in the repo. Like Walmart, it wants WM_SVC.NAME, a
// correlation ID and the market on every call, Basic client ID and secret for the token, and the
// token in WM_SEC.ACCESS_TOKEN after that.
import { createVerify, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";

const port = Number(process.env.WALMART_MOCK_PORT ?? 4014);

// Each key belongs to one market's seller account and may see different areas.
const KEYS = {
  "wmt-e2e-ca-client": {
    secret: "wmt-e2e-ca-secret",
    market: "ca",
    scopes: {
      orders: "view_only",
      reports: "full_access",
      inventory: "no_access",
      item: "full_access",
    },
  },
  "wmt-e2e-ca-full": {
    secret: "wmt-e2e-ca-full-secret",
    market: "ca",
    scopes: { orders: "full_access", reports: "full_access", inventory: "view_only" },
  },
};
const tokens = new Map();

// Walmart Canada's orders, a few days old: two the seller shipped (the mug's SKU is linked to a
// product; one order cancelled) and one Walmart shipped (WFS). Synthetic buyers and places.
const daysAgo = (n) => Date.now() - n * 86_400_000;
const charge = (type, amount, tax) => ({
  chargeType: type,
  chargeName: type === "PRODUCT" ? "ItemPrice" : "Shipping",
  chargeAmount: { currency: "CAD", amount },
  ...(tax !== undefined
    ? { tax: { taxName: "HST", taxAmount: { currency: "CAD", amount: tax } } }
    : {}),
});
const wmtOrder = ({ po, days, node, sku, title, qty, price, tax, status }) => ({
  purchaseOrderId: po,
  customerOrderId: `C${po}`,
  customerEmailId: "synthetic-buyer@relay.walmart.com",
  orderDate: daysAgo(days),
  shippingInfo: {
    phone: "0000000000",
    estimatedDeliveryDate: daysAgo(days - 5),
    postalAddress: {
      name: "Synthetic Buyer",
      address1: "1 Test Street",
      city: "Toronto",
      state: "ON",
      postalCode: "M0M 0M0",
      country: "CAN",
    },
  },
  orderLines: {
    orderLine: [
      {
        lineNumber: "1",
        item: { productName: title, sku },
        charges: { charge: [charge("PRODUCT", price, tax), charge("SHIPPING", 0)] },
        orderLineQuantity: { unitOfMeasurement: "EACH", amount: String(qty) },
        statusDate: daysAgo(days - 1),
        orderLineStatuses: {
          orderLineStatus: [
            { status, statusQuantity: { unitOfMeasurement: "EACH", amount: String(qty) } },
          ],
        },
      },
    ],
  },
  shipNode: { type: node },
});
const ORDERS = [
  wmtOrder({
    po: "108800000001",
    days: 6,
    node: "SellerFulfilled",
    sku: "WMT-MAPLE-MUG",
    title: "Maple leaf ceramic mug",
    qty: 2,
    price: 39.98,
    tax: 5.2,
    status: "Shipped",
  }),
  wmtOrder({
    po: "108800000002",
    days: 4,
    node: "SellerFulfilled",
    sku: "WMT-TEA-TOWEL",
    title: "Linen tea towel",
    qty: 1,
    price: 14.5,
    tax: 1.89,
    status: "Cancelled",
  }),
  wmtOrder({
    po: "108800000003",
    days: 3,
    node: "WFSFulfilled",
    sku: "WMT-MAPLE-MUG",
    title: "Maple leaf ceramic mug",
    qty: 1,
    price: 19.99,
    tax: 2.6,
    status: "Delivered",
  }),
];

// Settlement reports: two dates, each file a zipped CSV like Walmart's (synthetic rows).
const pad = (n) => String(n).padStart(2, "0");
const reportDay = (days) => {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${d.getUTCFullYear()}`;
};
const SETTLEMENT_DATES = [reportDay(2), reportDay(16)];
/** A settlement's file: its two weeks end two days before the report date (synthetic rows). */
const settlementCsv = (date) => {
  const day = (back) => {
    const d = new Date(
      Date.UTC(Number(date.slice(4)), Number(date.slice(0, 2)) - 1, Number(date.slice(2, 4))) -
        back * 86_400_000,
    );
    return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
  };
  const [from, to, sold, shipped] = [day(15), day(2), day(12), day(8)];
  return [
    "Period Start Date,Period End Date,Total Payout,Currency,Transaction Key,Transaction Posted Timestamp,Transaction Type,Purchase Order #,Purchase Order line #,Amount,Amount Type,Ship Qty,Partner Item Id,Fulfillment Type,Ship to City,Ship to Zipcode",
    `${from},${to},52.07,CAD,T-1,${sold},Sale,108800000001,1,39.98,Product Price,2,WMT-MAPLE-MUG,Seller Fulfilled,Toronto,M0M 0M0`,
    `${from},${to},52.07,CAD,T-1,${sold},Sale,108800000001,1,-6.00,Commission on Product,2,WMT-MAPLE-MUG,Seller Fulfilled,Toronto,M0M 0M0`,
    `${from},${to},52.07,CAD,T-2,${shipped},Sale,108800000003,1,19.99,Product Price,1,WMT-MAPLE-MUG,WFS,Toronto,M0M 0M0`,
    `${from},${to},52.07,CAD,T-2,${shipped},Sale,108800000003,1,-1.90,Walmart Fulfillment Services Fee,1,WMT-MAPLE-MUG,WFS,Toronto,M0M 0M0`,
  ].join("\n");
};

/** A one-file zip, deflated, as Walmart sends its report files. */
function zipOf(name, text) {
  const file = Buffer.from(name);
  const raw = Buffer.from(text);
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(raw), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(raw), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(file.length, 28);
  central.writeUInt32LE(0, 42);
  const head = Buffer.concat([local, file, data]);
  const dir = Buffer.concat([central, file]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(head.length, 16);
  return Buffer.concat([head, dir, end]);
}

/** One order a page, so Walmart's cursor is followed. */
function ordersPage(url) {
  const node = url.searchParams.get("shipNodeType") ?? "SellerFulfilled";
  const start = Date.parse(
    url.searchParams.get("createdStartDate") ??
      url.searchParams.get("lastModifiedStartDate") ??
      "1970-01-01",
  );
  const end = Date.parse(
    url.searchParams.get("createdEndDate") ??
      url.searchParams.get("lastModifiedEndDate") ??
      "2999-01-01",
  );
  const index = Number(url.searchParams.get("soIndex") ?? "0");
  const matching = ORDERS.filter(
    (o) => o.shipNode.type === node && o.orderDate >= start && o.orderDate <= end,
  );
  const order = matching[index];
  const next = new URLSearchParams(url.searchParams);
  next.set("soIndex", String(index + 1));
  next.set("limit", "1");
  return {
    list: {
      meta: {
        totalCount: matching.length,
        limit: 1,
        nextCursor: index + 1 < matching.length ? `?${next.toString()}` : null,
      },
      elements: { order: order ? [order] : [] },
    },
  };
}

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const walmartError = (res, status, code, description) =>
  send(res, status, { error: [{ code, field: code, description, severity: "ERROR" }] });

// --- Walmart Connect (Sponsored Search), under /wca: Bookalyze as an API partner -------------
// The partner token and public key come from playwright.config.ts (a key made for the run).
const ADVERTISER = "600123";
const snapshots = new Map();
const isoDaysAgo = (n) =>
  new Date(Number(process.env.E2E_NOW ?? Date.now()) - n * 86_400_000).toISOString().slice(0, 10);

/** Walmart Connect checks the partner token and the signature of consumer ID, time and version. */
function partnerSigned(req) {
  const consumerId = String(req.headers["wm_consumer.id"] ?? "");
  const timestamp = String(req.headers["wm_consumer.intimestamp"] ?? "");
  const version = String(req.headers["wm_sec.key_version"] ?? "");
  const signature = String(req.headers["wm_sec.auth_signature"] ?? "");
  if (req.headers.authorization !== `Bearer ${process.env.E2E_WALMART_ADS_TOKEN}`) return false;
  if (!consumerId || !timestamp || !version || !signature) return false;
  try {
    return createVerify("RSA-SHA256")
      .update(`${consumerId}\n${timestamp}\n${version}\n`)
      .verify(String(process.env.E2E_WALMART_ADS_PUBLIC_KEY ?? ""), signature, "base64");
  } catch {
    return false;
  }
}

function walmartConnect(req, res, url, body) {
  const partnerError = (status, code, description) =>
    send(res, status, { errors: [{ code, description }] });
  if (!partnerSigned(req)) return partnerError(401, "UNAUTHORIZED", "Invalid partner signature");
  const advertiser = String(url.searchParams.get("advertiserId") ?? "");
  if (url.pathname === "/wca/v1/campaigns" && req.method === "GET") {
    if (advertiser !== ADVERTISER) {
      return partnerError(401, "UNAUTHORIZED", "The partner has no access to this advertiser");
    }
    return send(res, 200, [
      { campaignId: 77, name: "Maple mugs", campaignType: "auto" },
      { campaignId: 78, name: "Totes", campaignType: "manual" },
    ]);
  }
  if (url.pathname === "/wca/v2/snapshot/report" && req.method === "POST") {
    const ask = JSON.parse(body || "{}");
    if (String(ask.advertiserId) !== ADVERTISER || ask.reportType !== "adItem") {
      return partnerError(400, "INVALID_REQUEST", "Unknown advertiser or report type");
    }
    const snapshotId = `SNAP-${randomUUID()}`;
    snapshots.set(snapshotId, { from: ask.startDate, to: ask.endDate });
    return send(res, 200, { code: "success", snapshotId, jobStatus: "pending" });
  }
  if (url.pathname === "/wca/v1/snapshot" && req.method === "GET") {
    const id = String(url.searchParams.get("snapshotId") ?? "");
    if (advertiser !== ADVERTISER || !snapshots.has(id)) {
      return partnerError(404, "NOT_FOUND", "No such snapshot");
    }
    return send(res, 200, [
      {
        snapshotId: id,
        jobStatus: "done",
        details: `http://localhost:${port}/wca/files/${id}.json.gz`,
      },
    ]);
  }
  const file = /^\/wca\/files\/(.+)\.json\.gz$/.exec(url.pathname);
  if (file && req.method === "GET") {
    const asked = snapshots.get(file[1]);
    if (!asked) return partnerError(404, "NOT_FOUND", "No such file");
    // The maple mug (item 5551) on two days, and an item the seller's catalog doesn't know.
    const rows = [
      {
        date: isoDaysAgo(5),
        campaignId: 77,
        campaignName: "Maple mugs",
        itemId: 5551,
        adSpend: 3.1,
        numAdsShown: 400,
        numAdsClicks: 9,
        attributedSales14days: 19.99,
        attributedOrders14days: 1,
        attributedUnits14days: 1,
      },
      {
        date: isoDaysAgo(3),
        campaignId: 77,
        campaignName: "Maple mugs",
        itemId: 5551,
        adSpend: 4.2,
        numAdsShown: 520,
        numAdsClicks: 12,
        attributedSales14days: 39.98,
        attributedOrders14days: 2,
        attributedUnits14days: 2,
      },
      {
        date: isoDaysAgo(3),
        campaignId: 78,
        campaignName: "Totes",
        itemId: 9999,
        adSpend: 1,
        numAdsShown: 80,
        numAdsClicks: 1,
        attributedSales14days: 0,
        attributedOrders14days: 0,
        attributedUnits14days: 0,
      },
    ].filter((r) => r.date >= asked.from && r.date <= asked.to);
    res.writeHead(200, { "Content-Type": "application/gzip" });
    return res.end(gzipSync(JSON.stringify(rows)));
  }
  return partnerError(404, "NOT_FOUND", "Not found");
}

/** Walmart refuses calls without its own headers. */
function missingHeaders(req) {
  return (
    !req.headers["wm_svc.name"] || !req.headers["wm_qos.correlation_id"] || !req.headers.wm_market
  );
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/wca/")) return walmartConnect(req, res, url, body);

    if (url.pathname === "/v3/token" && req.method === "POST") {
      if (missingHeaders(req))
        return walmartError(res, 400, "INVALID_REQUEST_HEADER.GMP_GATEWAY_API", "Missing headers");
      if (new URLSearchParams(body).get("grant_type") !== "client_credentials") {
        return send(res, 400, { error: "unsupported_grant_type" });
      }
      const auth = String(req.headers.authorization ?? "");
      const [id, secret] = Buffer.from(auth.replace(/^Basic /, ""), "base64")
        .toString()
        .split(":");
      const key = KEYS[id ?? ""];
      if (!key || key.secret !== secret) {
        return walmartError(res, 401, "UNAUTHORIZED.GMP_GATEWAY_API", "Invalid client credentials");
      }
      if (key.market !== req.headers.wm_market) {
        return walmartError(
          res,
          401,
          "UNAUTHORIZED.GMP_GATEWAY_API",
          "This key belongs to another market",
        );
      }
      const token = `wmt-e2e-token-${randomUUID()}`;
      tokens.set(token, id);
      return send(res, 200, { access_token: token, token_type: "Bearer", expires_in: 900 });
    }

    if (missingHeaders(req))
      return walmartError(res, 400, "INVALID_REQUEST_HEADER.GMP_GATEWAY_API", "Missing headers");
    const id = tokens.get(String(req.headers["wm_sec.access_token"] ?? ""));
    if (!id) return walmartError(res, 401, "UNAUTHORIZED.GMP_GATEWAY_API", "Unauthorized token");

    // The catalog search, by Walmart's item ID: only the maple mug is known.
    if (url.pathname === "/v3/items/catalog/search" && req.method === "POST") {
      const value = String(JSON.parse(body || "{}")?.query?.value ?? "");
      return send(res, 200, {
        items: value === "5551" ? [{ itemId: "5551", sku: "WMT-MAPLE-MUG", wpid: "WPID5551" }] : [],
        totalItems: value === "5551" ? 1 : 0,
      });
    }

    if (url.pathname === "/v3/token/detail" && req.method === "GET") {
      const now = Date.now();
      return send(res, 200, {
        expire_at: new Date(now + 900_000).toISOString(),
        issued_at: new Date(now).toISOString(),
        is_valid: true,
        scopes: KEYS[id].scopes,
      });
    }

    if (url.pathname === "/v3/orders" && req.method === "GET") {
      if (KEYS[id].scopes.orders === "no_access") {
        return walmartError(res, 403, "FORBIDDEN.GMP_GATEWAY_API", "No access to orders");
      }
      return send(res, 200, ordersPage(url));
    }

    // Items by SKU: their GTIN, which WFS's inventory log is asked for by.
    const item = /^\/v3\/items\/([^/]+)$/.exec(url.pathname);
    if (item && req.method === "GET") {
      const sku = decodeURIComponent(item[1] ?? "");
      const gtin = { "WMT-MAPLE-MUG": "00012345678905", "WMT-SPARE-TOTE": "00012345678912" }[sku];
      if (!gtin) return walmartError(res, 404, "CONTENT_NOT_FOUND.GMP_GATEWAY_API", "No item");
      return send(res, 200, { ItemResponse: [{ sku, gtin, productName: sku }], totalItems: 1 });
    }

    // WFS's inventory log: the mug was received, sold, returned, damaged and put on a hold
    // Bookalyze doesn't read yet; the tote has had nothing happen (days before today).
    if (url.pathname === "/v3/fulfillment/inventory-log" && req.method === "GET") {
      if (KEYS[id].scopes.inventory === "no_access") {
        return walmartError(res, 403, "FORBIDDEN.GMP_GATEWAY_API", "No access to inventory");
      }
      const gtin = url.searchParams.get("gtin");
      const at = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
      const log =
        gtin === "00012345678905"
          ? [
              {
                id: "WFS-L1",
                fcName: "YYZ1",
                transactionType: "Receiving",
                transactionTime: at(20),
                changedQty: 10,
              },
              {
                id: "WFS-L2",
                fcName: "YYZ1",
                transactionType: "Customer Order",
                transactionTime: at(9),
                changedQty: -2,
              },
              {
                id: "WFS-L3",
                fcName: "YYZ1",
                transactionType: "Customer Return",
                transactionTime: at(6),
                changedQty: 1,
              },
              {
                id: "WFS-L4",
                fcName: "YYZ1",
                transactionType: "Inventory Adjustment",
                transactionReasonDesc: "Damaged",
                transactionTime: at(4),
                changedQty: -1,
              },
              {
                id: "WFS-L5",
                fcName: "YYZ1",
                transactionType: "Quality Hold",
                transactionTime: at(3),
                changedQty: -1,
              },
            ]
          : [];
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "10");
      return send(res, 200, {
        headers: { totalCount: log.length, offset, limit },
        payload: {
          gtin,
          productName: "Maple leaf ceramic mug",
          inventoryLog: log.slice(offset, offset + limit),
        },
      });
    }

    // What WFS holds: the linked mug, and a tote not linked to any product (synthetic SKUs).
    if (url.pathname === "/v3/fulfillment/inventory" && req.method === "GET") {
      if (KEYS[id].scopes.inventory === "no_access") {
        return walmartError(res, 403, "FORBIDDEN.GMP_GATEWAY_API", "No access to inventory");
      }
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "10");
      const inventory = [
        {
          sku: "WMT-MAPLE-MUG",
          shipNodes: [{ shipNodeType: "WFSFulfilled", availToSellQty: 30, onHandQty: 34 }],
        },
        {
          sku: "WMT-SPARE-TOTE",
          shipNodes: [{ shipNodeType: "WFSFulfilled", availToSellQty: 5, onHandQty: 5 }],
        },
      ];
      return send(res, 200, {
        headers: { totalCount: inventory.length, limit, offset },
        payload: { inventory: inventory.slice(offset, offset + limit) },
      });
    }

    if (url.pathname === "/v3/report/reconreport/availableReconFiles" && req.method === "GET") {
      return send(res, 200, { availableApReportDates: SETTLEMENT_DATES });
    }
    if (url.pathname === "/v3/report/reconreport/reconFile" && req.method === "GET") {
      const date = url.searchParams.get("reportDate") ?? "";
      if (!SETTLEMENT_DATES.includes(date)) {
        return walmartError(
          res,
          404,
          "CONTENT_NOT_FOUND.GMP_GATEWAY_API",
          "No report for this date",
        );
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(zipOf(`${date}.csv`, settlementCsv(date)));
    }

    return walmartError(res, 404, "CONTENT_NOT_FOUND.GMP_GATEWAY_API", "Not found");
  });
}).listen(port);

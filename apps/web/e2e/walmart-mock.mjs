// A stand-in for Walmart's Marketplace API (token and token detail), for end-to-end tests only.
// Synthetic keys: nothing real is kept in the repo. Like Walmart, it wants WM_SVC.NAME, a
// correlation ID and the market on every call, Basic client ID and secret for the token, and the
// token in WM_SEC.ACCESS_TOKEN after that.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { crc32, deflateRawSync } from "node:zlib";

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

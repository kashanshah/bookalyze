// A stand-in for Login with Amazon and the Selling Partner API, for end-to-end tests only.
// Synthetic data.
import { createServer } from "node:http";

const port = Number(process.env.AMAZON_MOCK_PORT ?? 4011);
const CLIENT_ID = "amzn1.application-oa2-client.e2e0000000000000000000000000000";
const REFRESH_TOKEN = "Atzr|e2e-refresh-token-0000";
const ACCESS_TOKEN = "Atza|e2e-access-token-0000";

const participations = {
  payload: [
    {
      marketplace: {
        id: "A2EUQ1WTGCTBG2",
        countryCode: "CA",
        name: "Amazon.ca",
        defaultCurrencyCode: "CAD",
      },
      participation: { isParticipating: true, hasSuspendedListings: false },
      storeName: "Maple Goods Store",
    },
    {
      marketplace: {
        id: "ATVPDKIKX0DER",
        countryCode: "US",
        name: "Amazon.com",
        defaultCurrencyCode: "USD",
      },
      participation: { isParticipating: false, hasSuspendedListings: false },
      storeName: "Maple Goods Store",
    },
  ],
};

// Four synthetic orders on Amazon.ca, answered in two pages to exercise the page token.
const orders = [
  {
    AmazonOrderId: "702-1000001-0000001",
    MarketplaceId: "A2EUQ1WTGCTBG2",
    PurchaseDate: daysAgo(12),
    LastUpdateDate: daysAgo(2),
    OrderStatus: "Shipped",
    FulfillmentChannel: "AFN",
    OrderTotal: { CurrencyCode: "CAD", Amount: "45.19" },
    NumberOfItemsShipped: 2,
    NumberOfItemsUnshipped: 0,
    ShippingAddress: { StateOrRegion: "ON", CountryCode: "CA" },
    IsPrime: true,
    // Delivered a week ago, so Amazon takes a review request for it.
    EarliestDeliveryDate: daysAgo(9),
    LatestDeliveryDate: daysAgo(7),
  },
  {
    AmazonOrderId: "702-1000002-0000002",
    MarketplaceId: "A2EUQ1WTGCTBG2",
    PurchaseDate: daysAgo(2),
    LastUpdateDate: daysAgo(2),
    OrderStatus: "Unshipped",
    FulfillmentChannel: "MFN",
    OrderTotal: { CurrencyCode: "CAD", Amount: "18.50" },
    NumberOfItemsShipped: 0,
    NumberOfItemsUnshipped: 1,
    ShippingAddress: { StateOrRegion: "BC", CountryCode: "CA" },
  },
  {
    AmazonOrderId: "702-1000003-0000003",
    MarketplaceId: "A2EUQ1WTGCTBG2",
    PurchaseDate: daysAgo(1),
    LastUpdateDate: daysAgo(1),
    OrderStatus: "Canceled",
    FulfillmentChannel: "AFN",
    NumberOfItemsShipped: 0,
    NumberOfItemsUnshipped: 0,
  },
  // Shipped by Amazon (FBA): Amazon gives no delivery dates for these.
  {
    AmazonOrderId: "702-1000004-0000004",
    MarketplaceId: "A2EUQ1WTGCTBG2",
    PurchaseDate: daysAgo(10),
    LastUpdateDate: daysAgo(8),
    OrderStatus: "Shipped",
    FulfillmentChannel: "AFN",
    OrderTotal: { CurrencyCode: "CAD", Amount: "27.99" },
    NumberOfItemsShipped: 1,
    NumberOfItemsUnshipped: 0,
    ShippingAddress: { StateOrRegion: "QC", CountryCode: "CA" },
  },
];
const items = {
  "702-1000001-0000001": [
    {
      OrderItemId: "50001",
      ASIN: "B0E2E00001",
      SellerSKU: "MAPLE-MUG",
      Title: "Maple leaf ceramic mug",
      QuantityOrdered: 2,
      QuantityShipped: 2,
      ItemPrice: { CurrencyCode: "CAD", Amount: "39.98" },
      ItemTax: { CurrencyCode: "CAD", Amount: "5.21" },
    },
  ],
  "702-1000002-0000002": [
    {
      OrderItemId: "50002",
      ASIN: "B0E2E00002",
      SellerSKU: "PINE-CANDLE",
      Title: "Pine forest candle",
      QuantityOrdered: 1,
      QuantityShipped: 0,
      ItemPrice: { CurrencyCode: "CAD", Amount: "16.37" },
      ItemTax: { CurrencyCode: "CAD", Amount: "2.13" },
    },
  ],
  "702-1000003-0000003": [],
  "702-1000004-0000004": [
    {
      OrderItemId: "50004",
      ASIN: "B0E2E00004",
      SellerSKU: "BIRCH-COASTER",
      Title: "Birch bark coaster set",
      QuantityOrdered: 1,
      QuantityShipped: 1,
      ItemPrice: { CurrencyCode: "CAD", Amount: "24.77" },
      ItemTax: { CurrencyCode: "CAD", Amount: "3.22" },
    },
  ],
};

/** Orders asked for a review. */
const asked = new Set();

// One mug of the first order refunded (price and tax), less a promotion clawed back: partly.
const refundEvents = [
  {
    AmazonOrderId: "702-1000001-0000001",
    MarketplaceName: "Amazon.ca",
    PostedDate: daysAgo(1),
    ShipmentItemAdjustmentList: [
      {
        OrderAdjustmentItemId: "e2e-adjustment-1",
        SellerSKU: "MAPLE-MUG",
        QuantityShipped: 1,
        ItemChargeAdjustmentList: [
          {
            ChargeType: "Principal",
            ChargeAmount: { CurrencyCode: "CAD", CurrencyAmount: -19.99 },
          },
          { ChargeType: "Tax", ChargeAmount: { CurrencyCode: "CAD", CurrencyAmount: -2.6 } },
        ],
      },
    ],
  },
];

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "POST" && url.pathname === "/auth/o2/token") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const form = new URLSearchParams(body);
      if (form.get("client_id") !== CLIENT_ID) return json(res, 401, { error: "invalid_client" });
      if (form.get("refresh_token") !== REFRESH_TOKEN) {
        return json(res, 400, { error: "invalid_grant" });
      }
      json(res, 200, { access_token: ACCESS_TOKEN, token_type: "bearer", expires_in: 3600 });
    });
    return;
  }
  if (req.headers["x-amz-access-token"] !== ACCESS_TOKEN) {
    return json(res, 403, { errors: [{ code: "Unauthorized" }] });
  }
  if (url.pathname === "/sellers/v1/marketplaceParticipations") {
    return json(res, 200, participations);
  }
  if (url.pathname === "/orders/v0/orders") {
    if (!url.searchParams.get("MarketplaceIds")) return json(res, 400, { errors: [] });
    const after = url.searchParams.get("LastUpdatedAfter");
    const token = url.searchParams.get("NextToken");
    if (!token && !after) return json(res, 400, { errors: [] });
    const matching = token
      ? orders.slice(2)
      : orders.filter((o) => o.LastUpdateDate >= after).slice(0, 2);
    const more = !token && orders.filter((o) => o.LastUpdateDate >= after).length > 2;
    return json(res, 200, {
      payload: { Orders: matching, ...(more ? { NextToken: "e2e-page-2" } : {}) },
    });
  }
  if (url.pathname === "/finances/v0/financialEvents") {
    const after = url.searchParams.get("PostedAfter");
    const before = url.searchParams.get("PostedBefore");
    if (!url.searchParams.get("NextToken") && (!after || !before)) {
      return json(res, 400, { errors: [] });
    }
    const matching = refundEvents.filter(
      (e) => !after || (e.PostedDate >= after && e.PostedDate < before),
    );
    return json(res, 200, { payload: { FinancialEvents: { RefundEventList: matching } } });
  }
  const itemsPath = /^\/orders\/v0\/orders\/([^/]+)\/orderItems$/.exec(url.pathname);
  if (itemsPath) {
    const id = decodeURIComponent(itemsPath[1]);
    if (!(id in items)) return json(res, 404, { errors: [{ code: "NotFound" }] });
    return json(res, 200, { payload: { AmazonOrderId: id, OrderItems: items[id] } });
  }
  // Review requests: Amazon offers one per shipped order, then refuses (403) once asked.
  const solicitation =
    /^\/solicitations\/v1\/orders\/([^/]+)(\/solicitations\/productReviewAndSellerFeedback)?$/.exec(
      url.pathname,
    );
  if (solicitation) {
    const id = decodeURIComponent(solicitation[1]);
    const order = orders.find((o) => o.AmazonOrderId === id);
    if (!order || !url.searchParams.get("marketplaceIds")) {
      return json(res, 400, { errors: [{ code: "InvalidInput" }] });
    }
    const offered = order.OrderStatus === "Shipped" && !asked.has(id);
    if (solicitation[2] && req.method === "POST") {
      if (!offered) return json(res, 403, { errors: [{ code: "Unauthorized" }] });
      asked.add(id);
      return json(res, 201, {});
    }
    const self = { href: url.pathname, name: "productReviewAndSellerFeedback" };
    return json(res, 200, { _links: { actions: offered ? [self] : [] } });
  }
  const finances = /^\/finances\/v0\/orders\/([^/]+)\/financialEvents$/.exec(url.pathname);
  if (finances) {
    return json(res, 200, { payload: { FinancialEvents: { ShipmentEventList: [{}] } } });
  }
  json(res, 404, { errors: [{ code: "NotFound" }] });
}).listen(port);

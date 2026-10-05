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
  json(res, 404, { errors: [{ code: "NotFound" }] });
}).listen(port);

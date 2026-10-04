// A stand-in for the Wise API, for end-to-end tests only. Synthetic data; dates are "now" so
// they fall inside any company's current financial year.
import { createServer } from "node:http";

const port = Number(process.env.WISE_MOCK_PORT ?? 4010);
const TOKEN = "e2e-wise-token-0000-1111-2222";
const now = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const statements = {
  11: [
    {
      type: "DEBIT",
      date: now(),
      amount: { value: -7.76, currency: "CAD" },
      totalFees: { value: 0.04, currency: "CAD" },
      details: {
        type: "CARD",
        description: "Card transaction at Example Cafe",
        merchant: { name: "Example Cafe" },
      },
      referenceNumber: "CARD-E2E-1",
    },
    {
      type: "DEBIT",
      date: now(),
      amount: { value: -136.5, currency: "CAD" },
      totalFees: { value: 0, currency: "CAD" },
      details: {
        type: "CONVERSION",
        description: "Converted 136.50 CAD to 100.00 USD",
        sourceAmount: { value: 136.5, currency: "CAD" },
        targetAmount: { value: 100, currency: "USD" },
      },
      referenceNumber: "CONVERSION-E2E-1",
    },
  ],
  22: [
    {
      type: "CREDIT",
      date: now(),
      amount: { value: 100, currency: "USD" },
      totalFees: { value: 0, currency: "USD" },
      details: {
        type: "CONVERSION",
        description: "Converted 136.50 CAD to 100.00 USD",
        sourceAmount: { value: 136.5, currency: "CAD" },
        targetAmount: { value: 100, currency: "USD" },
      },
      referenceNumber: "CONVERSION-E2E-1",
    },
  ],
};

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.headers.authorization !== `Bearer ${TOKEN}`)
    return send(res, 401, { error: "invalid_token" });
  if (url.pathname === "/v2/profiles") {
    return send(res, 200, [{ id: 101, type: "BUSINESS", fullName: "Example Trading Inc." }]);
  }
  if (url.pathname === "/v4/profiles/101/balances") {
    return send(res, 200, [
      { id: 11, currency: "CAD", amount: { value: 355.74, currency: "CAD" }, name: null },
      { id: 22, currency: "USD", amount: { value: 100, currency: "USD" }, name: null },
    ]);
  }
  const match = url.pathname.match(
    /^\/v1\/profiles\/101\/balance-statements\/(\d+)\/statement\.json$/,
  );
  if (match) return send(res, 200, { transactions: statements[match[1]] ?? [] });
  return send(res, 404, { error: "not_found" });
}).listen(port);

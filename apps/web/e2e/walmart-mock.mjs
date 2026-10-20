// A stand-in for Walmart's Marketplace API (token and token detail), for end-to-end tests only.
// Synthetic keys: nothing real is kept in the repo. Like Walmart, it wants WM_SVC.NAME, a
// correlation ID and the market on every call, Basic client ID and secret for the token, and the
// token in WM_SEC.ACCESS_TOKEN after that.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

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

    return walmartError(res, 404, "CONTENT_NOT_FOUND.GMP_GATEWAY_API", "Not found");
  });
}).listen(port);

// A stand-in for Noon's partner API, for end-to-end tests only. Synthetic data.
// It makes its own key pair when it starts (nothing secret is kept in the repo) and hands out
// the key file the way Noon's portal does, so the test can upload it. Logins are checked the
// way Noon checks them: an RS256 JWT signed by the key, `iat` within five minutes, a User-Agent.
import { createVerify, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

const port = Number(process.env.NOON_MOCK_PORT ?? 4012);
const KEY_ID = "e2e-key-0001";
const PROJECT = "PRJ000001";
const SESSION = "e2e-session-0001";

const pem = () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey,
  };
};
const good = pem();
// A key Noon doesn't know: it signs fine, and the login is refused.
const unknown = pem();

const keyFile = (key) =>
  JSON.stringify({
    key_id: KEY_ID,
    private_key: key.privateKey,
    project_code: PROJECT,
    channel_identifier: "e2e-channel-0001",
  });

const categories = {
  export_categories: [
    {
      export_category_code: "noon_financeweb_transactionviewreportonitemlevel",
      params: { from_date: "string", to_date: "string" },
    },
    {
      export_category_code: "noon_orders_report",
      params: { from_date: "string", to_date: "string" },
    },
    // Like Noon's stock reports: it needs inputs its description leaves out.
    {
      export_category_code: "noon_fbn_stock_report",
      params: { from_date: "string", to_date: "string" },
    },
  ],
};

// Exports: made "in the background", then a link to a gzipped CSV of Noon's transaction view
// (its real header) for the days asked for. Synthetic rows: in each month, a sale on the 2nd, a
// late fee on it on the 3rd and a storage fee on the 20th.
const exports = new Map();
const HEADER =
  "Contract,Contract Title,Reference Nr,Order Nr,Item Nr,Order Date,Transaction Date,Title,SKUs,Partner SKUs,Transaction Type,Currency,Net Proceeds,Referral Fee including VAT,Fullfilment & Logistics Fees including VAT,Shipping Credits including VAT,Other Order Fees including VAT,Order Subsidies including VAT,Non-Order Fees including VAT,Non-Order Subsidies including VAT,Others including VAT,Total";

function transactionsCsv(from, to) {
  const rows = [HEADER];
  const start = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  for (let month = start; month.toISOString().slice(0, 10) <= to; ) {
    const ym = month.toISOString().slice(0, 7);
    const order = `NAE${ym.replace("-", "")}0001`;
    const lines = [
      [
        `${ym}-02`,
        `C1,Noon UAE,REF-${ym}-1,${order},ITEM-1,${ym}-01,${ym}-02,"Maple mug, large",Z1,NOON-MAPLE-MUG,Order,AED,100.00,-8.40,-6.30,0,0,2.00,0,0,0,87.30`,
      ],
      [
        `${ym}-03`,
        `C1,Noon UAE,REF-${ym}-1,${order},ITEM-1,${ym}-01,${ym}-03,,Z1,NOON-MAPLE-MUG,Order Update,AED,0,-0.50,0,0,0,0,0,0,0,-0.50`,
      ],
      [
        `${ym}-20`,
        `C1,Noon UAE,REF-${ym}-9,,,,20/${ym.slice(5, 7)}/${ym.slice(0, 4)},,,,Storage Fee,AED,0,0,0,0,0,0,-12.00,0,0,-12.00`,
      ],
    ];
    for (const [day, line] of lines) if (day >= from && day <= to) rows.push(line);
    month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  }
  return rows.join("\r\n");
}

const error = (code, message) => ({
  error: { status_id: 16, code, message, fields: [], doc_url: "https://example.com/errors" },
});

function verify(token) {
  const [header, payload, signature] = String(token).split(".");
  if (!header || !payload || !signature) return false;
  const head = JSON.parse(Buffer.from(header, "base64url").toString());
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (head.alg !== "RS256" || claims.sub !== KEY_ID || !claims.jti) return false;
  if (!Number.isInteger(claims.iat) || Math.abs(Date.now() / 1000 - claims.iat) > 300) return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  return verifier.verify(good.publicKey, signature, "base64url");
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    // For the test: the key files, as Noon's portal would download them.
    if (url.pathname === "/test/key-file") return send(res, 200, JSON.parse(keyFile(good)));
    if (url.pathname === "/test/unknown-key-file") {
      return send(res, 200, JSON.parse(keyFile(unknown)));
    }
    // The download link is signed, like Noon's: no session needed.
    if (url.pathname.startsWith("/download/")) {
      const found = exports.get(url.pathname.slice("/download/".length).replace(/\.csv\.gz$/, ""));
      if (!found) return send(res, 404, error("NOT_FOUND", "Export not found"));
      res.writeHead(200, { "Content-Type": "text/csv", "Content-Encoding": "identity" });
      return res.end(gzipSync(transactionsCsv(found.from, found.to)));
    }
    if (!req.headers["user-agent"])
      return send(res, 400, error("INVALID_ARGUMENT", "User-Agent required"));

    if (req.method === "POST" && url.pathname === "/identity/public/v1/api/login") {
      const body = raw ? JSON.parse(raw) : {};
      if (!verify(body.token) || body.default_project_code !== PROJECT) {
        return send(res, 401, error("UNAUTHENTICATED", "Invalid API token"));
      }
      return send(res, 200, {}, { "Set-Cookie": `_npsid=${SESSION}; Path=/; HttpOnly; Secure` });
    }
    if (!String(req.headers.cookie ?? "").includes(`_npsid=${SESSION}`)) {
      return send(res, 401, error("UNAUTHENTICATED", "Session expired"));
    }
    if (req.method === "GET" && url.pathname === "/impex/v1/export/category/list") {
      return send(res, 200, categories);
    }
    if (req.method === "POST" && url.pathname === "/impex/v1/export/create") {
      const body = raw ? JSON.parse(raw) : {};
      const known = categories.export_categories.find(
        (c) => c.export_category_code === body.export_category_code,
      );
      const params = body.params ?? {};
      if (!known || !/^\d{4}-\d{2}-\d{2}$/.test(String(params.from_date ?? ""))) {
        return send(res, 400, {
          error: {
            status_id: 3,
            code: "INVALID_ARGUMENT",
            message: "Invalid argument.",
            fields: [{ name: "params.from_date", descriptions: ["must be YYYY-MM-DD"] }],
          },
        });
      }
      if (
        body.export_category_code === "noon_fbn_stock_report" &&
        (!params.country ||
          !params.noon_status ||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(params.close_date ?? "")))
      ) {
        return send(
          res,
          400,
          error(
            "INVALID_ARGUMENT",
            "AssertionError('Missing required fields: country, noon_status, close_date')",
          ),
        );
      }
      const code = `EXP-${exports.size + 1}`;
      // The first export is still being made at the first status check (so the app's waiting
      // is exercised); later ones are ready at once, so a year comes in quickly.
      exports.set(code, {
        checks: exports.size ? 1 : 0,
        category: body.export_category_code,
        from: params.from_date,
        to: String(params.to_date ?? params.from_date),
      });
      return send(res, 200, { export_code: code });
    }
    if (req.method === "POST" && url.pathname === "/impex/v1/export/status") {
      const body = raw ? JSON.parse(raw) : {};
      const found = exports.get(body.export_code);
      if (!found) return send(res, 404, error("NOT_FOUND", "Export not found"));
      found.checks++;
      const done = found.checks > 1;
      return send(res, 200, {
        export_code: body.export_code,
        export_category_code: found.category,
        export_status: done ? "COMPLETED" : "PROCESSING",
        params: "{}",
        project_code: PROJECT,
        created_by: "e2e",
        download_url: done ? `http://localhost:${port}/download/${body.export_code}.csv.gz` : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    return send(res, 404, error("NOT_FOUND", "Not found"));
  });
}).listen(port);

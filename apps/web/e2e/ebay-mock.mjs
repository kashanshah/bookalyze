// A stand-in for eBay's consent page, OAuth token endpoint, Commerce Identity API and the
// Notification API's public keys, for end-to-end tests only. Synthetic data. It makes its own EC
// key pair when it starts (nothing secret is kept in the repo) and signs account-deletion notices
// with it the way eBay does (ECDSA over SHA-1, the key named in X-EBAY-SIGNATURE).
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.EBAY_MOCK_PORT ?? 4013);
const appUrl = process.env.EBAY_MOCK_APP_URL ?? "http://localhost:3000";
const CLIENT_ID = "Bookalyz-e2e-SBX-0000";
const CLIENT_SECRET = "SBX-e2e-client-secret-0000";
const RU_NAME = "Bookalyze-e2e-RuName";
const CODE = "e2e-consent-code";
const REFRESH = "v^1.1#e2e-refresh-token";
const ACCESS = "v^1.1#e2e-user-access-token";
const APP_ACCESS = "v^1.1#e2e-app-access-token";
const USER = {
  userId: "e2e-ebay-user-0001",
  username: "maple_goods_e2e",
  accountType: "BUSINESS",
  registrationMarketplaceId: "EBAY_CA",
};
const KID = "e2e-notification-key";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
// eBay hands its keys out on one line.
const oneLineKey = publicKey.export({ type: "spki", format: "pem" }).toString().replace(/\n/g, "");

let declineNext = false;

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

    // For the test: decline on the next consent page; a signed account-deletion notice.
    if (url.pathname === "/test/decline-next") {
      declineNext = true;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/test/deletion-notice") {
      const body = JSON.stringify({
        metadata: {
          topic: "MARKETPLACE_ACCOUNT_DELETION",
          schemaVersion: "1.0",
          deprecated: false,
        },
        notification: {
          notificationId: "e2e-notice-0001",
          eventDate: new Date().toISOString(),
          publishDate: new Date().toISOString(),
          publishAttemptCount: 1,
          data: { username: USER.username, userId: USER.userId, eiasToken: "e2e-eias" },
        },
      });
      const signature = createSign("sha1").update(body).sign(privateKey, "base64");
      const header = Buffer.from(
        JSON.stringify({ alg: "ECDSA", kid: KID, signature, digest: "SHA1" }),
      ).toString("base64");
      return send(res, 200, { body, header });
    }

    // eBay's consent page: agreeing sends the seller to the app's RuName URL with a code.
    if (req.method === "GET" && url.pathname === "/oauth2/authorize") {
      const ok =
        url.searchParams.get("client_id") === CLIENT_ID &&
        url.searchParams.get("redirect_uri") === RU_NAME &&
        url.searchParams.get("response_type") === "code" &&
        (url.searchParams.get("scope") ?? "").includes("sell.finances");
      if (!ok) return send(res, 400, { error: "invalid_request" });
      const back = new URL("/api/ebay/callback", appUrl);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (declineNext) {
        declineNext = false;
        back.searchParams.set("error", "access_denied");
      } else {
        back.searchParams.set("code", CODE);
        back.searchParams.set("expires_in", "299");
      }
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/identity/v1/oauth2/token") {
      const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
      if (req.headers.authorization !== `Basic ${basic}`) {
        return send(res, 401, {
          error: "invalid_client",
          error_description: "client authentication failed",
        });
      }
      const form = new URLSearchParams(raw);
      const grant = form.get("grant_type");
      if (grant === "authorization_code") {
        if (form.get("code") !== CODE || form.get("redirect_uri") !== RU_NAME) {
          return send(res, 400, {
            error: "invalid_grant",
            error_description:
              "the provided authorization grant code is invalid or was issued to another client",
          });
        }
        return send(res, 200, {
          access_token: ACCESS,
          expires_in: 7200,
          refresh_token: REFRESH,
          refresh_token_expires_in: 47304000,
          token_type: "User Access Token",
        });
      }
      if (grant === "refresh_token" && form.get("refresh_token") === REFRESH) {
        return send(res, 200, {
          access_token: ACCESS,
          expires_in: 7200,
          token_type: "User Access Token",
        });
      }
      if (grant === "client_credentials") {
        return send(res, 200, {
          access_token: APP_ACCESS,
          expires_in: 7200,
          token_type: "Application Access Token",
        });
      }
      return send(res, 400, {
        error: "invalid_grant",
        error_description: "the provided refresh token is invalid",
      });
    }

    if (req.method === "GET" && url.pathname === "/commerce/identity/v1/user/") {
      if (req.headers.authorization !== `Bearer ${ACCESS}`) {
        return send(res, 401, { errors: [{ errorId: 1001, message: "Invalid access token" }] });
      }
      return send(res, 200, USER);
    }

    if (req.method === "GET" && url.pathname === `/commerce/notification/v1/public_key/${KID}`) {
      if (req.headers.authorization !== `Bearer ${APP_ACCESS}`) {
        return send(res, 401, { errors: [{ errorId: 1001, message: "Invalid access token" }] });
      }
      return send(res, 200, { algorithm: "ECDSA", digest: "SHA1", key: oneLineKey });
    }

    return send(res, 404, { errors: [{ errorId: 404, message: "Not found" }] });
  });
}).listen(port);

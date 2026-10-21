// A stand-in for Stripe (prices, customers, Checkout, subscriptions, the customer portal,
// invoices), for end-to-end tests only. No real Stripe account or key is involved, and nobody is
// charged. Checkout and the portal are small pages with buttons; each sends the app the webhook
// Stripe would, signed with the test-only secret below, then goes back to the app.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.STRIPE_MOCK_PORT ?? 4015);
const KEY = "sk_test_e2e_0000000000000000";
const WEBHOOK_SECRET = "whsec_e2e_stripe_0000000000000000";
const WEBHOOK_URL =
  process.env.STRIPE_MOCK_WEBHOOK_URL ??
  `http://localhost:${process.env.PORT ?? 3000}/api/stripe/webhook`;

const PRICES = Object.entries({
  books: [900, 9000],
  seller: [1900, 19000],
  seller_plus: [2900, 29000],
  stock: [800, 8000],
  reviews: [500, 5000],
}).flatMap(([key, [month, year]]) => [
  { id: `price_${key}_month`, lookup_key: `${key}_month`, unit_amount: month, interval: "month" },
  { id: `price_${key}_year`, lookup_key: `${key}_year`, unit_amount: year, interval: "year" },
]);

let counter = 0;
const next = (prefix) => `${prefix}_e2e${++counter}`;
const customers = new Map();
const sessions = new Map();
const subscriptions = new Map();
let clock = Math.floor(Date.now() / 1000);
/** Event times only move forward, as Stripe's do. */
const tick = () => {
  clock = Math.max(clock + 1, Math.floor(Date.now() / 1000));
  return clock;
};

/** Stripe's form body: a[b][0]=c → nested objects (arrays as objects with number keys). */
function parseForm(text) {
  const out = {};
  for (const [rawKey, value] of new URLSearchParams(text)) {
    const keys = rawKey.replace(/\]/g, "").split("[");
    let node = out;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) node[k] = value;
      else node = node[k] ??= {};
    });
  }
  return out;
}

const list = (obj) =>
  obj
    ? Object.keys(obj)
        .sort((a, b) => a - b)
        .map((k) => obj[k])
    : [];

function subscriptionObject(sub) {
  const periodEnd = clock + 30 * 86_400;
  return {
    id: sub.id,
    object: "subscription",
    customer: sub.customer,
    status: sub.status,
    cancel_at_period_end: false,
    current_period_end: periodEnd,
    metadata: sub.metadata,
    items: {
      data: sub.items.map((item) => ({
        id: item.id,
        current_period_end: periodEnd,
        price: {
          id: item.price.id,
          lookup_key: item.price.lookup_key,
          recurring: { interval: item.price.interval },
        },
      })),
    },
  };
}

async function sendEvent(type, object) {
  const event = JSON.stringify({ id: next("evt"), type, created: tick(), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${event}`).digest("hex");
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${signature}` },
    body: event,
  });
  if (!response.ok) console.error(`[stripe-mock] webhook ${type} answered ${response.status}`);
}

function page(res, title, body) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><html><head><title>${title}</title></head><body style="font-family:sans-serif;padding:24px"><h1>${title}</h1>${body}</body></html>`,
  );
}

const json = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};
const redirect = (res, location) => {
  res.writeHead(303, { location });
  res.end();
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  const path = url.pathname;

  if (path === "/health") return json(res, 200, { ok: true });

  // The pages a person sees: Checkout and the customer portal.
  let match = /^\/checkout\/([\w]+)$/.exec(path);
  if (match && req.method === "GET") {
    const session = sessions.get(match[1]);
    if (!session) return json(res, 404, {});
    const lines = session.prices.map((p) => `<li>${p.lookup_key}</li>`).join("");
    return page(
      res,
      "Stripe test checkout",
      `<ul>${lines}</ul><form method="post" action="/checkout/${session.id}/pay"><button>Pay</button></form>`,
    );
  }
  match = /^\/checkout\/([\w]+)\/pay$/.exec(path);
  if (match && req.method === "POST") {
    const session = sessions.get(match[1]);
    if (!session) return json(res, 404, {});
    const sub = {
      id: next("sub"),
      customer: session.customer,
      status: session.trialEnd ? "trialing" : "active",
      metadata: session.metadata,
      items: session.prices.map((price) => ({ id: next("si"), price })),
    };
    subscriptions.set(sub.id, sub);
    await sendEvent("checkout.session.completed", {
      id: session.id,
      object: "checkout.session",
      customer: session.customer,
      subscription: sub.id,
      metadata: session.metadata,
    });
    return redirect(res, session.successUrl);
  }
  match = /^\/portal\/([\w]+)$/.exec(path);
  if (match && req.method === "GET") {
    const sub = [...subscriptions.values()].find(
      (s) => s.customer === match[1] && s.status !== "canceled",
    );
    const back = encodeURIComponent(url.searchParams.get("return") ?? "/");
    if (!sub) return page(res, "Stripe test portal", "<p>No subscription.</p>");
    const removes = sub.items
      .map(
        (item) =>
          `<form method="post" action="/portal/${match[1]}/remove?item=${item.id}&return=${back}"><button>Remove ${item.price.lookup_key}</button></form>`,
      )
      .join("");
    return page(
      res,
      "Stripe test portal",
      `${removes}<form method="post" action="/portal/${match[1]}/cancel?return=${back}"><button>Cancel subscription</button></form>`,
    );
  }
  match = /^\/portal\/([\w]+)\/(remove|cancel)$/.exec(path);
  if (match && req.method === "POST") {
    const sub = [...subscriptions.values()].find(
      (s) => s.customer === match[1] && s.status !== "canceled",
    );
    const back = url.searchParams.get("return") ?? "/";
    if (!sub) return redirect(res, back);
    if (match[2] === "remove") {
      sub.items = sub.items.filter((item) => item.id !== url.searchParams.get("item"));
      await sendEvent("customer.subscription.updated", subscriptionObject(sub));
    } else {
      sub.status = "canceled";
      await sendEvent("customer.subscription.deleted", subscriptionObject(sub));
    }
    return redirect(res, back);
  }

  // The API.
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    return json(res, 401, { error: { type: "invalid_request_error", message: "Invalid API key" } });
  }
  const form = parseForm(req.method === "GET" ? url.search.slice(1) : body);

  if (path === "/v1/prices" && req.method === "GET") {
    const keys = list(form.lookup_keys);
    return json(res, 200, {
      data: PRICES.filter((p) => keys.includes(p.lookup_key)).map((p) => ({
        id: p.id,
        lookup_key: p.lookup_key,
        unit_amount: p.unit_amount,
        recurring: { interval: p.interval },
      })),
    });
  }
  if (path === "/v1/customers" && req.method === "POST") {
    const customer = {
      id: next("cus"),
      name: form.name,
      email: form.email,
      metadata: form.metadata,
    };
    customers.set(customer.id, customer);
    return json(res, 200, customer);
  }
  if (path === "/v1/checkout/sessions" && req.method === "POST") {
    if (!customers.has(form.customer))
      return json(res, 400, { error: { message: "No such customer" } });
    const prices = list(form.line_items).map((line) => PRICES.find((p) => p.id === line.price));
    if (prices.some((p) => !p)) return json(res, 400, { error: { message: "No such price" } });
    const session = {
      id: next("cs"),
      customer: form.customer,
      prices,
      metadata: form.subscription_data?.metadata ?? form.metadata ?? {},
      trialEnd: form.subscription_data?.trial_end ?? null,
      successUrl: form.success_url,
    };
    sessions.set(session.id, session);
    return json(res, 200, {
      id: session.id,
      url: `http://localhost:${port}/checkout/${session.id}`,
    });
  }
  match = /^\/v1\/subscriptions\/([\w]+)$/.exec(path);
  if (match && req.method === "GET") {
    const sub = subscriptions.get(match[1]);
    return sub
      ? json(res, 200, subscriptionObject(sub))
      : json(res, 404, { error: { message: "No such subscription" } });
  }
  if (path === "/v1/billing_portal/sessions" && req.method === "POST") {
    return json(res, 200, {
      url: `http://localhost:${port}/portal/${form.customer}?return=${encodeURIComponent(form.return_url ?? "/")}`,
    });
  }
  if (path === "/v1/invoices" && req.method === "GET") {
    const subs = [...subscriptions.values()].filter((s) => s.customer === form.customer);
    return json(res, 200, {
      data: subs.map((s, i) => ({
        id: `in_e2e${i + 1}`,
        number: `E2E-000${i + 1}`,
        status: "paid",
        total: s.items.reduce((n, item) => n + item.price.unit_amount, 0),
        currency: "usd",
        created: clock,
        hosted_invoice_url: null,
      })),
    });
  }
  return json(res, 404, { error: { message: `No stand-in for ${req.method} ${path}` } });
}).listen(port, () => console.log(`[stripe-mock] listening on ${port}`));

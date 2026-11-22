// A stand-in for the Bank of Canada's Valet API, for end-to-end tests only. It publishes no
// rates, as the real one before about 4:30 p.m. Toronto time, so tests use only the rates they
// store themselves. With the real API, its rate for today replaced a stored one each evening and
// tests that relied on it failed until midnight.
import { createServer } from "node:http";

const port = Number(process.env.BANK_OF_CANADA_MOCK_PORT ?? 4017);

createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.url === "/health") return send(200, { ok: true });
  if (req.url?.startsWith("/valet/observations/")) return send(200, { observations: [] });
  send(404, { message: "Not found" });
}).listen(port, () => console.info(`Bank of Canada stand-in on :${port}`));

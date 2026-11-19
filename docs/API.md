# Bookalyze API and MCP server

Bookalyze has a public REST API at `/api/v1` and an MCP server at `/api/mcp`. Both run the same
operations from one registry (`apps/web/src/server/api/ops/`), so a script and an AI agent always
see and change the same things. Public overview for users: bookalyze.com/developers.

## Connect ChatGPT, Claude or Gemini

**Settings → AI assistants** (`/o/<slug>/settings/ai-assistants`, also `/account/ai-assistants` from
the account menu) is the place for people. It has one card each for ChatGPT, Claude and Gemini:
**Connect** copies the MCP link and opens the assistant's connector page in one click, with the
assistant's own steps. Developer tools are also there: Add to Cursor and Add to VS Code are real
one-click install links, and Claude Code and Gemini CLI get a command. The page shows which
assistants are connected, with **Disconnect**. Home shows a nudge until the person connects one.

The list lives in `packages/core/src/site/assistants.ts` (steps, links, install links, and how to
recognise an assistant from the name it registered with). The app and the marketing guides both
read it, so check it against each assistant's help page when their menus change.

| Assistant | Where it's added | Notes |
|---|---|---|
| ChatGPT | chatgpt.com/plugins → + → Add custom MCP server | Registers by DCR. Redirect `https://chatgpt.com/connector_platform_oauth_redirect` (we meet its RFC 9207 issuer rules) or `…/connector/oauth/{id}` |
| Claude | claude.ai/customize/connectors → Add custom connector | Callback `https://claude.ai/api/mcp/auth_callback`; needs port 443 |
| Gemini | gemini.google.com → Settings → Connected apps → Add a custom app | DCR; US, 18+, personal accounts, English |

## Connect Claude Code

Sign in with Bookalyze (OAuth). No key to copy:

```bash
claude mcp add --transport http bookalyze https://app.bookalyze.com/api/mcp
```

Then type `/mcp` in Claude Code, choose **bookalyze** and sign in. The browser opens Bookalyze's
consent screen, where the person chooses read-only or read and write, all companies or some, and
how long. Claude Code keeps the tokens and refreshes them itself. The connection shows in
**Account → API keys** as a connected app, and **Disconnect** stops it at once.

Then ask Claude, for example "List my Bookalyze companies" or "Reconcile Wise CAD to today's
balance". Any MCP client that supports MCP authorization (2025-06-18) works the same way.

**With a key instead** (scripts, CI, clients without OAuth): make one at **Account → API keys** →
**New key**, then

```bash
claude mcp add --transport http bookalyze https://app.bookalyze.com/api/mcp --header "Authorization: Bearer bka_…"
```

or in a project's `.mcp.json`, keeping the key out of the file:

```json
{ "mcpServers": { "bookalyze": { "type": "http", "url": "https://app.bookalyze.com/api/mcp",
  "headers": { "Authorization": "Bearer ${BOOKALYZE_API_KEY}" } } } }
```

## Sign in with Bookalyze (OAuth 2.1)

Bookalyze is its own authorization server, following the MCP authorization spec (2025-06-18).

| Endpoint | What |
|---|---|
| `GET /.well-known/oauth-protected-resource/api/mcp` (and `/api/v1`) | RFC 9728 resource metadata. A 401 from `/api/mcp` or `/api/v1` points here in `WWW-Authenticate: Bearer … resource_metadata="…"` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 server metadata |
| `POST /oauth/register` | RFC 7591 dynamic registration, 20 an hour per IP. `token_endpoint_auth_method` `none` (public, PKCE only) or `client_secret_post`/`client_secret_basic` (also gets a `bks_` secret, stored hashed) |
| `GET /oauth/authorize` | The consent screen (signs the person in first) |
| `POST /oauth/token` | `authorization_code` (with PKCE) and `refresh_token` grants, 120 a minute per IP. Client credentials by HTTP Basic or in the body; a confidential client without its secret gets 401 `invalid_client` |
| `POST /oauth/revoke` | RFC 7009; always 200 |

- **A grant is an API key.** Approving makes an `api_keys` row with `client_id` set, named after the
  app, with the access, companies and lifetime the person chose. Everything under **Keys** below
  applies: per person, scope, companies, audit, the 25 cap, RLS.
- **Tokens.** The access token is a `bka_…` key secret that works for 1 hour (`token_expires_at`).
  The refresh token (`bkr_…`) lasts as long as the grant (30/90/365 days or until disconnected).
  Only SHA-256 hashes are stored. Each refresh replaces both tokens (rotation, in the SECURITY
  DEFINER `oauth_refresh`), so the old pair stops working.
- **Codes** are single use (deleted as they're read, even on failure), live 5 minutes, are stored
  hashed, and need the PKCE S256 verifier, the same client and the same redirect URI.
- **One connection per app and person.** Approving the same app again revokes its earlier tokens.
- **Redirect URIs** must be registered. `https` anywhere, `http` only for loopback (`localhost`,
  `127.0.0.1`, `[::1]`, any port per RFC 8252), or an app's own scheme (`cursor://…`). No
  fragments, credentials or `javascript:`/`data:`/`file:`. Until the client and redirect are known
  good the authorize page shows the problem itself and never redirects (no open redirects).
- **The consent screen** says where the person goes back to and that the app named itself. It
  can't be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) and sends no referrer.
  Approving runs only in the browser session, never under an API key or token.
- **`resource`** (RFC 8707) must be this site's `/api/mcp` or `/api/v1` when sent. Scopes are
  `read` and `write`; others (`openid`, `profile`…) are ignored rather than refused, and the person
  can always pick less than the app asked for. The token response's `scope` says what was granted.
- **Registration is lenient where it's safe** (RFC 7591 §3.2.1): unknown fields are dropped, and so
  are extra grant and response types, as long as `authorization_code`/`code` are there. PKCE is
  required for every client, confidential ones too.
- The issuer is the request's origin, so preview deployments work. Responses carry `iss` (RFC 9207)
  and `Cache-Control: no-store`. Unused registrations are deleted after a day, on the next
  registration. Nothing polls.

## Keys

- Format: `bka_` followed by 43 base64url characters (32 random bytes). Only the SHA-256 hash is
  stored (`api_keys.key_hash`). The first 12 characters are kept as `prefix` so people can recognise
  the key.
- **Per person.** A key acts as the person who made it, with their role in each company, and never
  more. Every existing check still applies: membership, role, closed periods, reconciled lines,
  billing read-only modules.
- **Access** is `read` or `write`.
  - A read-only key gets 403 `insufficient_scope` on any write.
  - MCP doesn't list write tools to a read-only key.
- **Companies** is either all of them (`organization_ids` null, including companies joined later)
  or a list. Other companies return 404, as if they didn't exist.
- **Expiry** is 30 days, 90 days, 1 year or never. Revoking takes effect on the next request.
- Each person can have at most 25 active keys (`MAX_API_KEYS`).
- **Keys are managed only in the browser.** The key actions refuse to run under an API key, so a key
  can't make or revoke keys.
- `last_used_at` is updated at most once a minute per key. Nothing polls.
- Row-level security: `api_keys` rows are visible only to their owner (`withUser`). Lookups by hash
  go through the SECURITY DEFINER function `api_key_lookup`, and `api_key_touch` updates the
  last-used time.
- Every write an API key makes is audited as the person, with `audit_logs.api_key_id` set to the key.

## REST

- Base: `https://app.bookalyze.com/api/v1`. Send the header `Authorization: Bearer bka_…`.
- **Requests.** GET and DELETE take their input from the query string. POST, PATCH and PUT take a
  JSON body (`Content-Type: application/json`, at most 4.5 MB). Path parameters override the body.
- **Responses** are `{ "data": … }` or
  `{ "error": { "code", "message", "details?" } }`. They are sent with `Cache-Control: no-store`.
- **Money and dates.** Amounts are decimal strings (`"1250.00"`), never numbers. Dates are
  `YYYY-MM-DD`.
- **OpenAPI 3.1** is at `GET /api/v1/openapi.json`, with no key needed. It lists every route and
  its input schema.
- **Rate limit:** 300 requests a minute per key, per server instance (429 `rate_limited`).
- `maxDuration` is 60 s.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | Input failed validation; `details.fields` maps each field to its message |
| 400 | `invalid_json` | The body isn't a JSON object |
| 415 | `unsupported_media_type` | A body sent without `Content-Type: application/json` |
| 401 | `missing_api_key` / `unauthorized` | No key / malformed, unknown, revoked or expired key |
| 403 | `insufficient_scope` | Read-only key on a write |
| 403 | `module_read_only` | The company's plan makes that part of the app read-only |
| 403 | `forbidden` | The person's role can't do it |
| 404 | `not_found` / `route_not_found` | No such item, a company the key can't reach, or no such route |
| 403 | `forbidden_origin` | MCP only: a browser request from another website |
| 405 | `method_not_allowed` | Wrong HTTP method for the route |
| 409 | `needs_browser` | The step only works in the app (it redirects to another page) |
| 413 | `too_large` | Body over 4.5 MB |
| 422 | `invalid_request` | The app's own rules refused it (unbalanced entry, closed period…), with field details when there are any |
| 429 | `rate_limited` | Too many requests |
| 500 | `internal_error` | Logged with a reference. Check what was saved before retrying |

### Routes

Every route below starts with `/companies/{company}` (the company's slug from `GET /companies`),
except `/me`, `/companies` and `/actions`.

| Area | Routes |
|---|---|
| Who and where | `GET /me`, `GET /companies`, `GET /companies/{company}` |
| Chart of accounts | `GET/POST accounts`, `PATCH accounts/{accountId}` (rename, recode, archive) |
| Transactions | `GET/POST transactions`, `GET/PATCH/DELETE transactions/{id}`, `POST transactions/{id}/reviewed`, `POST transfers/match`, `POST transactions/{id}/unmatch-transfer`, `GET transactions/{id}/files` |
| Journal | `GET/POST journal-entries`, `GET journal-entries/{id}`, `POST journal-entries/{id}/reverse`, `GET exchange-rates` |
| Contacts | `GET/POST contacts` (customers and vendors) |
| Bank accounts | `GET bank-accounts` (balance, bank's balance, last reconciled), `POST bank-accounts/{id}/statements` (CSV upload, `dryRun` to preview) |
| Bank feeds | `GET bank-connections`, `POST bank-connections/{id}/sync` |
| Receipts | `POST receipts` (base64 file, optionally attached to a transaction) |
| Reconciliation | `GET bank-accounts/{id}/reconciliation`, `POST bank-accounts/{id}/reconciliations` (start), `PATCH reconciliations/{id}` (statement), `POST reconciliations/{id}/cleared`, `…/finish`, `…/cancel`, `…/undo` |
| Reports | `GET reports/profit-and-loss`, `balance-sheet`, `trial-balance`, `general-ledger`, `sales-tax`, `your-stake`, `transactions` |
| Purchasing | `GET purchase-orders`, `GET purchase-orders/{id}`, `POST purchase-orders/{id}/payments` |
| Everything else | `GET /actions`, `POST /companies/{company}/actions/{action}` (see below) |

**Owner money.** A contribution is a deposit categorised to 3000 Owner contributions. A drawing is a
withdrawal to 3100 Owner drawings and dividends. A loan from the owner goes to the
`due_to_owners` liability. A transfer between money accounts in different currencies takes
`receivedAmount`. `fxRate` is main-currency units per unit of the account's currency
(`suggest_exchange_rate` suggests one).

### App actions (everything the browser does)

- `GET /actions` lists the app's server actions that take the company as their first argument
  (about 200). Each entry shows its area, module and whether it only reads.
- `POST /companies/{company}/actions/{action}` with `{ "args": [...] }` calls one. The company slug
  is passed for you; `args` are the rest of the action's arguments.
- Each call passes the key's access check and the module's billing check. The action then runs its
  own validation, role checks and audit, exactly as in the browser.
- The catalog is generated by `apps/web/scripts/gen-action-catalog.mjs` into
  `src/server/api/action-catalog.generated.ts`.
  - `dev` and `build` regenerate it.
  - `typecheck` fails if it's stale.
  - Run `pnpm -C apps/web gen:actions` after adding or renaming an action.
  - Settings and help actions, and actions that take `FormData`, are left out.
  - To mark a new action as read-only, add it to `READ_ONLY` in `ops/app-actions.ts`.

## MCP

- Streamable HTTP, stateless, with JSON responses (`POST /api/mcp`). GET and DELETE return 405.
- Authentication is the same Bearer key as REST, or an OAuth access token. A 401 carries
  `resource_metadata` so MCP clients find the sign-in on their own.
- Requests with an `Origin` header other than the app's own get 403, which guards against DNS
  rebinding.
- Each operation is a tool with the same name as its `operationId`.
  - Annotations: `readOnlyHint`, `destructiveHint` (deletes, reversals, undo, cancel) and
    `openWorldHint: false`.
  - Errors come back as `isError` results with the same plain-language messages as REST.
  - Results over 400k characters are cut short. Use paging (`limit`/`offset`) or narrower dates.
- The server's `instructions` tell the agent to start with `list_companies`, keep money as strings
  and preview statement uploads with `dryRun`.

## Code map

| Path | What |
|---|---|
| `packages/db/src/schema/api-keys.ts`, `drizzle/0099_api_keys.sql` | Tables (`api_keys`, `oauth_clients`, `oauth_codes`), RLS policy, lookup, touch, refresh and revoke functions, `audit_logs.api_key_id` |
| `packages/db/src/api-keys.ts` | Generate, hash, resolve, list, create, revoke |
| `packages/db/src/oauth.ts` | Clients (public or with a secret), client authentication, codes, PKCE, token exchange, refresh rotation, revoke |
| `packages/core/src/site/assistants.ts` | ChatGPT, Claude, Gemini and developer tools: steps, links, install links, name matching |
| `apps/web/src/components/ai/connect-assistants.tsx`, `server/ai-assistants.ts` | Settings → AI assistants (both pages) and the person's connections |
| `apps/web/src/server/oauth.ts`, `oauth-request.ts` | Metadata, redirect URI rules, authorize request checks |
| `apps/web/src/app/.well-known/*`, `app/oauth/*` | Discovery, register, token, revoke routes and the consent screen |
| `apps/web/src/server/api/principal.ts` | AsyncLocalStorage principal; `getSession()` returns the key's person inside it |
| `apps/web/src/server/api/core.ts`, `execute.ts` | Auth, rate limit, scope, company and module checks, error mapping |
| `apps/web/src/server/api/ops/*` | The operations (one list for REST and MCP) |
| `apps/web/src/server/api/http.ts`, `mcp.ts` | REST router plus OpenAPI, and the MCP server |
| `apps/web/src/app/api/v1/[[...path]]/route.ts`, `app/api/mcp/route.ts` | Route handlers |
| `apps/web/src/app/account/api-keys/` | Keys screen |
| `apps/marketing/src/app/developers/page.tsx` | Public page |

**Adding an operation.** Add a `defineOperation` to an `ops/*.ts` file.
- Give it a name, description, access, module (for writes), an `http` route and a zod input.
- Make its `run` call the existing loader or server action. Wrap actions in `unwrap()`.
- It then appears in REST, OpenAPI and MCP. No polling, crons or background work is involved:
  everything runs on request.

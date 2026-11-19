# Bookalyze API and MCP server

Bookalyze has a public REST API at `/api/v1` and an MCP server at `/api/mcp`. Both run the same
operations from one registry (`apps/web/src/server/api/ops/`), so a script and an AI agent always
see and change the same things. Public overview for users: bookalyze.com/developers.

## Connect Claude Code

1. In Bookalyze, open the account menu → **API keys for AI agents** (`/account/api-keys`) → **New key**.
2. Choose read-only or read and write, all companies or some, and an expiry. Copy the key. It's
   shown once.
3. Run the command the page shows:

```bash
claude mcp add --transport http bookalyze https://app.bookalyze.com/api/mcp --header "Authorization: Bearer bka_…"
```

Then ask Claude, for example "List my Bookalyze companies" or "Reconcile Wise CAD to today's
balance". Any other MCP client works the same way: Streamable HTTP at `/api/mcp`, with the key as a
Bearer token.

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
- Authentication is the same Bearer key as REST.
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
| `packages/db/src/schema/api-keys.ts`, `drizzle/0099_api_keys.sql` | Table, RLS policy, lookup and touch functions, `audit_logs.api_key_id` |
| `packages/db/src/api-keys.ts` | Generate, hash, resolve, list, create, revoke |
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

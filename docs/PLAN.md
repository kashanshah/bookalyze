# Backoffice: Product & Development Plan

> Status: **Draft v0.1, for review.** Nothing here is built yet. Open decisions are listed at the end.

## 0. Key decisions (TL;DR)

| Topic | Decision |
|---|---|
| Product shape | **One multi-tenant product.** Each company is an **Organization** with strictly isolated data. One login can belong to many organizations and switch between them (like Wave's business switcher). A separate login for one company (e.g. an accountant who only sees Teknoffice) is just an invite. |
| Tenancy model | Shared Postgres database, `organization_id` on every tenant table, enforced by **Postgres Row-Level Security** and by app-level scoping. No database per tenant. |
| Accounting core | A real **double-entry ledger** (journal entries + lines). Wave-style "Transactions" are a friendly UI over journal entries. Money is stored as `NUMERIC`, never floats. Multi-currency from day one. |
| Commerce accounting | **Settlement-based posting** (the way A2X / Link My Books work): one summarized journal entry per marketplace settlement into a clearing account, which is then matched to the bank deposit. |
| Inventory costing | **FIFO lots** with landed cost (product + freight + duty + brokerage + prep), kept behind a costing interface so weighted average can be added later. Confirm with your accountant. |
| Stack | TypeScript monorepo · Next.js (App Router) · **Tailwind CSS + shadcn/ui** · PostgreSQL + Drizzle ORM · Better Auth (organizations plugin) · Trigger.dev for background jobs · Resend + React Email · S3-compatible storage (Cloudflare R2). |
| Hosting (v1) | Vercel (web, preview deploy per branch) + Neon (Postgres with point-in-time restore and per-branch databases) + Trigger.dev (sync jobs). All code stays Docker-able so it can move to Railway, Fly or a VPS later. |
| Secrets | System secrets in env vars. Per-organization credentials (SP-API, Wise, eBay…) stored **encrypted in the DB** (envelope encryption, AES-256-GCM), managed from Settings, never sent back to the browser after saving. |
| Modularity | Every feature belongs to a **module** with a manifest (feature keys, nav, permissions). An **entitlements** layer decides what an org can use. Today every org is on an internal "Unlimited" plan; Stripe plans can be wired in later without touching module code. |
| Cutover | Run in **parallel with Wave** until the new P&L and Balance Sheet match Wave to the cent for at least one closed period. |

---

## 1. Tenants and users

```
User ──< Membership (role) >── Organization
                                  ├─ base currency, country, fiscal year end, tax settings
                                  ├─ ledger, bank accounts, channels, inventory…
                                  └─ connections (encrypted credentials)
```

Initial organizations:

| Org | Country | Base currency | Banks | Channels |
|---|---|---|---|---|
| Kazomo Inc. | CA | CAD | RBC (CSV), Wise (API, multi-currency) | Amazon (via the "Kazomo – Momal Fatima" SP-API app) |
| Teknoffice Technologies Inc. | CA | CAD | RBC (CSV), Wise (API, multi-currency) | Amazon.ca, eBay US, later Amazon.com |
| Kazomo For Online Selling | AE | AED | Wio (CSV/statement import) | Amazon.ae, Noon UAE |

- **Roles:** Owner, Admin, Accountant (full accounting, read-only connections), Bookkeeper, Viewer. Permissions are checked on the server; the UI only hides what you can't do.
- **Isolation:** there are no cross-org queries in product code. A read-only "portfolio" dashboard across your own orgs could be an opt-in feature later, but it is not in scope.
- **Security baseline:** 2FA required for Owners/Admins, an audit log of every write (who, when, before/after), and session management.

---

## 2. Architecture

```
┌──────────────────────────── apps/web (Next.js on Vercel) ───────────────────────────┐
│  App shell · org switcher · ⌘K palette · module routes · server actions / route     │
│  handlers · webhooks (Wise, eBay, Stripe later)                                     │
└───────────────┬──────────────────────────────────────────────────┬──────────────────┘
                │                                                  │ enqueue
        ┌───────▼────────┐                                ┌────────▼─────────┐
        │ Postgres (Neon)│◄───────────────────────────────┤ Jobs (Trigger.dev)│
        │ RLS per org    │   sync, import, post, forecast │ queues w/ limits  │
        └───────▲────────┘                                └────────┬─────────┘
                │                                                  │
        ┌───────┴────────┐                      ┌──────────────────▼───────────────────┐
        │ R2 (files:     │                      │ Integrations: Amazon SP-API, Amazon   │
        │ CSVs, receipts)│                      │ Ads API, Wise, eBay, Noon, Bank of    │
        └────────────────┘                      │ Canada FX, Resend                     │
                                                └──────────────────────────────────────┘
```

### Repository layout (proposed)

```
apps/
  web/                 Next.js app (UI + server actions + webhooks)
  jobs/                Trigger.dev task definitions (thin wrappers around packages/*)
packages/
  db/                  Drizzle schema, migrations, RLS policies, seed data
  core/                tenancy, auth helpers, RBAC, entitlements, secrets vault, audit log
  ledger/              pure-TS double-entry engine (posting, FX, period locks), heavily tested
  modules/
    accounting/        chart of accounts, transactions, journals, contacts, taxes, reports
    banking/           bank accounts, imports, rules, matching, reconciliation
    commerce/          channels, orders, settlements, payouts
    inventory/         products, listings, suppliers, POs, lots, movements, COGS
    analytics/         SKU profitability, reorder planning, alerts
    reviews/           Amazon review request engine
  integrations/
    amazon-sp/  amazon-ads/  wise/  ebay/  noon/  fx-rates/  importers/ (CSV, OFX)
  ui/                  shadcn/ui-based design system, tokens, data-table, charts
```

Each module exports a **manifest**:

```ts
export const reviewsModule = defineModule({
  key: "reviews",
  features: ["reviews.manual", "reviews.bulk", "reviews.auto_rules"],
  nav: [{ label: "Review requests", href: "/commerce/reviews", feature: "reviews.manual" }],
  permissions: ["reviews:read", "reviews:send"],
});
```

### Why these choices

- **Next.js + Tailwind + shadcn/ui:** shadcn components are copied into the repo as plain Tailwind code, so you can edit any of them yourself. Lovable also generates React + Tailwind + shadcn, so its prototypes port over with little friction.
- **Drizzle:** accounting reports are SQL aggregations. Drizzle stays close to SQL, handles `NUMERIC` and RLS-friendly raw SQL well, and gives end-to-end types.
- **Better Auth:** open source and self-hosted. Its organization plugin covers members, roles and invitations, and it supports 2FA and passkeys, so there is no per-seat auth bill when this goes public.
- **Trigger.dev:** SP-API syncs are long-running and rate-limited (Solicitations is about 1 req/s). Durable queues with concurrency limits, retries and cron schedules come built in. Job logic lives in `packages/*` as plain functions, so switching to pg-boss on a self-hosted worker later is a small change.
- **Neon:** point-in-time restore is non-negotiable for financial data, and a database branch per preview deployment lets you test migrations safely.

---

## 3. Modules

### 3.1 Accounting (Wave replacement)

**Chart of Accounts:** five types with Wave-compatible subtypes, so a Wave import maps 1:1.

| Type | Subtypes (Wave-compatible) |
|---|---|
| Assets | Cash & Bank · Money in Transit · Expected Payments from Customers (AR) · Inventory · Property, Plant, Equipment · Depreciation & Amortization · Vendor Prepayments & Credits · Other Short-Term Asset · Other Long-Term Asset |
| Liabilities | Credit Card · Loan & Line of Credit · Expected Payments to Vendors (AP) · Sales Taxes · Due for Payroll · Due to You & Other Business Owners · Customer Prepayments & Credits · Other Short/Long-Term Liability |
| Income | Income · Discount · Other Income · Uncategorized Income · Gain on Foreign Exchange |
| Expenses | Operating Expense · Cost of Goods Sold · Payment Processing Fee · Payroll Expense · Uncategorized Expense · Loss on Foreign Exchange |
| Equity | Owner Contribution & Drawing · Retained Earnings |

Country templates seed sensible defaults (CA: GST/HST accounts; AE: VAT 5% accounts). Each account has an optional currency, which is required for bank accounts.

**Transactions (Wave-style UX):**
- One list of every money movement with date, description, account, category, amount, a "reviewed" tick, and filters.
- Add income or expense, transfer between own accounts, split across categories, attach receipts, bulk categorize.
- Imported bank lines post immediately to **Uncategorized Income/Expense** (as Wave does), so ledger balances always match the bank. Reviewing a line re-categorizes it.
- A **journal entry** screen for accountants (manual multi-line entries).

**Ledger engine (`packages/ledger`):**
- `journal_entries` hold the date, memo, source (`manual`, `bank_import`, `settlement`, `cogs`, `fx_reval`…), source id and status.
- `journal_lines` hold the account, a signed amount in the transaction currency, the FX rate, the amount in base currency, plus optional tax rate, contact, and product/channel tags for analytics.
- Invariants enforced in code and by DB constraints: every entry balances in base currency, posted entries are immutable (corrections are reversing entries), and nothing can post into a locked period.
- **Multi-currency:** daily FX rates come from the **Bank of Canada Valet API** for CAD orgs (free and official). The AED org uses the USD peg (3.6725) and cross rates. Realized FX gain/loss is posted on settlement or transfer; unrealized revaluation runs at period end (phase 2+).
- **Period close:** "lock books through date" plus a year-end retained earnings roll-forward.

**Reports v1:** Profit & Loss (with comparisons and by-channel/by-month columns), Balance Sheet, Trial Balance, General Ledger, Account Transactions, Sales Tax report, Cash Flow (phase 2). Export to CSV/PDF.

**Later:** Customers/Vendors with invoices, bills, AR/AP aging, recurring transactions, receipt OCR.

**Wave migration:** import the Chart of Accounts and the full transaction history from Wave's data export (CSV/Excel). The minimum fallback is opening balances at a cutover date. Verify by matching Wave's P&L and Balance Sheet for the same periods.

### 3.2 Banking

| Bank | Method | Notes |
|---|---|---|
| **Wise Business** | API: personal API token (use **read-only**) stored per org | Pull balances and statements per currency, plus `balances#credit` / `balances#update` webhooks for near-real-time updates. A daily statement pull serves as backstop. Some statement endpoints may require SCA (signing with a key pair registered with Wise), so plan for that. |
| **RBC** | CSV (and OFX/QFX if available) upload | Saved column-mapping template per account; drag-drop monthly import. An aggregator (Plaid or Flinks, both cover RBC) is an optional later upgrade. |
| **Wio (UAE)** | CSV/statement upload | Revisit when Wio or UAE Open Finance APIs become accessible. |

- **Import pipeline:** parse, normalize, **dedupe** (hash of account + date + amount + reference/description), stage as `bank_transactions`, auto-post to Uncategorized, apply rules, then send to the review queue.
- **Rules engine:** for example "description contains `AMZN Mktp` → category X, contact Y, mark reviewed."
- **Transfer matching:** detects moves between your own accounts (Wise CAD → RBC, Wise USD → Wise CAD conversions) and pairs them as transfers, not income/expense.
- **Payout matching:** pairs marketplace payouts with settlement clearing accounts (see 3.3).
- **Reconciliation:** per account, against the statement ending balance, Wave-style.

### 3.3 Commerce hub

**Connections vs. channels.** A *connection* is a set of credentials (one Amazon seller account in one region, one eBay account). A *channel* is where you sell (Amazon.ca, Amazon.com, eBay US, Noon UAE, kazomo.com, Facebook Marketplace). One Amazon North America seller account covers Amazon.ca and Amazon.com, so adding Amazon US is **a new channel on the existing connection**, not a new integration.

| Provider | Region / endpoint | Auth | What we pull |
|---|---|---|---|
| Amazon SP-API | NA (`sellingpartnerapi-na`) for CA/US; **EU endpoint** for Amazon.ae | LWA app (client id/secret) + per-seller refresh token. AWS SigV4 signing is no longer required. | Orders, Finances (financial events), **Settlement reports**, FBA inventory + inventory ledger reports, Catalog/Listings, Fee estimates, Solicitations |
| Amazon Ads API | per region | Separate OAuth | Spend per campaign/ASIN, for true per-SKU profit (phase 6) |
| eBay | REST (Fulfillment, Finances, Inventory) | OAuth user token | Orders, payouts, fees |
| Noon | API if access is granted; otherwise report/CSV import | n/a | Orders, statements |
| Website / Shopify / Woo | later | OAuth / API key | Orders, payouts |
| Facebook Marketplace / manual | Manual entry or CSV | n/a | Orders |

**Channels are CRUD:** name, type (marketplace / own store / manual), currency, optional connection, whether the marketplace collects and remits sales tax ("marketplace facilitator", per jurisdiction), and its **account mapping** (sales, shipping income, refunds, each fee type, clearing account).

**Settlement-based accounting:** each settlement report becomes one summarized journal entry, for example:

```
Amazon.ca settlement 12345 (Sep 1–14)                    Dr         Cr
  Sales – Amazon.ca                                                4,820.00
  Shipping income – Amazon.ca                                        120.00
  Refunds – Amazon.ca                                   210.00
  Amazon referral fees                                  723.00
  FBA fulfilment fees                                   901.50
  FBA storage fees                                       64.20
  Advertising (deducted)                                350.00
  Amazon Clearing – CA (Money in Transit)             2,691.30      ← equals the payout
                                                      ────────   ────────
                                                      4,940.00   4,940.00
Later, when the RBC/Wise deposit arrives, it is matched as a transfer:
  Bank 2,691.30 Dr  /  Amazon Clearing – CA 2,691.30 Cr
```

Taxes collected, reimbursements, reserves and other adjustments each map to their own lines. Order-level detail stays in the commerce module for analytics, while the ledger stays clean.

**PII policy:** we do **not** request buyer PII (no Restricted Data Tokens). None of these features need it, and leaving it out keeps the app outside Amazon's restricted-data requirements, which matters once this is a public app.

### 3.4 Review requests (Amazon Solicitations API)

- **Eligibility:** Amazon allows one request per order, sent 5–30 days after delivery. The API (`getSolicitationActionsForOrder`) is the source of truth, and orders already requested in Seller Central come back ineligible.
- **Manual:** request from an order row, or **bulk-select** in the order table, for example "all eligible orders from last week."
- **Auto rules:** for example "request on day 7 after delivery, all channels, exclude refunded/returned orders, exclude SKUs [...]", run as a daily job.
- **Queue:** respects the ~1 req/s rate limit (1,000 orders takes about 17 minutes, in the background) and tracks status per order: eligible → queued → sent / not eligible / expired / failed.
- **Constraints to know:** Amazon sends its own standard template, so the message cannot be customized. Filtering by sentiment (review gating) would violate policy and is deliberately not offered.

### 3.5 Inventory & COGS

- **Products (master SKUs)** map to **listings** per channel (Amazon SKU / ASIN / FNSKU per marketplace, eBay item, Noon SKU). Bundles and kits are supported (one listing = N units of components).
- **Suppliers → Purchase orders → Receipts.** Landed cost is allocated by units, weight or value: product cost, freight, duties, brokerage, prep and labeling. Purchases post Dr Inventory / Cr AP or Bank.
- **Locations:** own warehouse / 3PL, FBA (per region), in transit, Noon FBN.
- **Inventory movements ledger** (the source of truth for quantities): receipt, transfer to FBA, sale, customer return, removal, damaged/lost, reimbursement, adjustment. Amazon movements come from the FBA inventory ledger report.
- **FIFO lots:** each receipt creates a cost layer, and sales consume the oldest layers.
- **COGS posting:** per settlement period (or monthly), Dr COGS / Cr Inventory for units sold at FIFO cost. Reimbursements and write-offs post to their own accounts.

### 3.6 Analytics & planning

**SKU profitability (per channel, per period):**

```
net revenue − referral − FBA fulfilment − storage (allocated) − returns (allocated)
            − landed COGS − ad spend (Ads API) = contribution margin  → margin %, ROI, TACoS
```

Flags: margin below threshold, ROI below threshold, slow movers, aged inventory nearing long-term storage fees, high return rate. Each flag gets a **Continue / Watch / Discontinue** suggestion with the numbers behind it.

**Reorder planner:**

```
velocity v   = weighted units/day over in-stock days (e.g. 0.5·7d + 0.3·30d + 0.2·90d)
lead time L  = production + transit + FBA receiving (days, per supplier/SKU)
safety stock = z · σ_daily · √L                     (z ≈ 1.65 for ~95% service)
reorder pt   = v · L + safety stock
available    = FBA fulfillable + reserved transfer + inbound + warehouse + open POs
order qty    = max(0, v · (L + cover days) + safety stock − available) → round to MOQ / case pack
stockout ETA = today + on-hand / v
```

The planner shows which SKUs to order now, how many, and by when, and it can create a draft PO from the suggestion. Seasonality and promo adjustments come later.

**Dashboards:** revenue, gross margin, net profit, EBITDA (from tagged accounts), cash position across currencies, channel mix, and top/bottom SKUs.

### 3.7 Settings & connections

| Level | Where | Examples |
|---|---|---|
| System | Environment variables | `DATABASE_URL`, Resend key, master encryption key, Trigger.dev keys, (later) a public SP-API app's client id/secret, Stripe keys |
| Organization | Settings → Connections (encrypted in the DB) | SP-API: client id + secret + refresh token ("bring your own app" mode), Wise token, eBay OAuth, Noon, Ads API |
| Organization | Settings → General | Name, country, base currency, fiscal year end, tax registrations (GST/HST #, TRN), lock date, members & roles |

- **Envelope encryption:** each secret is encrypted with its own data key, which is in turn encrypted with the master key (KMS-ready). Saved secrets display masked (`••••a1b2`) and can be replaced but never read back.
- Each connection has a **Test connection** button, last-sync status and errors, and a sync history.
- **Amazon modes:** today, *bring your own app* (your existing private app's credentials, self-authorized per seller account). For public SaaS, a **"Connect with Amazon"** OAuth button via a public Appstore app, which requires Amazon's app review and data-protection requirements. The data model supports both from the start.

---

## 4. Data model sketch

```
platform    users, organizations, memberships, invitations, audit_logs,
            plans, entitlements, org_entitlement_overrides, secrets, connections
accounting  accounts, journal_entries, journal_lines, contacts, tax_rates,
            fx_rates, period_locks, attachments
banking     bank_accounts, import_batches, bank_transactions, bank_rules,
            reconciliations, matches
commerce    sales_channels, channel_account_mappings, orders, order_items,
            settlements, settlement_lines, payouts, review_requests, review_rules
inventory   products, product_components, listings, suppliers, purchase_orders,
            po_lines, landed_costs, locations, inventory_lots, inventory_movements,
            inbound_shipments
analytics   sku_daily_metrics (materialized), reorder_suggestions, alerts
```

Every tenant table has `organization_id`, `created_at`, `created_by`, and an RLS policy. IDs are UUIDv7 (sortable). Money is `NUMERIC(20,4)` plus a `currency CHAR(3)`.

---

## 5. Plans & feature gating (future-proofing, minimal today)

- `features` is a static registry from the module manifests. `plans` → `plan_features` (+ limits such as connections, orders/month). `org_entitlement_overrides` allow per-org exceptions.
- `can(org, "reviews.bulk")` runs in server actions/route handlers and drives the UI (hide or show an upsell).
- **Today:** all three orgs are on an internal **Unlimited** plan. **Later:** a Stripe Billing webhook sets the org's plan, and no module code changes.
- Usage metering hooks (orders synced, review requests sent) are recorded from day one, which is cheap and useful for pricing later.

---

## 6. UI/UX approach

- **Design system first:** Tailwind tokens (color, radius, spacing, typography), light/dark, shadcn/ui primitives, and a shared `DataTable` (TanStack Table: sorting, filters, column visibility, bulk actions, virtualized for large transaction lists). Charts with Recharts.
- **App shell:** org switcher (top-left), module sidebar driven by manifests and entitlements, ⌘K command palette, keyboard shortcuts on Transactions (j/k, c to categorize, r to mark reviewed).
- **Tools:** **Lovable** to prototype screens quickly (same React/Tailwind/shadcn stack, so components port over), **Figma** for the design system and final polish, **Canva** for brand and marketing assets. The product itself lives in this repo, not in Lovable, because the domain logic needs full ownership and tests.
- **Product name:** it deserves its own brand (separate from Kazomo) if it may go public.

---

## 7. Roadmap

Sizes are rough and assume focused work with Claude Code doing most of the implementation and you reviewing.

| Phase | Scope | Done when | Size |
|---|---|---|---|
| **0. Foundations** | Monorepo, CI (lint, typecheck, tests), Next.js + Tailwind + shadcn shell, Drizzle + Neon, Better Auth + orgs + roles, RLS, org switcher, audit log, secrets vault, module/entitlement registry, Trigger.dev wiring, preview deploys, seed the 3 orgs, `CLAUDE.md` conventions. Lovable/Figma prototypes of the key screens in parallel. | You can log in, switch between the 3 orgs, invite a member, save an encrypted connection; CI green; preview URL per PR. | 1–2 wks |
| **1. Ledger & accounting core** | CoA (Wave taxonomy + country templates), ledger engine with invariants and property-based tests, Transactions UI, journal entries, FX rates, sales taxes, period locks, reports (P&L, BS, TB, GL, Account Transactions, Sales Tax), Wave import. | Last fiscal year re-created from the Wave export, with **P&L and Balance Sheet matching Wave to the cent** for all 3 orgs. | 3–4 wks |
| **2. Banking** | CSV/OFX importer + mappings (RBC, Wio), Wise API sync + webhooks, dedupe, rules, transfer matching, reconciliation. | Wise syncs automatically; a monthly RBC import + review takes under 10 minutes; accounts reconcile. | 2–3 wks |
| **3. Commerce connections, orders & review requests** | Connections (SP-API BYO credentials, eBay OAuth), channels CRUD, order sync, **review request engine** (manual, bulk, auto rules). | Bulk review requests running for Kazomo; Teknoffice Amazon.ca + eBay orders syncing. | 2 wks |
| **4. Settlements → accounting** | Settlement/finance import, channel account mapping, summarized settlement entries, payout ↔ bank deposit matching; Amazon.ae via the EU endpoint. | Settlements post automatically and reconcile to deposits; channel P&L visible. **Start the parallel run with Wave here.** | 2–3 wks |
| **5. Inventory & COGS** | Products, listings mapping, bundles, suppliers, POs, landed costs, FIFO lots, FBA inventory ledger import, COGS posting. | Monthly P&L shows accurate COGS; on-hand per location matches Seller Central. | 3–4 wks |
| **6. Analytics & planning** | SKU profitability, Amazon Ads API spend, reorder planner + draft POs, alerts (email via Resend), dashboards. | Weekly "what to reorder / what to drop" view you actually use. | 2–3 wks |
| **7. More channels & accounting depth** | Noon, Amazon.com channel, website/Shopify, manual channels; invoices/bills, AR/AP, cash flow report, unrealized FX revaluation, receipt OCR. | Wave switched off. | ongoing |
| **8. SaaS readiness (when you decide)** | Stripe billing → plans → entitlements, self-serve onboarding, public SP-API app + Appstore review, security hardening, terms/privacy, full data export, marketing site. | First external customer onboarded. | 3–4 wks |

**Why this order:** the ledger is the foundation everything posts into, so it comes first and gets the most testing. Review requests (phase 3) are an early standalone win that only needs order sync. Inventory/COGS needs settlements to know what sold and where the money went.

---

## 8. Working with Claude Code

- **`CLAUDE.md`** (created in phase 0) holds the stack, folder conventions, the module pattern, money/FX rules, the RLS rule ("every query is org-scoped"), test commands, and "never" rules (no floats for money, no editing posted entries, no secrets in logs).
- **Work in PR-sized tasks.** Break each phase into GitHub issues. Use plan mode for anything touching the ledger, tenancy or security, and review those PRs line by line.
- **Tests are the guardrail:** ledger invariants (fast-check property tests), golden report fixtures from the Wave export, and recorded SP-API/Wise responses as fixtures (also the Amazon SP-API sandbox).
- **Model tiers:** use the most capable tier for data-model/ledger/FX/COGS/security design and hard reconciliation bugs, the default tier for everyday feature work, and the fast tier for routine UI, CRUD, tests and docs.
- **Local vs cloud sessions:** do foundations and anything needing real credentials or a running app locally. Hand well-scoped, test-covered tasks to cloud sessions in parallel; they come back as branches/PRs. Cloud sessions use seed data and fixtures only, never production credentials. A SessionStart hook installs dependencies and starts a throwaway Postgres so cloud sessions can run the test suite.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Ledger bugs corrupt financials | Immutable posted entries, reversing corrections, DB-level balance checks, property tests, golden reports vs Wave, parallel run before cutover, PITR backups. |
| SP-API rate limits / throttling | Queue per connection + endpoint with token-bucket limits, incremental syncs, report-based bulk pulls instead of per-order calls. |
| Amazon policy changes (Solicitations, data protection) | No PII, official API only, isolated in `integrations/amazon-sp`. |
| Credential leakage | Envelope encryption, masked display, read-only tokens where possible, audit log, no secrets in logs or client bundles. |
| Scope creep (it's an accounting suite *and* a seller tool) | Phase exit criteria; Wave stays the system of record until phase 4–5 is proven. |
| Tax treatment differences (CA GST/HST, PST, UAE VAT, marketplace-facilitator rules) | Tax rates and channel tax flags are configuration, not code; validate setup with your accountant. |

---

## 10. Open decisions

1. Fiscal year end for each company, and the province(s) for Kazomo Inc. and Teknoffice (affects GST/HST/PST defaults).
2. Wave migration depth: full transaction history vs. opening balances at a cutover date.
3. Inventory costing: FIFO (proposed) vs. weighted average. Confirm with your accountant.
4. Hosting budget/preference: the proposed Vercel + Neon + Trigger.dev vs. a single host (Railway/Render/Fly).
5. Does Teknoffice's Amazon seller account have its own SP-API developer registration, or should the existing app be authorized for it?
6. Product name and domain (if a public launch is likely).

# Backoffice: Product & Development Plan

> Status: **Draft v0.2.** Updated with the decisions from the first review (see [§11 Decision log](#11-decision-log)). Nothing is built yet.

## 0. Key decisions (TL;DR)

| Topic | Decision |
|---|---|
| Product shape | **One multi-tenant product.** Each company is an **Organization** with strictly isolated data. One login can belong to many organizations and switch between them (like Wave's business switcher). A separate login for one company (e.g. an accountant who only sees Teknoffice) is just an invite. |
| Tenancy model | Shared Postgres database, `organization_id` on every tenant table, enforced by **Postgres Row-Level Security** and by app-level scoping. No database per tenant. |
| Per-org setup | Country, province/state, base currency, **fiscal year end** (any month/day; default 31 Dec), and tax registrations are **organization settings**, not code. |
| Modules per org | Each org switches modules on or off (Accounting, Banking, Commerce, Inventory, Reviews, Analytics). This sits on top of plan entitlements. Teknoffice starts as Accounting + Banking only. |
| Accounting core | A real **double-entry ledger** (journal entries + lines). Wave-style "Transactions" are a friendly UI over journal entries. Money is stored as `NUMERIC`, never floats. Multi-currency from day one. |
| Attachments | **Multiple receipts per transaction** (and per bill, PO or journal entry), stored in a private AWS S3 bucket, plus a "Receipts inbox" for unmatched uploads. |
| Wave migration | **Full transaction history and receipts**, imported from Wave's Data Export and verified against Wave's reports. |
| Commerce accounting | **Settlement-based posting** (the way A2X / Link My Books work): one summarized journal entry per marketplace settlement into a clearing account, which is then matched to the bank deposit. |
| Inventory costing | **FIFO lots** with landed cost (product + freight + duty + brokerage + prep). |
| Stack | TypeScript monorepo · **Next.js** (App Router) · **Tailwind CSS + shadcn/ui** · TanStack Query/Table/Form inside Next.js · PostgreSQL + Drizzle ORM · Better Auth (organizations plugin) · **Vercel Workflows** + Vercel Cron for background jobs · Resend + React Email · **AWS S3** for files. |
| Hosting | **Vercel** (app, background workflows, cron, preview deploy per branch) + **Neon** Postgres (via the Vercel Marketplace: point-in-time restore, a database branch per preview) + **AWS S3**. Three vendors, no servers to manage. |
| Secrets | System secrets in env vars. Per-organization credentials (SP-API, Wise, eBay…) stored **encrypted in the DB** (envelope encryption, AES-256-GCM), managed from Settings, never sent back to the browser after saving. |
| Cutover | Run in **parallel with Wave** until the new P&L and Balance Sheet match Wave to the cent for at least one closed period. |
| Name | Shortlist in [§10](#10-product-name--domain). Front-runner: **Kontor**. |

---

## 1. Tenants, users & organization settings

```
User ──< Membership (role) >── Organization
                                  ├─ country, province/state, base currency
                                  ├─ fiscal year end, tax registrations, lock date
                                  ├─ enabled modules
                                  ├─ ledger, bank accounts, channels, inventory…
                                  └─ connections (encrypted credentials)
```

### Initial organizations

| Org | Country | Base currency | FY end | Banks | Modules enabled |
|---|---|---|---|---|---|
| Kazomo Inc. | CA | CAD | 31 Dec | RBC (CSV), Wise (API) | Accounting, Banking, Commerce (Amazon via the "Kazomo – Momal Fatima" SP-API app), Inventory, Reviews, Analytics |
| Teknoffice Technologies Inc. | CA | CAD | 31 Dec | RBC (CSV), Wise (API) | **Accounting, Banking only** (Wave replacement). Amazon.ca and eBay US income is recorded from bank deposits, as in Wave today. Commerce can be switched on later. |
| Kazomo For Online Selling | AE | AED | 31 Dec | Wio (CSV/statement import) | Accounting, Banking first; Commerce (Amazon.ae, Noon) from phase 4 |

### Organization settings (all editable in Settings → General)

- **Country + province/state:** seeds tax templates. CA has GST/HST by province, plus PST/QST where applicable. AE has VAT 5%. More countries (e.g. PK) are added as templates without code changes.
- **Base currency:** fixed once transactions exist.
- **Fiscal year end** is stored as month + day:
  - The default is 31 Dec (a calendar year).
  - Any other end works, e.g. 30 Jun for a Pakistan July–June year (FY 2026-27 = 1 Jul 2026 – 30 Jun 2027).
  - Report presets follow it: *This fiscal year, Last fiscal year, Fiscal Q1–Q4, Year to date*.
  - Retained earnings are **computed** (P&L accounts before the fiscal-year start roll into Retained Earnings at report time, as Wave does). Changing the FY end later therefore needs no reposting; the reports simply re-slice. A change is logged in the audit trail and warns about the transitional short year.
- **Tax registrations:** GST/HST number, QST number, UAE TRN, etc.
- **Lock date:** "books closed through" a date.
- **Modules:** see §5.

### Roles & security

- **Roles:** Owner, Admin, Accountant (full accounting, read-only connections), Bookkeeper, Viewer. Permissions are checked on the server; the UI only hides what you can't do.
- **Platform admin:** your own super-admin role across the platform, used to manage organizations, plans and overrides (needed before going public).
- **Isolation:** there are no cross-org queries in product code. A read-only "portfolio" dashboard across your own orgs could be an opt-in feature later.
- **Baseline:** 2FA required for Owners/Admins, an audit log of every write (who, when, before/after), and session management.

---

## 2. Architecture

```
┌───────────────────────────────────── Vercel ─────────────────────────────────────┐
│  apps/web (Next.js)                                                              │
│   ├─ UI: app shell · org switcher · ⌘K · module routes (Tailwind + shadcn/ui)    │
│   ├─ server actions / route handlers · webhooks (Wise, eBay, Stripe later)       │
│   ├─ workflows/ ("use workflow") ─ durable background jobs, retries, sleeps      │
│   └─ Vercel Cron ─ schedules that start workflows (nightly syncs, FX, rules)     │
└───────────┬──────────────────────────────┬───────────────────────────┬───────────┘
            │                              │ presigned URLs            │
   ┌────────▼────────┐            ┌────────▼────────┐       ┌──────────▼───────────┐
   │ Neon Postgres   │            │ AWS S3 (private)│       │ Integrations:        │
   │ RLS per org,    │            │ receipts, CSVs, │       │ Amazon SP-API & Ads, │
   │ PITR, branches  │            │ Wave archive    │       │ Wise, eBay, Noon,    │
   └─────────────────┘            └─────────────────┘       │ Bank of Canada FX,   │
                                                            │ Resend               │
                                                            └──────────────────────┘
```

### Repository layout (proposed)

```
apps/
  web/                 Next.js app: UI, server actions, webhooks, workflows/, cron routes
packages/
  db/                  Drizzle schema, migrations, RLS policies, seed data
  core/                tenancy, auth helpers, RBAC, entitlements + module toggles,
                       secrets vault, audit log, file storage (S3)
  ledger/              pure-TS double-entry engine (posting, FX, period locks), heavily tested
  modules/
    accounting/        chart of accounts, transactions, journals, attachments, contacts,
                       taxes, reports
    banking/           bank accounts, imports, rules, matching, reconciliation
    commerce/          channels, orders, settlements, payouts
    inventory/         products, listings, suppliers, POs, lots, movements, COGS
    analytics/         SKU profitability, reorder planning, alerts
    reviews/           Amazon review request engine
  integrations/
    amazon-sp/  amazon-ads/  wise/  ebay/  noon/  fx-rates/
    importers/         CSV, OFX, Wave data export
  ui/                  shadcn/ui-based design system, tokens, data-table, charts
```

Each module exports a **manifest**:

```ts
export const reviewsModule = defineModule({
  key: "reviews",
  requires: ["commerce"],                       // module dependencies
  features: ["reviews.manual", "reviews.bulk", "reviews.auto_rules"],
  nav: [{ label: "Review requests", href: "/commerce/reviews", feature: "reviews.manual" }],
  permissions: ["reviews:read", "reviews:send"],
  jobs: ["reviews.autoRules", "reviews.sendQueue"],   // paused when the module is off
});
```

### Why these choices

- **Next.js over TanStack Start:** you're hosting on Vercel, and Next.js is Vercel's first-class framework (previews, Workflows, Cron, image/edge features). It is mature, has the largest ecosystem, and React Server Components suit report-heavy pages. TanStack Start is promising but younger. We still use **TanStack Query, Table and Form** inside Next.js, which are the parts of TanStack that matter most for a data-dense app.
- **Tailwind + shadcn/ui:** components are copied into the repo as plain Tailwind code, so you can edit any of them yourself. Lovable also generates React + Tailwind + shadcn, so its prototypes port over with little friction.
- **Drizzle:** accounting reports are SQL aggregations. Drizzle stays close to SQL, handles `NUMERIC` and RLS-friendly raw SQL well, and gives end-to-end types.
- **Better Auth:** open source and self-hosted. Its organization plugin covers members, roles and invitations, and it supports 2FA and passkeys, so there is no per-seat auth bill when this goes public.
- **Neon (via Vercel Marketplace):** point-in-time restore is non-negotiable for financial data. You get one bill through Vercel, env vars wired automatically, and a database branch per preview deployment so migrations are tested safely.
- **AWS S3:** a private bucket with Block Public Access on, server-side encryption, and **versioning on** (an accidentally deleted receipt can be recovered). Files go straight from the browser to S3 via presigned URLs, never through our functions. Keys are scoped per org: `org/{orgId}/attachments/{uuid}`.

### Background jobs: what they are and why we need them

Some work can't happen inside a normal page request: it takes too long, has to wait for something, or has to run on a schedule. Examples in this product:

| Job | Why it needs a background worker |
|---|---|
| Wave migration (years of transactions + a ZIP of receipts) | Thousands of rows and files; takes minutes to hours. |
| Amazon reports (settlements, inventory ledger) | Amazon's flow is *request report → wait until ready → download → parse*, which can take minutes. |
| Review requests (bulk + auto rules) | Amazon limits Solicitations to ~1 request/second, so 1,000 orders take ~17 minutes. |
| Wise sync, FX rates, auto rules, reorder alerts | Must run on a schedule (nightly or hourly) and retry if an API is down. |

**Trigger.dev** (proposed in v0.1) is a hosted service that runs these TypeScript jobs on its own servers, with queues, retries, schedules and a dashboard of every run. Since you're all-in on Vercel, **Vercel Workflows** (GA since April 2026) gives the same durability inside your Vercel project: functions marked `"use workflow"` / `"use step"` retry automatically, can sleep for seconds or days, and survive crashes and redeploys. Vercel Cron starts the scheduled ones. That means **one fewer vendor, bill and set of secrets**. Job logic stays in `packages/*` as plain functions, so moving to Trigger.dev or Inngest later would be a small change.

---

## 3. Modules

### 3.1 Accounting (Wave replacement)

**Chart of Accounts:** five types with Wave-compatible subtypes, so the Wave import maps 1:1.

| Type | Subtypes (Wave-compatible) |
|---|---|
| Assets | Cash & Bank · Money in Transit · Expected Payments from Customers (AR) · Inventory · Property, Plant, Equipment · Depreciation & Amortization · Vendor Prepayments & Credits · Other Short-Term Asset · Other Long-Term Asset |
| Liabilities | Credit Card · Loan & Line of Credit · Expected Payments to Vendors (AP) · Sales Taxes · Due for Payroll · Due to You & Other Business Owners · Customer Prepayments & Credits · Other Short/Long-Term Liability |
| Income | Income · Discount · Other Income · Uncategorized Income · Gain on Foreign Exchange |
| Expenses | Operating Expense · Cost of Goods Sold · Payment Processing Fee · Payroll Expense · Uncategorized Expense · Loss on Foreign Exchange |
| Equity | Owner Contribution & Drawing · Retained Earnings |

Country templates seed sensible defaults (CA: GST/HST accounts; AE: VAT 5% accounts). Each account has an optional currency, which is required for bank accounts.

**Transactions (Wave-style UX):**
- One list of every money movement with date, description, account, category, amount, a "reviewed" tick, a 📎 receipt count, and filters.
- Add income or expense, transfer between own accounts, split across categories, bulk categorize.
- Imported bank lines post immediately to **Uncategorized Income/Expense** (as Wave does), so ledger balances always match the bank. Reviewing a line re-categorizes it.
- A **journal entry** screen for accountants (manual multi-line entries).

**Receipts & attachments:**
- **One or many files per transaction**, by drag-and-drop or phone camera upload. Images and PDFs are previewed inline.
- An `attachments` table (file metadata, S3 key, checksum, uploader) plus `attachment_links` (entity type + id). One record can have many files, and one file can be linked to more than one record (e.g. a single invoice that covers two payments).
- Attachable to transactions, journal entries, and later bills, POs and products.
- **Receipts inbox:** upload receipts first and match them to transactions later. Suggested matches are based on date, amount and vendor.
- Later: forward receipts by email to an org-specific address, and OCR to pre-fill and auto-match.

**Ledger engine (`packages/ledger`):**
- `journal_entries` hold the date, memo, source (`manual`, `bank_import`, `wave_import`, `settlement`, `cogs`, `fx_reval`…), source id and status.
- `journal_lines` hold the account, a signed amount in the transaction currency, the FX rate, the amount in base currency, plus optional tax rate, contact, and product/channel tags for analytics.
- Invariants enforced in code and by DB constraints: every entry balances in base currency, posted entries are immutable (corrections are reversing entries), and nothing can post into a locked period.
- **Multi-currency:** daily FX rates come from the **Bank of Canada Valet API** for CAD orgs (free and official). The AED org uses the USD peg (3.6725) and cross rates. Realized FX gain/loss is posted on settlement or transfer; unrealized revaluation runs at period end (phase 7).

**Reports v1:** Profit & Loss (with comparisons and by-channel/by-month columns), Balance Sheet, Trial Balance, General Ledger, Account Transactions, Sales Tax report, Cash Flow (phase 7). All respect the org's fiscal year. Export to CSV/PDF.

**Later:** Customers/Vendors with invoices, bills, AR/AP aging, recurring transactions.

### 3.2 Wave migration (full history + receipts)

Wave's **Data Export** (Business settings → Data Export; Owner/Admin only) provides accounting transactions, customers, vendors, invoices, bills and a **Receipts ZIP** with every uploaded receipt in its original file type. Download links are emailed and expire after 24 hours.

**Import wizard (per org):**
1. **Upload** the Wave export files. They are archived to S3 under `org/{orgId}/imports/wave/…` for audit and never committed to git.
2. **Map the Chart of Accounts:** the Wave type/subtype maps 1:1. Review and rename before import.
3. **Import contacts** (customers, vendors).
4. **Import transactions** as journal entries tagged `wave_import`, keeping Wave's IDs and descriptions for traceability.
5. **Import receipts:** unzip to S3, then link each file to its transaction. The exact mapping depends on what the export contains. Explicit transaction references are used where present; otherwise date + amount + vendor matching runs, with a **review screen for anything unmatched**, which falls into the Receipts inbox.
6. **Verify:** for every fiscal year, compare P&L, Balance Sheet and account balances against the reports exported from Wave, and show any differences down to the transaction.

The import is idempotent: re-running it skips anything already imported, so you can do a trial run, inspect, wipe and redo. It runs as a background workflow with progress shown in the UI.

> **Next step for this:** run a Wave Data Export for one company and keep the files **outside the repo** (or in the git-ignored `imports/` folder). The importer will be built against the real file formats.

### 3.3 Banking

| Bank | Method | Notes |
|---|---|---|
| **Wise Business** | API: personal API token (use **read-only**) stored per org | Pull balances and statements per currency, plus balance webhooks for near-real-time updates. A daily statement pull serves as backstop. Some statement endpoints may require SCA (signing with a key pair registered with Wise), so plan for that. |
| **RBC** | CSV (and OFX/QFX if available) upload | Saved column-mapping template per account; drag-drop monthly import. An aggregator (Plaid or Flinks, both cover RBC) is an optional later upgrade. |
| **Wio (UAE)** | CSV/statement upload | Revisit when Wio or UAE Open Finance APIs become accessible. |

- **Import pipeline:** parse, normalize, **dedupe** (hash of account + date + amount + reference/description), stage as `bank_transactions`, auto-post to Uncategorized, apply rules, then send to the review queue.
- **Rules engine:** for example "description contains `AMZN Mktp` → category X, contact Y, mark reviewed."
- **Transfer matching:** detects moves between your own accounts (Wise CAD → RBC, Wise USD → Wise CAD conversions) and pairs them as transfers, not income/expense.
- **Payout matching:** pairs marketplace payouts with settlement clearing accounts (see 3.4).
- **Reconciliation:** per account, against the statement ending balance, Wave-style.

### 3.4 Commerce hub

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

### 3.5 Review requests (Amazon Solicitations API)

- **Eligibility:** Amazon allows one request per order, sent 5–30 days after delivery. The API (`getSolicitationActionsForOrder`) is the source of truth, and orders already requested in Seller Central come back ineligible.
- **Manual:** request from an order row, or **bulk-select** in the order table, for example "all eligible orders from last week."
- **Auto rules:** for example "request on day 7 after delivery, all channels, exclude refunded/returned orders, exclude SKUs [...]", run as a daily workflow.
- **Queue:** a durable workflow per connection sends requests in rate-limited batches (~1 req/s) and tracks status per order: eligible → queued → sent / not eligible / expired / failed.
- **Constraints to know:** Amazon sends its own standard template, so the message cannot be customized. Filtering by sentiment (review gating) would violate policy and is deliberately not offered.

### 3.6 Inventory & COGS (FIFO)

- **Products (master SKUs)** map to **listings** per channel (Amazon SKU / ASIN / FNSKU per marketplace, eBay item, Noon SKU). Bundles and kits are supported (one listing = N units of components).
- **Suppliers → Purchase orders → Receipts.** Landed cost is allocated by units, weight or value: product cost, freight, duties, brokerage, prep and labeling. Supplier invoices are attached as files. Purchases post Dr Inventory / Cr AP or Bank.
- **Locations:** own warehouse / 3PL, FBA (per region), in transit, Noon FBN.
- **Inventory movements ledger** (the source of truth for quantities): receipt, transfer to FBA, sale, customer return, removal, damaged/lost, reimbursement, adjustment. Amazon movements come from the FBA inventory ledger report.
- **FIFO lots:** each receipt creates a cost layer, and sales consume the oldest layers. Returns go back to the lot they came from where it is known, otherwise to the most recent lot.
- **COGS posting:** per settlement period (or monthly), Dr COGS / Cr Inventory for units sold at FIFO cost. Reimbursements and write-offs post to their own accounts.

### 3.7 Analytics & planning

**SKU profitability (per channel, per period):**

```
net revenue − referral − FBA fulfilment − storage (allocated) − returns (allocated)
            − landed COGS (FIFO) − ad spend (Ads API) = contribution margin  → margin %, ROI, TACoS
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

### 3.8 Settings & connections

| Level | Where | Examples |
|---|---|---|
| System | Environment variables (Vercel) | `DATABASE_URL`, Resend key, master encryption key, AWS S3 credentials + bucket, (later) a public SP-API app's client id/secret, Stripe keys |
| Organization | Settings → General | Name, country, province/state, base currency, fiscal year end, tax registrations, lock date |
| Organization | Settings → Modules | Turn modules on/off (within what the plan allows) |
| Organization | Settings → Members | Invite, roles, remove |
| Organization | Settings → Connections (encrypted in the DB) | SP-API: client id + secret + refresh token ("bring your own app" mode), Wise token, eBay OAuth, Noon, Ads API |

- **Envelope encryption:** each secret is encrypted with its own data key, which is in turn encrypted with the master key (KMS-ready). Saved secrets display masked (`••••a1b2`) and can be replaced but never read back.
- Each connection has a **Test connection** button, last-sync status and errors, and a sync history.
- **Amazon modes:** today, *bring your own app* (your existing private app's credentials). For public SaaS, a **"Connect with Amazon"** OAuth button via a public Appstore app, which requires Amazon's app review and data-protection requirements. The data model supports both from the start.

---

## 4. Data model sketch

```
platform    users, organizations, organization_settings, memberships, invitations,
            audit_logs, plans, plan_features, org_entitlement_overrides, org_modules,
            secrets, connections, usage_events
files       attachments, attachment_links
accounting  accounts, journal_entries, journal_lines, contacts, tax_rates,
            fx_rates, period_locks
imports     import_runs, import_items (Wave, CSV, OFX: source row ↔ created record)
banking     bank_accounts, bank_transactions, bank_rules, reconciliations, matches
commerce    sales_channels, channel_account_mappings, orders, order_items,
            settlements, settlement_lines, payouts, review_requests, review_rules
inventory   products, product_components, listings, suppliers, purchase_orders,
            po_lines, landed_costs, locations, inventory_lots, inventory_movements,
            inbound_shipments
analytics   sku_daily_metrics (materialized), reorder_suggestions, alerts
```

Every tenant table has `organization_id`, `created_at`, `created_by`, and an RLS policy. IDs are UUIDv7 (sortable). Money is `NUMERIC(20,4)` plus a `currency CHAR(3)`.

---

## 5. Modules, plans & feature gating

Two layers decide what an org sees:

```
Plan entitlements (what the plan ALLOWS)  ∩  Org module toggles (what the org TURNED ON)  =  what's active
```

- **Feature registry:** built from the module manifests (`accounting`, `banking`, `commerce`, `inventory`, `reviews`, `analytics`, plus finer features like `reviews.bulk`).
- **Dependencies:** Reviews requires Commerce. Inventory requires Commerce + Accounting. Profit analytics requires Inventory. The toggle UI explains and enforces these.
- **Turning a module off** hides its navigation and routes, pauses its scheduled jobs, and **keeps its data**. Turning it back on resumes where it left off.
- **Checks:** `can(org, "reviews.bulk")` runs in server actions/route handlers and drives the UI (hide, or show an upsell later).
- **Today:** all orgs are on an internal **Free / Unlimited** plan, and each org chooses its modules (Teknoffice: Accounting + Banking).
- **Later:** a Stripe Billing webhook sets the org's plan, and no module code changes. Usage metering (orders synced, review requests sent, connections) is recorded from day one to inform pricing.
- **Platform admin console:** list orgs, set plans, grant per-org overrides, and see usage and sync health.

---

## 6. UI/UX approach

- **Design system first:** Tailwind tokens (color, radius, spacing, typography), light/dark, shadcn/ui primitives, and a shared `DataTable` (TanStack Table: sorting, filters, column visibility, bulk actions, virtualized for large transaction lists). Charts with Recharts.
- **App shell:** org switcher (top-left), module sidebar driven by manifests, entitlements and toggles, ⌘K command palette, keyboard shortcuts on Transactions (j/k, c to categorize, r to mark reviewed, a to attach).
- **Tools:** **Lovable** to prototype screens quickly (same React/Tailwind/shadcn stack, so components port over), **Figma** for the design system and final polish, **Canva** for brand and marketing assets. The product itself lives in this repo, not in Lovable, because the domain logic needs full ownership and tests.

---

## 7. Roadmap

Sizes are rough and assume focused work with Claude Code doing most of the implementation and you reviewing.

| Phase | Scope | Done when | Size |
|---|---|---|---|
| **0. Foundations** | Monorepo, CI (lint, typecheck, tests), Next.js + Tailwind + shadcn shell, Drizzle + Neon, Better Auth + orgs + roles, RLS, org switcher, **org settings (country, currency, fiscal year end)**, **module toggles + entitlement registry**, platform admin basics, audit log, secrets vault, **S3 upload service**, Vercel Workflows + Cron wiring, preview deploys, seed the 3 orgs, `CLAUDE.md` conventions. Lovable/Figma prototypes of the key screens in parallel. | You can log in, switch between the 3 orgs, toggle modules (Teknoffice shows only Accounting + Banking), upload a file to S3, save an encrypted connection; CI green; preview URL per PR. | 1–2 wks |
| **1. Ledger & accounting core** | CoA (Wave taxonomy + country templates), ledger engine with invariants and property-based tests, Transactions UI, **multi-receipt attachments + Receipts inbox**, journal entries, FX rates, sales taxes, period locks, fiscal-year-aware reports (P&L, BS, TB, GL, Account Transactions, Sales Tax). | You can keep your books for a month entirely in the new app, receipts included. | 3–4 wks |
| **1b. Wave migration** | Import wizard: CoA, contacts, **full transaction history**, **receipts ZIP → S3 + matching**, verification reports. | Full history imported for all 3 orgs, **P&L and Balance Sheet match Wave to the cent for every year**, and every receipt is linked or sitting in the inbox. | 1–2 wks |
| **2. Banking** | CSV/OFX importer + mappings (RBC, Wio), Wise API sync + webhooks, dedupe, rules, transfer matching, reconciliation. | Wise syncs automatically; a monthly RBC import + review takes under 10 minutes; accounts reconcile. **Teknoffice can switch off Wave here.** | 2–3 wks |
| **3. Commerce connections, orders & review requests** | Connections (SP-API BYO credentials), channels CRUD, order sync, **review request engine** (manual, bulk, auto rules). Kazomo Inc. first. | Bulk and automatic review requests running for Kazomo. | 2 wks |
| **4. Settlements → accounting** | Settlement/finance import, channel account mapping, summarized settlement entries, payout ↔ bank deposit matching; Amazon.ae via the EU endpoint for the UAE org. | Settlements post automatically and reconcile to deposits; channel P&L visible. | 2–3 wks |
| **5. Inventory & COGS** | Products, listings mapping, bundles, suppliers, POs, landed costs, FIFO lots, FBA inventory ledger import, COGS posting. | Monthly P&L shows accurate COGS; on-hand per location matches Seller Central. **Kazomo can switch off Wave here.** | 3–4 wks |
| **6. Analytics & planning** | SKU profitability, Amazon Ads API spend, reorder planner + draft POs, alerts (email via Resend), dashboards. | Weekly "what to reorder / what to drop" view you actually use. | 2–3 wks |
| **7. More channels & accounting depth** | Noon, Amazon.com channel, eBay, website/Shopify, manual channels; invoices/bills, AR/AP, cash flow report, unrealized FX revaluation, receipt email-in + OCR. | Feature parity with what you used in Wave, plus the seller tooling. | ongoing |
| **8. SaaS readiness (when you decide)** | Stripe billing → plans → entitlements, self-serve onboarding, more country templates (e.g. PK), public SP-API app + Appstore review, security hardening, terms/privacy, full data export, marketing site. | First external customer onboarded. | 3–4 wks |

**Why this order:** the ledger is the foundation everything posts into, so it comes first and gets the most testing. The Wave import right after it doubles as the best possible test, years of real data reconciled to the cent. Teknoffice only needs Accounting + Banking, so it can leave Wave after phase 2. Review requests (phase 3) are an early standalone win. Inventory/COGS needs settlements to know what sold and where the money went.

---

## 8. Working with Claude Code

- **`CLAUDE.md`** (created in phase 0) holds the stack, folder conventions, the module pattern, money/FX rules, the RLS rule ("every query is org-scoped"), test commands, and "never" rules (no floats for money, no editing posted entries, no secrets in logs, **no financial exports committed to git**).
- **Work in PR-sized tasks.** Break each phase into GitHub issues. Use plan mode for anything touching the ledger, tenancy or security, and review those PRs line by line.
- **Tests are the guardrail:** ledger invariants (fast-check property tests), golden report fixtures, and recorded SP-API/Wise responses as fixtures (also the Amazon SP-API sandbox). Fixtures use **synthetic data shaped like the real exports**, never your real books.
- **Model tiers:** use the most capable tier for data-model/ledger/FX/COGS/security design and hard reconciliation bugs, the default tier for everyday feature work, and the fast tier for routine UI, CRUD, tests and docs.
- **Local vs cloud sessions:** do foundations and anything needing real credentials, real Wave exports or a running app locally. Hand well-scoped, test-covered tasks to cloud sessions in parallel; they come back as branches/PRs. Cloud sessions use seed data and fixtures only, never production credentials. A SessionStart hook installs dependencies and starts a throwaway Postgres so cloud sessions can run the test suite.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Ledger bugs corrupt financials | Immutable posted entries, reversing corrections, DB-level balance checks, property tests, Wave reconciliation, parallel run before cutover, PITR backups, S3 versioning. |
| Wave receipts can't all be auto-linked | Explicit references where present, otherwise date/amount/vendor matching, with a review screen and the Receipts inbox as fallback. Verified on a real export before building. |
| SP-API rate limits / throttling | Durable per-connection workflows with batched, rate-limited calls, incremental syncs, report-based bulk pulls instead of per-order calls. |
| Amazon policy changes (Solicitations, data protection) | No PII, official API only, isolated in `integrations/amazon-sp`. |
| Credential or document leakage | Envelope encryption, masked display, read-only tokens where possible, private S3 with presigned URLs, audit log, no secrets in logs or client bundles, `imports/` and `.env*` git-ignored. |
| Vendor lock-in to Vercel | Job logic lives in plain packages; Next.js, Postgres and S3 are portable; workflows can move to Trigger.dev/Inngest. |
| Scope creep (it's an accounting suite *and* a seller tool) | Phase exit criteria; Wave stays the system of record per org until that org's cutover phase is proven. |
| Tax treatment differences (CA GST/HST, PST, UAE VAT, marketplace-facilitator rules) | Tax rates and channel tax flags are configuration, not code; validate setup with your accountant. |

---

## 10. Product name & domain

The product should have its own brand, separate from Kazomo. Domains below showed as **available in a registry lookup on 2026-10-04**. Nothing is reserved; check again and run a trademark search (CIPO, USPTO, UAE) before buying.

| Name | Idea | Available domains |
|---|---|---|
| **Kontor** ⭐ | Historic word for a merchant's trading office and counting house (the Hanseatic *Kontore* were cross-border trading posts). It fits a back office for multi-country sellers, is short, and works in English, Urdu and Arabic speech. | **kontorhub.com**, **kontorbooks.com**, kontorhq.app, kontoro.app, kontorly.app |
| **Evenbooks** | "Books that balance." Friendly and accounting-first, in the spirit of Wave. | evenbooks.app |
| **Sellbooks** | Says exactly what it is: books for sellers. Strong for the e-commerce niche, narrower for general accounting. | sellbooks.app, sellbooks.io, sellerbooks.app |
| **Ledgerlane** | Calm, trustworthy, generic enough to grow. | ledgerlane.app |
| **Wrenbooks** | Small, friendly bird brand (approachable like Wave). | wrenbooks.app |
| **Ledgerloft** | Workspace-style name for a multi-entity "office". | ledgerloft.app, ledgerloft.io |

Shorter `.com` options (Ledgerline, Tallio, Balanco, Evenbooks, Sellbooks, Settlr, Numra…) were all taken. A good pattern is to brand as **Kontor** and use `kontorhub.com` (or `kontorbooks.com`) for the site, with `app.` as the product subdomain.

---

## 11. Decision log

| Date | Decision |
|---|---|
| 2026-10-04 | Fiscal year end is a per-org setting (default 31 Dec; supports e.g. 1 Jul – 30 Jun). All 3 current orgs use 31 Dec. |
| 2026-10-04 | Wave migration: **full transaction history + receipts**. New transactions support one or many receipts. |
| 2026-10-04 | Inventory costing: **FIFO**. |
| 2026-10-04 | Framework: **Next.js** (with TanStack Query/Table/Form). Hosting: **Vercel + Neon + AWS S3**. Background jobs: **Vercel Workflows + Vercel Cron** (replacing the Trigger.dev proposal, to stay on fewer vendors). |
| 2026-10-04 | Teknoffice uses **Accounting + Banking only**. Per-org module toggles are a first-class feature (free today, plan-gated later). |

### Still open

1. **Provinces** for Kazomo Inc. and Teknoffice. This only seeds the default tax rates, and each org can change it in Settings.
2. **Wave invoicing:** do any of the companies use Wave invoices, bills or customer statements? This decides whether invoices/bills move up from phase 7.
3. **Kazomo For Online Selling:** confirm Commerce (Amazon.ae, Noon) from phase 4 or later.
4. **Name:** pick from §10 (or propose others to check).

# Bookalyze: project status and handoff

**Read this first.** It is the single source of truth for what's done, what's in progress, what's
next and how we work. It's written for anyone picking the project up, human or AI (Claude Code,
Cursor, Copilot…).

- **Keep it current.** Every PR that changes what's done or next updates this file in the same PR:
  tick the checklist, move items between sections, add new gotchas. If it's out of date, fix it
  before starting new work.
- **The other docs:**
  - Rules and conventions: [`CLAUDE.md`](../CLAUDE.md), the "how". Read it next.
  - Product plan, roadmap and decision log: [`docs/PLAN.md`](PLAN.md), the "why" and long-term "what".
  - Environments, Neon, Vercel, Google and Resend: [`docs/SETUP.md`](SETUP.md).
  - Colours and logo: [`docs/BRAND.md`](BRAND.md).

_Last updated: 2026-10-04, phase 1, slice 1 (ledger foundations)._

---

## 1. Where we are

| Phase | State |
|---|---|
| 0. Foundations | **Done**, except the items listed under "Phase 0 leftovers" below |
| 1. Ledger & accounting core | **In progress.** Slice 1 (ledger, chart of accounts, journal entries, reports) is done |
| 1b. Wave migration | Not started. Needs a real Wave export from the owner (kept outside the repo) |
| 2. Banking, plus Entity & compliance | Not started |
| 3+. Commerce, settlements, UAE, inventory, analytics | Not started (see PLAN.md §7) |

**Live:** https://app.bookalyze.com (Vercel, `main` branch) on Neon Postgres. A static landing page
with a Resend waitlist (`apps/landing/`) is on Hostinger at bookalyze.com. A preview deploy is built
for every PR.

**Companies using it:**
- Kazomo Inc.: CBCA corporation in Ontario, short first year from June 2026.
- Teknoffice Technologies Inc.: Ontario. Accounting and Banking only.
- Kazomo For Online Selling: Dubai, AED, not VAT-registered.

Real company details are entered in the app and never committed.

---

## 2. Done

### Phase 0: foundations
- **Monorepo and tooling:**
  - pnpm and Turborepo, TypeScript 6.0.3 (pinned), Biome, Vitest, Playwright.
  - GitHub Actions CI: lint → typecheck → migrate → unit and DB tests → build → e2e.
- **Database:**
  - Drizzle and PostgreSQL with row-level security on every tenant table, set by `withOrg()`.
  - The runtime role can't bypass RLS. Migrations run as the owner role.
  - Reference data: countries, 4,963 subdivisions, and currencies with minor units.
- **Auth (Better Auth):**
  - Email and password with verification and reset.
  - Google sign-in with account linking; Google-only users can set a password.
  - Organizations, roles (owner, admin, member) and invitations.
  - Sign-up is invite-only, except for `PLATFORM_ADMIN_EMAILS`.
- **Org setup:**
  - Onboarding wizard covering name, business type, country and region, main currency, timezone
    and locale.
  - Financial year end (any month and day) and a short first year.
  - Company settings, team members, and audit log (append-only).
- **Modules:**
  - Registry, plan entitlements ∩ org toggles, and dependency rules.
  - Features page and sidebar driven by the manifests.
- **Design system:**
  - Hand-written shadcn-style components in `apps/web/src/components/ui`.
  - Light and dark mode, toasts, subtle animations, logical (RTL-ready) properties.
  - Brand logo and favicons.
- **Emails:** React Email templates (verify, reset, invitation) sent with Resend, with a dev
  preview at `/dev/emails`.
- **Landing page:** `apps/landing/`, static with a PHP waitlist endpoint that writes to a Resend
  segment.

### Phase 1, slice 1: ledger foundations (this PR)
- **Money maths** (`packages/core/src/money.ts`):
  - Exact BigInt decimal arithmetic on strings, no floats anywhere.
  - Rounds half away from zero.
  - Currency conversion rounds in one step.
- **Account taxonomy** (`packages/core/src/accounting/accounts.ts`):
  - Five types, 31 Wave-compatible subtypes.
  - Debit- or credit-normal balances.
  - System account keys.
- **Standard chart of accounts** (`chart-template.ts`):
  - 31 accounts with 1000–6000 codes.
  - Created automatically for new companies. Existing companies get a one-click "Use the
    standard chart of accounts" button.
- **Journal rules** (`journal.ts`):
  - `prepareJournalEntry()` validates an entry and computes signed amounts and base-currency
    amounts.
  - It is shared by the form (live totals) and the server (authority).
  - Property tests (fast-check) confirm every entry balances in both currencies.
- **Report shaping** (`reports.ts`):
  - Trial balance, profit and loss (with gross profit), and balance sheet.
  - Income and expenses are folded into equity as "Profit for this financial year" and "Profit
    from earlier years".
- **Database** (`packages/db/src/schema/accounting.ts`, migrations `0003_ledger` and
  `0004_ledger_invariants`):
  - Tables `accounts`, `journal_entries` and `journal_lines`, all with RLS.
  - Composite foreign keys keep lines on the same organization's accounts and entries.
  - A deferred constraint trigger requires at least two lines that sum to zero in both currencies.
  - The app role can't UPDATE or DELETE posted entries or lines. The only exception is setting
    `reversed_by_entry_id`, and only once.
- **Ledger writes** (`packages/db/src/ledger.ts`):
  - `createDefaultChart`, `postJournalEntry` (sequential `JE-0001` numbers under an advisory lock),
    `reverseJournalEntry` and `accountBalances` (sums by date range).
  - Reusable by future importers.
- **Screens** (`apps/web/src/app/o/[slug]/accounting/`):
  - Chart of accounts: tabs by type, grouped by subtype, balances, add, edit, archive and restore.
  - Journal entries: list with pagination; new-entry form with live balance check, "Balance with
    last line", and foreign currency with an exchange rate; entry detail; reversal with a date.
  - Reports: profit and loss with period presets from the financial year; balance sheet and trial
    balance as of any date; print.
- **Tests:**
  - Core: 36.
  - Database: 18 (ledger invariants, RLS, helpers).
  - E2E: 7, including the full bookkeeping flow.

---

## 3. Next up (in order)

Pick from the top. Each item is roughly one PR. Tick items here as they land.

### Phase 1: remaining slices
1. [ ] **Period locks.**
   - Add a per-org `books_locked_through` date (new table or column) and a DB trigger rejecting
     journal entries dated on or before it.
   - UI to set it in Company settings (owners and admins only).
   - The reversal dialog should default to the first open date.
2. [ ] **File uploads (S3) + attachments**, also listed under phase 0 leftovers.
   - `attachments` and `attachment_links` tables (PLAN.md §3.1); presigned upload URLs; private
     bucket keyed `org/{orgId}/…`.
   - Attach one or many receipts to a journal entry, with inline preview.
   - Then the **Receipts inbox**: upload first, match later.
3. [ ] **Transactions screen (Wave-style)**, at `/accounting/transactions`.
   - Money in and out on cash and bank accounts, with a category picker.
   - Each transaction is a two-line journal entry (`source: 'manual'`) built from a simple form.
   - A "reviewed" tick (new column or table) and a receipt count.
   - Add the nav item back in `registry.ts`.
4. [ ] **Contacts** (customers and vendors), a tenant table. Optional on journal lines. Needed by
   the Wave import.
5. [ ] **FX rates:**
   - `fx_rates` table and a daily Bank of Canada Valet job for CAD organizations.
   - AED is pegged at 3.6725 to USD.
   - Pre-fill the exchange rate in the journal form.
   - Needs Vercel Cron.
6. [ ] **Tax engine with Canada (GST/HST) and UAE (VAT) packs.**
   - Each company's tax setup is a setting in the UI, never code or seed data: registered or
     not, registration number, filing frequency (monthly, quarterly or yearly) and the date
     registration started. A company that isn't registered simply records no tax.
   - Tax rates on lines, and payable or recoverable accounts created when a company registers.
   - Sales tax report for each filing period.
7. [ ] **More reports:**
   - General ledger and account transactions (click an account on any report to drill in).
   - CSV and PDF export.
   - Comparison columns on profit and loss.

### Phase 0 leftovers
- [ ] Encrypted credential vault (`APP_ENCRYPTION_KEY`, AES-GCM) and a `connections` table, for
  SP-API, Wise and others.
- [ ] Platform admin console: list organizations, set plans, overrides.
- [ ] Two-step sign-in UI. The Better Auth twoFactor plugin is already enabled.
- [ ] Vercel Workflows and Cron wiring.
- [ ] Run migrations automatically on deploy. Today they're manual; see §5.

### Phase 1b: Wave migration
Needs the owner's Wave **Data Export** (accounting transactions, contacts, receipts ZIP) for one
company, kept in the git-ignored `imports/` folder. Build the importer against the real file
formats with synthetic fixtures in tests. Plan: PLAN.md §3.2.

---

## 4. Ledger rules (read before touching accounting code)

- **Signed amounts:**
  - Debits are positive and credits negative.
  - `journal_lines.amount` is in the entry currency; `base_amount` is in the organization's base
    currency.
  - Both columns sum to zero per entry. The database checks this at commit.
- **Currency and rate:**
  - One currency and one exchange rate per entry (`fx_rate`: base units per one unit of the entry
    currency).
  - Rounding residue in base amounts goes on the largest line.
  - Accounts with a `currency` (bank, card) accept only entries in that currency.
- **Never edit or delete posted entries.** Correct them with `reverseJournalEntry()` and post a new
  entry. The database enforces this.
- **Always validate first.** Call `prepareJournalEntry()` (core), then `postJournalEntry()` (db),
  inside `withOrg()`, then `audit()`. Importers follow the same path and set `source` and
  `sourceId`.
- **System accounts:**
  - These are accounts with a `system_key`: receivables, payables, retained earnings,
    uncategorized income and expense, and FX gain and loss.
  - They can be renamed but not archived, and their type can't change.
  - Look them up by `system_key`, never by name or code.
- **Year end:** there are no closing entries. The balance sheet computes current-year and
  prior-year profit from income and expense balances, using the financial year from
  `fiscalYearFor()`.
- **Report sums** come from `accountBalances(tx, { from, to })`. Shaping happens in core
  (`trialBalance`, `profitAndLoss`, `balanceSheet`) so it can be unit-tested.

---

## 5. How we work

### Branches, PRs, deploys
- Work on a feature branch and open a PR to `main`. CI must be green. Vercel builds a preview for
  every PR.
- **Migrations aren't run by Vercel.** When a PR adds a migration, run it against Neon after
  merging (or just before) with:
  ```bash
  DATABASE_URL_MIGRATOR='<Neon owner, direct, sslmode=verify-full>' \
  DATABASE_URL='<Neon bookalyze_app, pooled>' pnpm db:migrate
  ```
  `DATABASE_URL` is needed so the migrator can grant the runtime role (`app_runtime`) to it.

### Before pushing
```bash
pnpm lint && pnpm typecheck && pnpm test     # always
pnpm build && pnpm e2e                       # for UI or flow changes (EMAIL_DEV_LOG=true)
```
For UI changes, also look at the screens at **390px width and in dark mode** (Playwright
screenshots work well).

### Recipes
- **New tenant table:**
  1. Add it to `packages/db/src/schema/*.ts` with `organizationId` and
     `tenantIsolationPolicy(...)`. Add composite `(organization_id, id)` foreign keys when it
     references other tenant tables.
  2. Run `pnpm db:generate`.
  3. For triggers or grants, add a custom migration: `npx drizzle-kit generate --custom --name …`
     in `packages/db`.
  4. Add an RLS test in `packages/db/src/__tests__/`.
- **New screen in a module:**
  1. Add a route under `apps/web/src/app/o/[slug]/<module>/…`. A static folder overrides the
     `[module]` placeholder route.
  2. Gate it with a context helper like `getAccountingContext(slug)`, which 404s if the module is
     off.
  3. Add the nav item in `packages/core/src/modules/registry.ts`.
- **Server action:**
  - Use `"use server"`.
  - Resolve the context (membership plus module), then validate with zod
    (`apps/web/src/lib/validation/*`).
  - Do the work in `inOrg(ctx, tx => …)`, call `audit(tx, …)` and `revalidatePath`.
  - Return `{ ok, data } | { ok: false, message?, errors? }`. Never throw for user errors.
- **Client forms:**
  - Show inline field errors and confirm with a `sonner` toast.
  - Disable while pending, with a `Spinner`.
  - Use plain-language labels plus a hint wherever a choice isn't obvious.

### Testing
- **Core** (`packages/core/src/__tests__`): pure logic. Use fast-check property tests for anything
  with money.
- **Database** (`packages/db/src/__tests__`): a real Postgres. Global setup drops and re-migrates
  `bookalyze_test`. Files run serially, so make inserts idempotent (`onConflictDoNothing`) for
  shared reference rows.
- **E2E** (`apps/web/e2e/smoke.spec.ts`): one serial flow. Later tests reuse the owner created by
  the first.

---

## 6. Gotchas

- **Drizzle wraps Postgres errors.** The real message and code are on `error.cause` (see
  `pgError()` in the accounting actions).
- **Never run `pkill -f <pattern>`** in an agent shell; it can kill the shell itself. Use
  `kill $(lsof -t -i:3000)`.
- **TypeScript is pinned to 6.0.3.** TS 7 native breaks the toolchain here.
- **Better Auth rate limiting** can trip in e2e. The tests wait where needed.
- **Server-only modules** (`@/server/*`) import `"server-only"`. Client components may only
  `import type` from them.
- **Client bundle size:** `@bookalyze/core` re-exports reference data, so client components that
  import it ship those lists. Acceptable for now. Split core entry points if bundle size matters.
- **`next start` logs "The destination stream closed early"** during e2e navigation. It's harmless
  noise from aborted RSC streams.
- **Root `.env` loading:** `apps/web/next.config.ts` loads the root `.env` with dotenv.
  `packages/db/scripts/load-env.ts` does the same for scripts.

---

## 7. Owner input (none of it blocks code or migrations)

Every company-specific answer is entered by the owner in the UI, so the code must handle all
cases. These answers only help pick sensible defaults and test data:

1. GST/HST registration and filing frequency for Kazomo Inc. and Teknoffice. They'll be entered
   in the tax settings (item 6 above); both registered and unregistered must work.
2. A Wave Data Export for one company. It's only needed to confirm the importer handles Wave's
   real file formats. Never commit it.
3. Roles: today every member can manage accounts and post entries. A future "accountant" or
   read-only role is a permissions change, not a data change.

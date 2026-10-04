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

_Last updated: 2026-10-04, phase 1, slice 6 (exchange rates and cross-currency transfers)._

---

## 1. Where we are

| Phase | State |
|---|---|
| 0. Foundations | **Done**, except the items listed under "Phase 0 leftovers" below |
| 1. Ledger & accounting core | **In progress.** Slices 1 (ledger, chart of accounts, journal entries, reports), 2 (closed periods), 3 (transactions), 4 (receipts), 5 (customers and vendors) and 6 (exchange rates) are done |
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

### Phase 1, slice 1: ledger foundations
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
  - Core: 36 at slice 1, 43 after slice 3, 51 after slice 6.
  - Database: 18 at slice 1 (ledger invariants, RLS, helpers), 21 after slice 2, 24 after slice 3, 28 after slice 4, 32 after slice 5, 37 after slice 6.
  - E2E: 7 at slice 1, 8 after slice 3 (transactions flow), 9 after slice 4 (receipts flow), 10 after slice 5 (customers and vendors), 11 after slice 6 (exchange rates).

### Phase 1, slice 2: closed periods
- **Closing the books:**
  - `organization_profiles.books_locked_through`, set in Company settings → "Close the books"
    (owners and admins only, audited).
  - Quick picks for the end of the last financial year and the end of last month.
  - "Reopen all periods" asks for a second click.
- **Enforcement:**
  - `postJournalEntry()` refuses dates on or before the lock with `LedgerError` code
    `period_locked`; actions turn it into an inline date error.
  - A database trigger (migration `0006_period_locks`) refuses them too.
  - Reversals must be dated in an open period.
- **In the forms:**
  - The entry form and the reversal dialog default to the first open day and warn inline.
  - Entries in a closed period show a "Closed period" badge.
- **Main currency lock:** the currency can't change once a company has journal entries. The UI
  disables it, the server action refuses it, and a database trigger refuses it.
- **Env files:** the database scripts and `next.config.ts` now read the repo-root `.env.local`
  before `.env`.

### Phase 1, slice 3: transactions
- **Screen** (`/accounting/transactions`, the Accounting home):
  - Every current entry that touches a money account: cash and bank, credit card, money in transit
    (`MONEY_ACCOUNT_SUBTYPES` in core).
  - Filters for account, type (money in, money out, transfers), reviewed status and search.
  - Choosing one account shows its balance.
- **Forms:** add income, add expense or transfer.
  - Income and expenses can be split across categories. A negative split goes the other way, for
    example fees taken out of a payout.
  - Foreign-currency accounts ask for an exchange rate.
  - Transfers between different currencies aren't supported yet and point to a journal entry
    instead.
- **Edit and remove:**
  - Editing reverses the original entry on its own date and posts the corrected one
    (`replaceJournalEntry`). Removing reverses it (`voidJournalEntry`).
  - Reversed entries and reversals are hidden from the list but stay in the journal.
  - Transactions in a closed period are read-only.
- **Reviewed tick:** stored in `transaction_reviews` (migration `0007`), apart from the immutable
  ledger. It carries over when a transaction is edited.
- **Code:**
  - Core: `transactionLines()` turns the form into journal lines, `describeTransaction()` turns
    lines back into a transaction.
  - Database: `listTransactions()`, `setTransactionReviewed()`, `replaceJournalEntry()`,
    `voidJournalEntry()` in `packages/db/src/transactions.ts`.

### Phase 1, slice 4: receipts and files
- **Storage** (`apps/web/src/server/storage.ts`):
  - The `s3` driver uses a private bucket. The browser uploads straight to it with a presigned
    PUT, and viewing redirects to a presigned GET (5 minutes).
  - The `local` driver keeps files in `apps/web/.uploads`, for development and CI
    (`STORAGE_DRIVER=local`). Uploads go through `/api/storage/upload` with an HMAC-signed token.
  - The `none` driver applies in production when S3 isn't configured. The UI says so.
  - Setup steps: SETUP.md → "AWS S3".
- **Upload flow:**
  1. `requestUploadAction` checks type and size (PDF and images including HEIC, up to 20 MB),
     creates a `pending` attachment and returns the upload target.
  2. The browser uploads directly, with progress (`apps/web/src/lib/upload.ts`).
  3. `completeUploadAction` checks the stored size and marks the attachment `ready`.
- **Viewing:** `/api/o/[slug]/attachments/[id]` checks membership and row-level security. Add
  `?download=1` to download.
- **Database** (migration `0008`):
  - `attachments` holds file metadata with the `storage_key`.
  - `attachment_links` connects files to records (`entity_type` is `journal_entry` for now; many
    to many).
  - Helpers live in `packages/db/src/attachments.ts`.
  - When a transaction is edited, its files are copied to the replacement entry.
- **Screens:**
  - **Receipts inbox** (`/accounting/receipts`): upload first, then attach each file to a
    transaction found with search, or delete it. Only unlinked files can be deleted.
  - The transaction dialog has a "Receipts and files" section. Files attach immediately on an
    existing transaction, or on save for a new one, and stay editable in closed periods.
  - The journal entry page has the same section.
  - A paperclip and count appear on transaction rows.
- **Mobile:** inputs and selects are 16px on phones, so iOS no longer zooms in on focus.

### Phase 1, slice 5: customers and vendors
- **Database** (migration `0009`):
  - `contacts` table: type `customer`, `vendor` or `both`, name, email, phone, tax number,
    address, notes and an archived flag. Names are unique per type, ignoring case.
  - `journal_entries.contact_id` has a composite foreign key, so an entry can only point at its
    own company's contacts. Reversals carry the contact over.
- **Helpers** (`packages/db/src/contacts.ts`):
  - `listContacts()` returns contacts with received and paid totals: base-currency money-account
    lines on current entries only.
  - `contactTotals()` takes an optional date range. `contactOptions()` feeds the pickers.
  - `listTransactions()` accepts a `contactId` filter.
- **Screens:**
  - `/accounting/contacts`: tabs for Everyone, Customers, Vendors and Archived; search; received
    and paid per contact.
  - `/accounting/contacts/[id]`: details, totals for this financial year and all time, recent
    transactions, a link to the filtered Transactions list, edit and archive.
- **Transaction form:**
  - An optional Customer (money in) or Vendor (money out) field.
  - "+ Add a new customer/vendor…" creates one inline.
  - Rows show "Category · Contact". `?contact=` filters, with a chip to clear it.
- **Journal entry page:** shows "With {contact}".
- **E2E:** the `signIn` helper retries after Better Auth's sign-in rate limit, because the suite
  signs in often.

### Phase 1, slice 6: exchange rates and transfers between currencies
- **Line currencies** (migrations `0010` and `0011`):
  - `journal_lines.currency` is backfilled from the entry, so entries can mix currencies.
  - The balance trigger now requires base amounts to sum to zero always, and amounts to sum to
    zero when every line shares one currency.
  - A new trigger refuses a line whose currency differs from its account's currency.
- **Rates table:** `fx_rates (date, base, quote, rate, source)`.
  - Global, not per company: rates are public data. The app may insert and update, never delete.
  - Bank of Canada rates are stored with base CAD.
- **Core** (`accounting/fx.ts`):
  - `parseBankOfCanada()` reads the Bank of Canada responses.
  - `crossRate()` derives any pair through CAD, using exact fractions rounded once.
  - The AED peg (3.6725 to USD) is handled as `PEGGED_CURRENCIES`.
  - `prepareTransfer()` (`accounting/transactions.ts`) records each side in its own currency.
    The base amount comes from the side already in the main currency, so the bank's real rate is
    what's booked. A rate is asked for only when neither side is the main currency.
  - `describeTransaction()` returns `receivedAmount` and `receivedCurrency` for these transfers.
- **Database helpers** (`packages/db/src/fx.ts`):
  - `upsertFxRates()`.
  - `fxRateOn()` returns the latest rate on or before a date, within a week, so weekends and
    holidays are covered.
  - `missingCadRates()`.
- **Web:**
  - `server/fx.ts` has `syncBankOfCanada()`, using the Valet API with 14 currencies, and
    `suggestRate()`, which fetches the missing week on demand for back-dated entries.
  - `/api/cron/fx-rates` is scheduled weekdays at 22:15 UTC by `apps/web/vercel.json`. It needs
    `CRON_SECRET`.
  - The `RateField` component pre-fills the Bank of Canada or fixed rate on transactions and
    journal entries. It follows the date until the person types their own rate.
  - Transfers between currencies ask for "Amount sent" and "Amount received" and show the bank's
    rate.
  - Lists show both sides of a transfer between currencies. Journal pages show mixed entries line
    by line, with totals in the main currency.

---

## 3. Next up (in order)

Pick from the top. Each item is roughly one PR. Tick items here as they land.

### Phase 1: remaining slices
1. [x] **Period locks.** Done in slice 2.
2. [x] **File uploads (S3), attachments and the receipts inbox.** Done in slice 4. Still to
   come:
   - Suggested matches (date, amount, vendor) and OCR.
   - Forwarding receipts by email.
   - A daily clean-up of `pending` attachments that were never completed (harmless meanwhile).
3. [x] **Transactions screen.** Done in slice 3. Still to come: a receipt count once
   attachments exist, bulk review and bulk categorize, and transfers between different
   currencies.
4. [x] **Contacts (customers and vendors).** Done in slice 5. Still to come: contacts on
   individual journal lines (for multi-party entries), and merging duplicate contacts.
5. [x] **Exchange rates and transfers between currencies.** Done in slice 6. Still to come:
   - Unrealized gain or loss on foreign-currency balances at period end (phase 7).
   - Splitting a bank conversion fee from the exchange rate, when the bank shows it separately.
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
- [ ] `CRON_SECRET` must be set in Vercel (Production) for the daily rates job. See SETUP.md.
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

- **Journal entries vs transactions:**
  - A journal entry is the underlying record: balanced debit and credit lines, able to describe
    anything.
  - A transaction is the everyday view of an entry that moves money in or out of a money account
    (bank, card, cash).
  - Every transaction is a journal entry. Entries that don't touch a money account (depreciation,
    accruals) appear only under Journal entries. Both feed the same reports.

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
- **Closed periods:** nothing may be dated on or before `books_locked_through`. Every write goes
  through `postJournalEntry()`, which checks it, and the database checks again.
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
- **Never run `pkill -f <pattern>`** in an agent shell; it can kill the shell itself. Find
  servers with `ps aux | grep next-server` and kill them by PID. `lsof -i:3000` can miss them.
- **A stale `next start` on port 3000** makes Playwright reuse it (`reuseExistingServer`) and
  serve an old build. Symptoms: "This page couldn't load", `ChunkLoadError` or missing chunks.
  Kill it before running e2e.
- **TypeScript is pinned to 6.0.3.** TS 7 native breaks the toolchain here.
- **Better Auth rate limiting** can trip in e2e. The tests wait where needed.
- **Server-only modules** (`@/server/*`) import `"server-only"`. Client components may only
  `import type` from them.
- **Client bundle size:** `@bookalyze/core` re-exports reference data, so client components that
  import it ship those lists. Acceptable for now. Split core entry points if bundle size matters.
- **Visually hidden (`sr-only`) grid headings** are absolutely positioned, so they take no grid
  cell and shift every later heading. Wrap them in a plain `<span>`.
- **A Radix dialog that is closing** swallows clicks for about 300ms. Key the dialog per opening
  (see `transaction-list.tsx`) when it can reopen straight away.
- **Migrations that UPDATE `journal_lines` must pause the deferred `journal_lines_balanced`
  trigger** (`DISABLE TRIGGER` … `ENABLE TRIGGER`, see `0010_fx.sql`). Otherwise its pending
  events block any later `ALTER TABLE` in the same migration run. Test databases start empty, so
  CI won't catch this. Apply new migrations to a dev database that has entries before pushing.
- **This sandbox can't reach bankofcanada.ca** (egress policy). Rate tests use a sample of
  Valet's format, and the e2e test stores today's rate itself. Live fetching happens on Vercel.
- **Mobile inputs must be at least 16px** or iOS zooms in on focus. `Input` and `NativeSelect` use
  `text-base sm:text-sm`. Keep that when adding new controls.
- **Uploads never go through server actions or route bodies on Vercel** (4.5 MB limit). The
  browser uploads to S3 with a presigned URL.
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

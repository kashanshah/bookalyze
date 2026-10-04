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

_Last updated: 2026-10-04, phase 1b (importing from other software)._

---

## 1. Where we are

| Phase | State |
|---|---|
| 0. Foundations | **Done**, except the items listed under "Phase 0 leftovers" below |
| 1. Ledger & accounting core | **In progress.** Slices 1 (ledger, chart of accounts, journal entries, reports), 2 (closed periods), 3 (transactions), 4 (receipts), 5 (customers and vendors), 6 (exchange rates) and 7 (sales tax) are done |
| 1b. Migration from other software | **Importer done**: transactions (generic CSV, Wave first), customer and vendor lists, and receipt files. Being tried on a real Wave export |
| 2. Banking, plus Entity & compliance | **In progress.** Wise connection (API sync) with duplicate flagging and merging done. Next: bank statement upload (CSV) for any other bank, then rules and transfer matching |
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
  - Core: 36 at slice 1, 43 after slice 3, 51 after slice 6, 58 after slice 7, 70 after the importer, 76 with contacts and receipts, 78 with reconciliation.
  - Database: 18 at slice 1 (ledger invariants, RLS, helpers), 21 after slice 2, 24 after slice 3, 28 after slice 4, 32 after slice 5, 37 after slice 6, 42 after slice 7, 46 after the importer, 48 with contacts and receipts, 52 with reconciliation.
  - E2E: 7 at slice 1, 8 after slice 3 (transactions flow), 9 after slice 4 (receipts flow), 10 after slice 5 (customers and vendors), 11 after slice 6 (exchange rates), 12 after slice 7 (sales tax), 13 after the searchable dropdowns, 14 after the importer, 15 with reconciliation.

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

### Phase 1, slice 7: sales tax
- **Schema** (migration `0012_sales_tax`):
  - `tax_rates`: name, rate (percent), the liability account that holds the tax, whether tax
    paid can be claimed back, archived. A trigger keeps the percentage, account and claim-back
    setting fixed once any line uses the rate (rename or archive instead).
  - `tax_registrations`: authority, registration number, filing frequency, registered since,
    active.
  - `journal_lines.tax_rate_id` (composite FK, so a line can't use another company's rate).
- **Amounts include tax**, as on a receipt or bank statement. Core `transactionLines(input,
  memo, { rates, decimals })` splits each taxed category into a net line and a tax line on the
  rate's account; both carry `tax_rate_id`. `splitTaxIncluded()` rounds the tax once and never
  loses a cent. Tax collected is always split out; tax paid is split out only for claimable
  rates (otherwise it stays in the cost). `describeTransaction()` merges the tax line back, so
  the form shows the tax-included amount.
- **Packs** (`packages/core/src/accounting/tax.ts`): `ca-gst-hst` (HST 13/14/15%, GST 5%,
  zero-rated, QST, BC PST) with defaults per province, and `ae-vat` (VAT 5%, zero-rated).
  `applyTaxPack()` creates the tax account (subtype `sales_tax`, code 2200 when free) and the
  chosen rates, skipping existing names, and starts a quarterly registration if none exists.
  Packs are starting points: rates are stored per company.
- **Report:** `salesTaxRows()` totals per rate for a date range. A taxed line on the rate's
  account is tax, any other taxed line is the amount it was charged on; credits are sales or
  tax collected, debits purchases or tax paid. Reversals are classified with the sign of the
  entry they undo, so edits and removals net out. `salesTaxSummary()` (core) nets collected
  against claimable.
- **Web:**
  - Accounting → Sales tax (`/accounting/sales-tax`): one-click starter for the company's
    country and province, rates (add, edit, archive), registrations.
  - Transactions: a tax picker per category (shown once rates exist) with a live "Includes $13.00
    HST you collected" hint. "Add category" copies the previous category's tax.
  - Reports → Sales tax (`/accounting/reports/sales-tax`): filing periods follow the active
    registration (months, financial-year quarters or years), defaulting to the last finished
    period. Shows collected, claimable and owing (or refund), per rate.
  - A company that isn't registered sets nothing up and sees no tax picker.

### Phase 1b: importing from other software
One importer for every program: Wave, QuickBooks, Xero, Zoho Books, Sage and "other". Each
reads a CSV of journal lines (one row per line of a transaction). A source only adds export
steps and its column names; adding software is a data change in `IMPORT_SOURCES`, not new code.
- **Core** (`packages/core/src/import/`):
  - `csv.ts`: a forgiving CSV reader (quotes, BOM, `,` `;` tab delimiters). It skips a
    report's title block to find the header row and keeps file line numbers for messages.
  - `values.ts`: dates in any common format, with day/month order detected from the column.
    Amounts with symbols, thousands separators, `(45.00)`, trailing minus and decimal commas.
  - `sources.ts`:
    - `IMPORT_FIELDS` (date, transaction ID, account, code, type, debit/credit or one amount
      column, descriptions, reference, customer/vendor).
    - `IMPORT_SOURCES` (export steps and column names per program).
    - `guessColumns()`.
    - `guessSubtype()`: maps Wave, QuickBooks and Xero account types, then account names, to
      our subtypes.
  - `plan.ts` `planImport()`:
    - Fills down blank dates and IDs (QuickBooks prints them once per entry).
    - Groups rows by transaction ID, or by running total for files without unique IDs.
    - Rejects entries that don't balance or have bad dates, listing them with line numbers.
    - Collects accounts and contacts. Contacts are customers or vendors by column, or by what
      their entries touch.
    - Gives every entry a stable `externalId`: `source:ID`, or a fingerprint of date and lines.
- **Database** (migration `0013_imports`):
  - The `import_batches` table.
  - `import_batch_id` on journal entries, accounts and contacts.
  - Source `import`, with a unique `(organization_id, source_id)` for imported entries, so a
    file imported twice only adds what's new.
  - `undo_import_batch()` (security definer) deletes an import's entries, plus its accounts and
    contacts if nothing else uses them. It refuses when an imported entry was since edited or
    removed, or falls in a closed period. This is the one sanctioned way posted entries are
    deleted.
  - Helpers in `packages/db/src/imports.ts`, posting entries in bulk.
- **Web** (Accounting → Import, owners and admins only):
  - A wizard: source and export steps, file, columns (prefilled, with a live preview), accounts
    (matched to yours by code, name or single-instance subtype, otherwise created by type), and
    a review. The review lists left-out rows, blocks closed periods and warns when the books
    already have entries in those dates.
  - The file is parsed in the browser and posted in chunks of 200, so there's no upload limit or
    timeout. The original file isn't stored.
  - The import list shows each batch, with Undo.
- **Customer and vendor lists** (`import/contacts.ts`):
  - Added on the review step. Columns are recognised by name (Wave's `customer_name`,
    `province/state`… and common ones elsewhere).
  - Emails, phones, a combined address and notes (contact person, website, currency) fill in the
    contacts. Existing contacts only get details they're missing.
  - `account_number` (vendors' bank accounts in Wave) is deliberately never read.
- **Receipt files** (`import/receipts.ts`, Import page):
  - Files named `YYYY-MM-DD-Merchant_Name.ext` (Wave's export) are matched to the transaction
    within 3 days that shares the most words with the name. Ties and no-matches go to the
    Receipts inbox, so nothing is attached to the wrong transaction.
  - Re-running skips files already uploaded under the same name.
  - Uploads go straight to storage, three at a time.
- **Limits:**
  - Amounts are taken as the main currency: Wave exports in the business currency, and
    foreign-currency accounts come in converted.
  - Wave's `bill_items.csv` isn't read. Bills already reach the books through the transactions
    file; it matters once Bookalyze has bills.

### Phase 1: reconciliation
- **Schema** (migration `0014_reconciliation`):
  - `reconciliations` (account, statement date and ending balance, `in_progress`/`completed`;
    one in progress per account).
  - `reconciliation_lines` (journal lines ticked, each clearable once). It references
    `journal_lines` by `(organization_id, id)`.
  - Triggers: a completed reconciliation's ticks can't change, and its transactions can't be
    reversed (edited or removed; hint `reconciled`) until it's undone. `undo_import_batch()` also
    refuses imports with reconciled entries.
- **Core** (`accounting/reconcile.ts`): `naturalAmount()` reads balances as statements do (a
  bank's money in, a card's amount owed). `reconciliationTotals()` works out the opening,
  cleared and difference.
- **Database helpers** (`packages/db/src/reconciliation.ts`):
  - Start, tick and untick, edit the statement (unticks lines after a new earlier date),
    complete (difference must be zero), cancel, and undo (latest only, while none is in progress).
  - `reconciliationState()` lists the lines up to the statement date not cleared earlier.
    Reversed transactions drop out.
- **Web:**
  - Accounting → Reconcile lists bank, card and cash accounts with "reconciled through" dates.
  - Each account's page has the start form, the reconcile screen and its history.
  - The reconcile screen has ticks, tick all shown, filter and search, and a sticky bar with
    statement, cleared and difference. Finish is enabled at zero.
- **Transactions list:** the review tick is at the end of the row. A receipt icon shows whether
  files are attached (faint when none), and a lock marks reconciled transactions (tooltip: the
  statement date). Reconciled transactions open read-only; the server refuses changes too.

### Phase 2, slice 1: Wise connection
- **Credential vault** (`packages/db/src/vault.ts`): AES-256-GCM with `APP_ENCRYPTION_KEY`
  (32 bytes, base64). Each secret is bound to its organization and connection (associated data),
  so a value copied to another row won't decrypt. Format `v1.<iv>.<tag>.<ciphertext>`.
- **Schema** (migration `0016_banking_connections`):
  - `connections` (provider `wise`, sealed `secret`, `settings` such as the Wise profile and fee
    account, last sync and last error) and `bank_feeds` (one per Wise balance → one `cash_bank`
    account, `sync_from`, `synced_through`). Both under RLS.
  - Unique `(organization_id, source_id)` where `source = 'bank_import'`: a bank line is posted
    once, ever. Edits and deletes keep the original (reversed) row, so it stays recognised.
  - `syncable_connections()` (SECURITY DEFINER) gives the daily job organization and connection
    IDs only; each sync then runs inside `withOrg()`.
- **Core** (`banking/`): `parseWiseProfiles/Balances/Statement` (JSON numbers become exact
  decimals at the currency's precision; dates in the company's time zone), `BankTransaction`,
  `bankTransactionInput()` (bank line → Uncategorized income/expense, fee as its own split),
  `pairConversions()`.
- **Bank lines** (migration `0017_bank_lines`): every transaction a bank sends is stored once in
  `bank_lines`, unique on `(organization_id, external_id)` (Wise: `wise:<balance>:<reference>`; a
  statement upload will hash its rows the same way). Syncing again, overlapping windows or
  uploading the same file twice can't add it twice. Status `posted` (`journal_entry_id`) or
  `pending` (`reason`, e.g. no rate yet; retried every sync). Editing a bank transaction
  (`replaceJournalEntry`) or merging it moves the link to the entry that stands for it now
  (`carryEntryLinks`), and an edited one keeps source `bank_import`.
- **DB** (`banking.ts`): connections and feeds, and `importBankLines()`: stores the lines, then
  posts each new or pending one (each in a savepoint). A conversion between two connected
  balances is one cross-currency transfer (source id `conversion:<ref>`); foreign lines use the
  Bank of Canada rate of the day.
- **Possible duplicates, the Wave way** (`duplicates.ts`, table `duplicate_suggestions`):
  everything the bank sends is posted; one that looks like a transaction already in the books is
  flagged (`open`). "Looks like": a line on the same account for the same signed amount within
  `DUPLICATE_WINDOW_DAYS` (5) days, still current, not itself flagged as a copy, and not sent
  separately by the same bank feed (the bank's own IDs already tell two same-day coffees apart).
  A conversion also needs the received amount on the other account. Nobody merges automatically:
  - `acceptDuplicate()` keeps the transaction that was in the books first and reverses the copy
    on its own date; bank link and receipts move to the one kept (`mergeEntries`).
  - `dismissDuplicate()` keeps both; the pair is never flagged again (unique per pair).
  - `mergeSelected()` merges two picked by hand when `mergeProblem()` (core) allows it: same
    amount and direction, same bank account, same category (for splits, the same categories).
    The older one (lower entry number) stays.
- **Web:** Banking → Bank accounts. "Connect Wise" (owners and admins): paste a read-only token,
  pick the profile, map each balance to a new or existing bank account, choose the start date
  and the fee account; it syncs straight away. "Sync now" for anyone; "Disconnect" deletes the
  token and keeps the transactions. The daily cron (`/api/cron/fx-rates`) fetches rates, then
  syncs every connection. `WISE_API_URL` points tests at `e2e/wise-mock.mjs`. The sync toast
  and a notice on Bank accounts say how many possible duplicates wait.
- **Transactions screen:** flagged rows are highlighted with "Possible duplicate of JE-…"; it opens
  both side by side with "Merge" and "Not a duplicate". A banner counts them and the Status filter
  has "Possible duplicates" (`?status=duplicates`). Each row has a tick box: with two ticked, a
  bar offers "Merge" (or says what doesn't match) and a confirmation shows which one stays.
  `Checkbox` is now a shared component (`components/ui/checkbox.tsx`).
- **Not yet:** Wise asks for strong customer authentication (a signed request) for profiles
  outside the US, Canada, Australia, New Zealand, Singapore and Malaysia, e.g. the UAE company.
  The sync shows a plain message for now; signing with an uploaded key comes next.

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
6. [x] **Sales tax with Canada (GST/HST) and UAE (VAT) packs.** Done in slice 7. Still to come:
   - Tax on manual journal entry lines (today only transactions pick a rate).
   - Recording the filed return and the payment or refund (a "mark as filed" that posts the
     settlement and locks the period).
   - Tax-exclusive entry (type the amount before tax) for invoices, with phase-2 invoicing.
7. [x] **Searchable dropdowns everywhere.** Done: every dropdown is a `Combobox` (see §5,
   "Dropdowns"). Still to come: recently used categories at the top, and remembering a vendor's
   usual category.
8. [ ] **More reports:**
   - [x] General ledger and account transactions. `reports/general-ledger`: every account's
     opening, debits, credits and closing for a period; `?account=` lists one account's lines
     with a running balance (first 1,000 lines; totals and closing always cover the period).
     Accounts on the trial balance, profit and loss and balance sheet link into it (balance
     sheet and trial balance use the financial year to date, so the opening is everything
     before it). Queries: `ledgerActivity`, `accountLedgerLines` (db `reports.ts`); shaping:
     `generalLedgerSummary`, `accountLedger` (core).
   - [x] CSV and PDF export. Every report has "Download CSV" (`/api/o/[slug]/reports/[report]`,
     same URL params as the page; builders in core `accounting/export.ts`: plain numbers rounded
     to the currency, a header block, formula-safe text) and "Print or save PDF" (the browser's
     print dialog; printouts drop the navigation and always use the light theme). Pages and
     downloads share loaders in `reports/data.ts`, so they always agree. Ledger CSVs hold up to
     50,000 lines. A server-made PDF (letterhead, page numbers) can come later if needed.
   - [x] Accountant's export in Wave's layout. Reports → Accounting transactions (also "Export
     for accountant" on Transactions): one row per journal line with Wave's 22 "Accounting
     transactions" columns, built by `waveTransactionsCsv` (core `accounting/wave-export.ts`)
     from `transactionExportLines` (db). An entry and its reversal are left out when both fall
     in the period. Sales tax is split across the taxed lines; Wave's account group and type
     names come from `WAVE_TYPES`. A unit test reads the file back through our own Wave importer.
     Up to 200,000 lines per file (shorter period otherwise).
   - [x] Comparison columns on profit and loss. "Compare with" (`?compare=previous|last-year`):
     the period just before (whole months step back by months, otherwise by days) or the same
     dates a year earlier (month ends kept). Each account shows this period, the earlier one and
     the change with a percentage; accounts only active earlier still get a row. Core
     `accounting/compare.ts`; the CSV gets the same columns.

### Phase 0 leftovers
- [x] `CRON_SECRET` is set in Vercel, so the daily rates job runs.
- [x] Encrypted credential vault (AES-GCM) and a `connections` table. Done in phase 2, slice 1.
- [ ] Platform admin console: list organizations, set plans, overrides.
- [ ] Two-step sign-in UI. The Better Auth twoFactor plugin is already enabled.
- [ ] Vercel Workflows and Cron wiring.
- [ ] Run migrations automatically on deploy. Today they're manual; see §5.

### Phase 1b: migration, remaining
- [ ] Run the importer on the owner's real Wave export. The column names came from Wave's
  export format and were tested with synthetic files. Fix any differences in `IMPORT_SOURCES`.
- [ ] Foreign-currency lines: a currency column plus a main-currency amount column.

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
  DATABASE_URL_MIGRATOR='<Neon owner, direct (DATABASE_URL_UNPOOLED)>' pnpm db:migrate
  ```
  The migrator falls back to `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`, so after
  `vercel env pull` a bare `pnpm db:migrate` works too.

### Before pushing
```bash
pnpm lint && pnpm typecheck && pnpm test     # always
pnpm build && pnpm e2e                       # for UI or flow changes (EMAIL_DEV_LOG=true)
```
For UI changes, also look at the screens at **390px width and in dark mode** (Playwright
screenshots work well).

### Recipes

**Dropdowns:** use `Combobox` from `src/components/ui/combobox.tsx` for every choice list.
- Options are `{ value, label, group?, description?, keywords?, disabled? }`.
- `group` lists options under headings (account types, "All time zones").
- `keywords` are searched but not shown (codes, currency names).
- A search box appears for lists longer than 7. Typing on the closed trigger starts a search.
- `footer` pins an action under the list, e.g. "Add a new vendor".
- Label it with `<Field htmlFor={id}>` or `aria-label`.
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
- **Mobile inputs must be at least 16px** or iOS zooms in on focus. `Input` and `Combobox` (its
  trigger, search box and options) use `text-base sm:text-sm`. Keep that when adding new controls.
- **Uploads never go through server actions or route bodies on Vercel** (4.5 MB limit). The
  browser uploads to S3 with a presigned URL.
- **Presigned S3 uploads need `requestChecksumCalculation: "WHEN_REQUIRED"`** on the S3 client
  (`server/storage.ts`). Without it, AWS SDK v3.729+ signs a CRC32 of an empty body into the
  URL and S3 answers the browser's PUT with 403. e2e uses local storage, so only a real bucket
  shows this.
- **Database URLs:** `createDb()` rewrites `sslmode=require` to `verify-full`
  (`withVerifiedSsl`). This is node-postgres's current behaviour, made explicit, which silences
  its SSL warning.
- **`next start` logs "The destination stream closed early"** during e2e navigation. It's harmless
  noise from aborted RSC streams.
- **Server pages can't use values from `"use client"` files.** A constant or helper exported
  from a client file becomes a client reference on the server (calling it throws, and objects
  read as `undefined`). Put shared helpers and labels in `@bookalyze/core` or `src/lib`.
- **Dropdowns are `Combobox`, not `<select>`.** There is no native `<select>` in the app.
  - Grid placement (`col-span-…`) goes in `wrapperClassName`; `className` styles the trigger.
  - Picking an option fires no native `change` event, so a form's `onChange` doesn't see it.
    Track it in state (see `touched` in `components/org/profile-state.ts`).
  - Pass `name` to post the value with a form (it renders a hidden input).
  - In e2e, use `choose(trigger, "Option label")` from `e2e/helpers.ts`, not `selectOption`.
- **Tenant isolation lives in `withOrg()`.** Production logs in as Neon's owner (`DATABASE_URL`
  from Vercel's Storage integration), which bypasses RLS on its own. `withOrg()` switches each
  transaction to `app_runtime` (`set_config('role', 'app_runtime', true)`, i.e. SET LOCAL ROLE,
  safe with PgBouncer), so RLS applies inside. Outside `withOrg()` the app has owner rights:
  query tenant tables only inside it. `tenant-access.test.ts` lists the web files that use
  `getDb()` directly (reviewed: sign-in, membership and reference tables only) and fails when a
  new one appears. Migration 0015 grants the owner SET on `app_runtime` (Postgres 16 doesn't
  give a role's creator that by default). Local dev and CI still log in as `bookalyze_app`.
- **Drizzle leaves the column unqualified** (`"id"`) when a query selects from one table. Inside a
  hand-written subquery, qualify outer columns yourself (`"journal_entries"."id"`) or Postgres
  reports `column reference "id" is ambiguous`.
- **Root `.env` loading:** `apps/web/next.config.ts` loads the root `.env` with dotenv.
  `packages/db/scripts/load-env.ts` does the same for scripts.

---

## 7. Owner input (none of it blocks code or migrations)

Every company-specific answer is entered by the owner in the UI, so the code must handle all
cases. These answers only help pick sensible defaults and test data:

1. GST/HST registration and filing frequency for Kazomo Inc. and Teknoffice: entered in
   Accounting → Sales tax. Registered and unregistered both work.
2. Try Accounting → Import with a real Wave export (Settings → Data export → Accounting
   transactions, CSV). It runs in your browser, can be undone, and the file is never stored or
   committed. Report any column or account it gets wrong.
3. Roles: today every member can manage accounts and post entries. A future "accountant" or
   read-only role is a permissions change, not a data change.

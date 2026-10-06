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

_Last updated: 2026-10-06, phase 4 slice 2 (settlements post to the books)._

---

## 1. Where we are

| Phase | State |
|---|---|
| 0. Foundations | **Done**, except the items listed under "Phase 0 leftovers" below |
| 1. Ledger & accounting core | **In progress.** Slices 1 (ledger, chart of accounts, journal entries, reports), 2 (closed periods), 3 (transactions), 4 (receipts), 5 (customers and vendors), 6 (exchange rates) and 7 (sales tax) are done |
| 1b. Migration from other software | **Importer done**: transactions (generic CSV, Wave first), customer and vendor lists, and receipt files. Being tried on a real Wave export |
| 2. Banking, plus Entity & compliance | **Done in code.** Wise connection (API sync), bank statement upload (CSV) for any bank, duplicates, rules and rule suggestions, transfer matching, reconciliation, and Entity & compliance (profile, people, document vault, compliance calendar with email reminders). Next: a month of real use for Teknoffice (then it can leave Wave). Wise strong customer authentication for the UAE company moves to phase 4b; OFX import only if a bank lacks CSV |
| 3. Commerce connections, orders & review requests | **Done in code.** Slice 1 (connect Amazon Seller Central, channels), slice 2 (order sync, Orders screen), slice 3 (review requests: manual, bulk, automatic) and refunds on orders (red badge, Refunded tab) done. Next: running them for Kazomo (the Amazon app needs the Buyer Solicitation and Finance and Accounting roles) |
| 4+. Settlements, UAE, inventory, analytics | **Phase 4 in progress.** Slices 1 (bring in Amazon settlements, Settlements screen), 2 (accounts for each kind of line, posting each settlement as one entry), 3 (matching each payout to its bank deposit) 4 (any currency, automatic posting) and 5 (profit by channel) done. Next: phase 4b (UAE: Amazon.ae under the Dubai company, Noon) or phase 5 (inventory and cost of goods sold) |

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
  - Filters for account, category (`?category=`, any split counts; `categoryId` in
    `listTransactions`), type (money in, money out, transfers), reviewed status and search.
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
  - Rows show "Description · Contact". `?contact=` filters, with a chip to clear it.
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
  - A Balance column shows the balance after each line, in date order, starting from what
    earlier reconciliations cleared (under the amount on phones). When every line is on the
    statement it follows the statement's own balance, so a gap shows where they part ways.
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


### Phase 2, slice 2: bank statement upload (any bank)
- **Core** (`banking/statement.ts`): `guessStatementColumns()` (date, description and a second
  description, one amount column or separate money out / money in columns, reference, account
  number; a column named after the account's currency wins for the amount), `readStatement()`
  (rows without a date and amount are skipped quietly, unreadable ones reported) and remembered
  settings by column name (`statementSettings`, `mappingFromSettings`).
  - External ID: `csv:<accountId>:<date>:<amount>:<hash of description>:<n>`, where `n` counts
    identical rows in the same file. The same file, or an overlapping one, adds nothing twice;
    two identical coffees on one day are both kept. Keyed by account, not feed, so removing and
    re-adding uploads doesn't duplicate either.
  - Files with several accounts (one account-number column): the user picks one; only a
    fingerprint (FNV-1a) and the last 4 digits are stored, never the number.
- **Schema** (migration `0018_statement_uploads`): connection provider `csv`, one connection and
  one feed per money account (`statementFeedFor`), settings under `settings.statement`. No secret,
  so `syncable_connections()` skips it.
- **Web:** Bank accounts → "Upload a statement" (any member). Choose the account and the file;
  the first time, match the columns (with a 5-row preview and the date range); later uploads
  reuse them ("Change columns" to adjust). Rows go to `uploadStatementAction` in parts of 500,
  through `importBankLines`, so they get the same duplicate check and possible-duplicate flags as
  Wise. Foreign-currency accounts fetch missing Bank of Canada rates first (`ensureRates`).
  Each upload account shows as a card with "Upload statement" and "Remove".
- **Transactions screen:** a select-all tick box (header, or a row above the list on phones)
  ticks every transaction on the page; the selection bar now offers "Remove" for any number
  (`removeTransactionsAction`: each reversed on its own date, closed-period or reconciled ones
  left alone and reported) besides "Merge" for two. "Show 25 / 50 / 100 per page" (`?per=`,
  default 50) sits beside the page count. One transaction is still removed from its edit dialog.
- `Field` now lets its control shrink (`grid-cols-[minmax(0,1fr)]`), so long dropdown labels
  truncate instead of widening dialogs on phones. Chart of accounts: an account's currency can
  change even after it has transactions (see "Changing an account's currency" in §4).


### Phase 2, slice 3: rules
- **Core** (`banking/rules.ts`): `ruleMatches()` / `firstMatchingRule()`: description contains
  the words (case and spacing ignored), money in / out / either, optional amount range
  (inclusive, on the size of the amount), optional bank or card account. First active rule in
  order wins.
- **Schema** (migration `0020_bank_rules`): `bank_rules` (match text, direction, amounts,
  account, category, contact, `position`, `is_active`) and `rule_applications` (which rule
  categorized which journal entry; editing posts a new entry, so the mark drops off). Both RLS.
- **DB** (`rules.ts`): list (with how many current transactions each categorized), create,
  update, delete, move up/down, `countRuleMatches()` and `applyRuleToExisting()`: current
  transactions still on Uncategorized income/expense with one money account are reposted with the
  rule's category (via `replaceJournalEntry`, so review tick, receipts and bank link stay);
  closed-period or reconciled ones are skipped and counted.
- **Import:** `postBankLines()` puts a matching bank line straight into the rule's category (fee
  split unchanged; fee lines never) and sets the rule's contact; `ImportResult.categorized`
  counts them and the sync/upload toast says so.
- **Web:** Banking → Rules. Plain-language form ("When the description contains", "Money", "On",
  "Amount from / up to", "Put it in", "Customer or vendor") with a live count of matching
  uncategorized transactions and "Save and categorize N". Each rule: apply to uncategorized,
  change, delete, reorder. Transactions shows a wand on rule-categorized rows, and "Make a rule"
  in a transaction's dialog opens the form filled in (`?text=&category=`). Rule-categorized
  transactions stay unreviewed.
- **Import fixes in the same PR:**
  - Accounts step: each account can show up to 5 of its transactions from the file (date,
    description, Dr/Cr amount, what's on the other side); ones that still need a choice open with
    them showing.
  - Re-importing brings back transactions that were removed (migration `0021_reimport_removed`:
    the unique import ID now ignores reversed entries). An edited imported transaction keeps its
    ID on the replacement (`replaceJournalEntry`), so it's still skipped; edits made before this
    are recognised by their reversal and replacement being posted together (same moment, next
    entry number).
  - Wave's "Unknown Account" (an asset) now defaults to "Other current asset" instead of needing
    a choice (it had been sent to Uncategorized income, which turned its transactions into
    income/expense entries with no bank side).
- **Chart of accounts:** accounts held in another currency show their balance in that currency
  (sum of line amounts as recorded), with the main-currency value underneath.


### Simpler like Wave: no-account transactions and deleting journal entries

- **"Account not chosen" on Transactions:** an entry with no bank, card or cash line but an
  Uncategorized income/expense line (e.g. Wave's "Unknown Account" mapped to Uncategorized) now
  shows on Transactions, highlighted, with "Choose account" where the account goes. A banner counts
  them ("Show only these" = status filter `no_account`). Opening one leaves "Paid from" empty with
  a hint; saving replaces it with an ordinary transaction (`replaceJournalEntry`).
  - Core: `describeTransaction(lines, isMoney, isPlaceholder?)` reads the Uncategorized lines as
    the money side (`needsAccount: true`, `moneyAccountIds: []`); if every line is Uncategorized,
    credits are the money out. `PLACEHOLDER_ACCOUNT_SUBTYPES` = uncategorized income/expense
    (by subtype, so imported accounts mapped there count too).
  - DB: `listTransactions` includes them (`needsAccount` filter, kind filter by the stand-in's
    sign); `countNeedsAccount()`.
  - Pure journal entries (no money account, nothing Uncategorized) still only appear in Journal
    entries.
- **Delete on a journal entry:** a plain Delete button (reverses on the entry's own date, same
  guards as removing a transaction: closed period, reconciled, already changed). "Reverse" on a
  chosen date stays, as a quieter button, for accountants.

- **Receipts inbox: select and delete several:** a tick box on each receipt and "Select all
  (n)" above the grid; a bar at the bottom deletes the ticked ones after a confirm
  (`deleteAttachmentsAction`, 200 per request; the inbox sends bigger selections in batches; files
   attached to a transaction are skipped and counted).

### Simpler like Wave: edit on the list, add categories anywhere

- **Edit straight from the Transactions list** (wide screens, `lg` and up): date, description and
  amount turn into a field when clicked (Enter or leaving the field saves, Escape cancels);
  account and category are dropdowns. Each change saves the row exactly as the dialog would
  (`rowInput()` in `transactions/row-input.ts` builds the full `saveTransactionAction` input), so
  it's a normal edit: a corrected entry replaces the old one, review tick and receipts carry over.
  The row shows the change at once and dims while saving; a failure puts it back with a toast.
  - Amount changes in place only for one-category rows and same-currency transfers; splits open
    the dialog. Picking an account in another currency opens the dialog to ask for a rate.
  - Rows still needing an account only allow choosing the account in place. Reconciled rows and
    rows in a closed period show plain values that open the read-only dialog.
  - Phones and tablets: the row is a compact summary and a tap anywhere opens the dialog (one
    set of cells, placed by the grid; a capture-phase click handler sends narrow-screen taps to
    the dialog). The table layout starts at `lg` (was `md`).
- **Row menu** (… at the end): Edit details (View details when read-only), Journal entry JE-…,
  Make a rule, Remove (asks first, `deleteTransactionAction`).
- **"Add a new category" in every category dropdown** (`components/accounting/category-picker.tsx`):
  the transaction dialog, the list rows and the rule form. Typing a name that doesn't exist offers
  "Add “…” as a new category", which opens a small form on top (type, what it's for, name, optional
  code; `saveAccountAction`). The new category is picked and appears in every dropdown on the page
  (`useCategoryList`) and, after the save, everywhere else.
- **Refunds, like Wave:** for money in (transactions and rules), the expense categories are listed
  under "Return on an expense recorded in Bookalyze" (searchable as "refund" or "return").
  Picking one books the money against that expense, lowering it; no separate account.
- E2E: `openTransaction()` helper opens a row through its menu (clicking a value now edits it);
  new test for adding a category on the spot, editing on the list and removing from the menu.


### Phase 2, slice 4: transfer matching

- **Suggested pairs:** money out of one bank/card/cash account and money into another, within
  `TRANSFER_WINDOW_DAYS` (5), both uncategorized (one money line, every other line on an
  Uncategorized account). Same currency: exact amount. Different currencies: main-currency values
  within 3% (`TRANSFER_FX_TOLERANCE_BP`). Each transaction pairs once, exact and closest first
  (`pairTransfers`, core `accounting/transfer-match.ts`). Found on the fly on page load
  (`suggestTransfers`, db `transfers.ts`, newest 3,000 candidates); nothing stored until someone
  decides.
- **Transactions screen:** a banner ("n possible transfers", "Show only these" = status
  `transfers`), a strip on each side ("Possible transfer to/from X") opening a review dialog:
  Match as transfer, or Not a transfer. Ticking two shows **Match** instead of Merge when
  `transferMatchProblem` allows (one out, one in, different accounts, same amount in one currency).
- **Matching** (`matchTransfer`): reverses both on their own dates and posts one transfer on the
  date the money left (`prepareTransfer`; between currencies each side keeps its amount, the main
  value from the side already in it or the sending side's recorded rate). Bank links, open
  duplicate flags and receipts move to the transfer. `transfer_matches` (migration
  `0022_transfer_matches`) records it: `matched` (with `transfer_entry_id`), `dismissed`, or
  `unmatched`; turned-down pairs aren't suggested again (ids follow edits in `carryEntryLinks`).
- **Unmatch** (button in the transaction dialog): reverses the transfer, reposts both originals
  as they were (same source and import ID, receipts copied back), bank lines go back by sign.
- **Editing a matched transfer** into income or an expense: `replaceJournalEntry` calls
  `followTransferEdit`, which reposts the side the new entry no longer touches (with its bank
  line), so nothing the bank sent goes missing. Removing a matched transfer removes both.
- **Reposting a bank side** (unmatch, or an edit that gives a side back) leaves its bank
  `source_id` on the reversed original: `journal_entries_org_bank_source_key` covers reversed
  entries too, so copying it failed with a duplicate-key error. The bank line links the copy.


### Phase 2, slice 5: rule suggestions

- A payee categorized the same way by hand at least 3 times in the last year (80%+ to one
  category, same direction) is suggested as a rule, unless a rule already covers it or someone
  turned it down. Payee = up to three words in a row from the bank text, minus reference numbers
  and filler ("POS PURCHASE BELL CANADA 0423" → "bell canada"), so it's always found as-is by
  `ruleMatches`. Core `banking/rule-suggestions.ts` (`payeeKey`, `suggestRules`); db
  `suggestedRules` (learns from entries with one money line and one non-Uncategorized category,
  not categorized by a rule; counts what's waiting uncategorized) and `dismissRuleSuggestion`
  (`rule_suggestion_dismissals`, migration `0023_rule_suggestions`).
- Rules page: "Suggested for you" cards ("Make this rule" opens the rule form filled in; X turns
  it down). Transactions shows a "n rules suggested" banner linking there.


### Phase 2, slice 6: Entity & compliance

- **Company → Profile** (`/company`): company details (legal name, trade name, type and year end
  come from the org profile and are changed in Company settings; jurisdiction, incorporation
  date and registered address are edited here, owners and admins only), registration numbers
  (`entity_identifiers`; kinds per country in core `IDENTIFIER_KINDS`, licenses can expire) and
  people (`entity_people`: roles, title, ownership %, start and end dates).
- **Company → Documents** (`/company/documents`): the vault. Files upload like receipts, then
  `entity_documents` holds the name, kind and expiry; the attachment is linked as
  `entity_document`, so it never appears in the receipts inbox. Deleting removes the file.
- **Company → Compliance calendar** (`/company/calendar`): worked out each time by
  `complianceCalendar` (core `entity/compliance.ts`), never stored:
  - Canadian corporations: T2 balance (2 months after year end; hint mentions CCPC's 3), T2
    return (6 months), annual return 60 days after the incorporation anniversary for CA-FED
    (Corporations Canada) and CA-ON (Ontario Business Registry).
  - UAE: corporate tax return 9 months after year end once a corporate tax TRN is added.
  - Sales tax registrations: one return per period (monthly/quarterly by fiscal quarter: 1 month
    after; annual: 3 months after year end; UAE VAT: 28 days after).
  - Licenses and documents with an expiry date; items added by hand (`compliance_items`, once or
    monthly/quarterly/yearly).
  Ticks are stored per occurrence (`compliance_completions`, item key + due date). Overdue items
  (last 90 days) show on top.
- **Reminders:** the daily cron (`/api/cron/fx-rates`) ends with `sendComplianceReminders`
  (`server/compliance.ts`): per company with the module on, one digest email
  (`emails/compliance-reminder.tsx`) to owners and admins for items due in 30, 7, 1 or 0 days,
  each lead time once (`compliance_reminders`); a missed run sends the latest one.
- **Home:** a "Coming up" card (next 60 days, overdue first) and the getting-started steps now
  link to the Wave import and bank accounts.
- Migration `0024_entity_compliance` (also allows `entity_document` in `attachment_links`).


### Phase 3, slice 1: connect Amazon Seller Central

- **Commerce module is live** (Features → Commerce). Sidebar: Commerce → Orders, Channels
  (`/commerce/channels`).
- **Bring your own app:** an admin enters the region (North America / Europe, Middle East and
  India / Far East), the app's LWA client ID and secret, and the seller's refresh token. They're
  checked with Amazon (LWA token exchange, then `GET /sellers/v1/marketplaceParticipations`),
  then sealed as one JSON value in `connections.secret` (`provider = 'amazon_sp'`,
  `settings.region`, `settings.storeName`). One connection per region: connecting again replaces
  its credentials. No AWS signing is needed (SP-API dropped SigV4).
- **Channels** (`sales_channels`, migration `0025_sales_channels`): one per marketplace the account
  is registered in; new ones start switched on where the seller participates. Switching a channel
  off means nothing is synced from it. Disconnecting deletes the credentials and switches channels
  off; their orders stay in the database but are hidden (Orders list, totals, order page) until
  that same seller account is connected again.
- **Same or different seller account:** SP-API gives no seller ID to self-authorized apps, so on
  connect we ask Amazon for the latest order of each of the region's connections
  (`amazonConnectionsForRegion`, web `ownsOrder`: Amazon only answers a seller's own orders). A
  match reuses that connection (its channels and orders come back); otherwise a connection with no
  orders is reused, or a new one is created. Any other connected account in the region is
  disconnected, so there is still one connected account per region. A connection with
  settlements but no orders can't be told apart this way.
- Code: core `commerce/amazon.ts` (regions, marketplace IDs, parser); web `server/amazon.ts`
  (LWA + SP-API calls with plain-language errors, access tokens cached in memory),
  `server/commerce.ts` (context, sealing), `app/o/[slug]/commerce/`.
- Amazon connections are left out of Banking (`listConnections`), and the daily bank sync only
  covers Wise (`syncable_connections()` replaced in 0025).
- Tests: `AMAZON_LWA_URL` / `AMAZON_SPAPI_URL` point at `e2e/amazon-mock.mjs` in e2e. Leave them
  unset in production.


### Bank balances beside the books (Banking → Bank accounts)

- Each synced or uploaded account shows **what the bank says** (Wise's balance, refreshed on every
  sync via `wiseBalances`; or the closing balance of the last uploaded statement that has a
  balance column) and **its balance in Bookalyze**, in the account's own currency. Compared on
  the bank's day: "Matches", or "The bank has X more/less" (reconcile to find it). An account
  with lines still in another currency says how many instead.
- Accounts no bank feeds are listed under "Other accounts" with their Bookalyze balance.
- Statement upload: new optional **Balance column** (guessed from "Balance", "Running balance"…).
  `readStatement` returns `closingBalance`: the latest day's last row in time, whichever way the
  file runs; a card statement's balance is negated like its amounts (debt is negative).
- `bank_feeds.bank_balance` / `bank_balance_on` (migration `0027_bank_balances`), written by
  `recordFeedBalance` (an older figure never replaces a newer one). Balances:
  `moneyAccountBalances` (db `banking.ts`).

### Phase 3, slice 2: Amazon orders

- **Orders screen** (`/commerce/orders`, sidebar Commerce → Orders; `/commerce` opens it): tabs
  All / Open / Shipped / Cancelled, marketplace (when more than one), placed-from/to dates and a
  search over order number, SKU, ASIN and product title. A sales card per currency (cancelled
  left out), 50 orders per page. The Order date column shows how long ago the order was placed,
  the calendar day (`2026-10-06`) and the clock with the time zone (`11:46 a.m. PDT`), in the
  company's time zone. Order page (`/commerce/orders/[id]`): purchase date (`Tue, Oct 6, 2026,
  11:46 a.m. PDT`), items with SKU and ASIN, items / shipping / tax / discounts / total, ship-to
  region, who ships it, Prime / Business / Replacement, and "Open in Seller Central"
  (`sellercentral.<marketplace domain>`).
- **Orders don't post to the books.** Settlements will (one summarized entry per settlement,
  PLAN §3.4); orders are for operations and analytics. **No buyer PII:** only ship-to country
  and region are kept (sales tax needs them); no Restricted Data Tokens.
- **First time:** an admin picks "Bring in orders placed from" (defaults to the start of the
  financial year, at most two years back) for every switched-on marketplace
  (`startOrdersAction` → `startOrderSync`). An earlier date later re-reads from there.
  Marketplaces switched on afterwards get a "Bring theirs in too" prompt.
- **Sync** (`server/amazon-orders.ts`, `syncChannelOrders`), per channel within a time budget:
  1. Orders changed since the last sync less an hour (`orderSyncWindow`, core
     `commerce/orders.ts`; `LastUpdatedBefore` is now − 3 min as Amazon requires),
     `GET /orders/v0/orders` 100 per page. The page token and window end are kept on the
     channel (`orders_next_token`, `orders_window_end`), so a big first sync carries on across
     runs; an expired token restarts the window. A channel synced in the last 10 minutes isn't
     asked again.
  2. Items (`GET /orders/v0/orders/{id}/orderItems`) for orders without them, except Pending /
     PendingAvailability (not priced yet). A newer copy of an order with another status or
     total clears `items_synced_at`, so items are fetched again. An older copy never overwrites
     a newer one (`upsertOrders`, `setWhere` on `last_updated_at`).
  - Amazon's 429 is `AmazonError` code `throttled`: the sync waits (5 s orders, 2.1 s items)
    while the budget lasts, then stops with `more: true`.
- **Runs:** "Bring in new orders" (`syncOrdersAction`, any member, 20 s per call; the button
  calls again while `more`, up to 30 rounds, refreshing the list) and the order job
  `/api/cron/orders`, every 5 minutes, every day (`syncAllOrders`, 240 s so a run ends before
  the next; passes of at most 60 s per channel, then leftover time to channels still with more;
  over `syncable_sales_channels()`; route `maxDuration = 300`). Amazon allows about one order's
  items every 2 s, so a first sync of thousands of orders takes a few hours, on its own. Orders
  aren't listed again within 10 minutes of the last listing (`FRESH_MS`); items carry on.
- **Schema** (migration `0026_amazon_orders`): `orders` (unique per channel + order number;
  Amazon's own status text, mapped to words by `orderStatusLabel`), `order_items` (prices for
  the whole quantity), four `orders_*` columns on `sales_channels`, and the security-definer
  `syncable_sales_channels()` for the order job.
- Reconnecting a disconnected Amazon account puts the marketplaces back as Amazon reports them
  (disconnect had switched them all off). Orders of disconnected connections aren't listed
  (`connectedOrder` in db `commerce.ts`).
- Tests: core `amazon-orders.test.ts`, db `commerce.test.ts`, e2e "bring in Amazon orders" (the
  mock answers four orders in two pages, with items).
- **Sales cards per marketplace:** one card per marketplace (and currency). With more than one
  marketplace, a card filters the list to it (`?channel=`); clicking the active card clears it.
  The filter form is keyed by the filters in the URL, so its fields (the marketplace `Combobox`,
  which applies on choice, dates, search) always show what's applied. "Clear filters" keeps the
  status tab.

### Phase 3, slice 3: Amazon review requests

- **Review requests module is live** (Features → Review requests, needs Commerce). Sidebar:
  Review requests → Requests (`/reviews`), Automatic requests (`/reviews/automatic`).
- **Amazon's own "Request a Review" only** (Solicitations API): one standard message per order,
  in the buyer's language, from 5 days after the earliest delivery date to 30 days after the
  latest (core `reviewWindow`; the last day is kept free). Custom emails aren't possible (see
  PLAN §3.5). Amazon's GET of the order's actions is the source of truth; its 403 on the POST
  means the order was already asked (in Seller Central, say).
- **Amazon app roles:** Buyer Solicitation (requests) and Finance and Accounting (refund check).
  A missing role is a 403 with a plain message naming it (`roleMissing`, `server/amazon.ts`); the
  run stops for that company. Amazon's role changes need the app authorized again (new
  refresh token in Commerce → Channels).
- **Requests page:** cards (ready to ask now, scheduled, requested lately), tabs To ask /
  Scheduled / Requested / Left out with counts, marketplace chips, 50 per page. "Ask now" and
  "Don't ask" (with Undo) per order; select several to ask or leave out together; "Ask all N
  ready" asks every order whose window is open, 30 per call. "Put back" returns a left-out
  order to To ask. The order page has a "Review request" box with its status and "Ask for a
  review now". Owners and admins send and change settings; members see the lists.
- **Automatic requests** (`review_settings`, one row per company; core `ReviewSettings`): on/off,
  5–25 days after the latest delivery date, an hour in the company's timezone, weekdays, which
  marketplaces, shipped by any / Amazon / you, skip refunded (Finances API
  `GET /finances/v0/orders/{id}/financialEvents`: refunds, A-to-z claims, chargebacks; core
  `refundReason`), replacements, business orders, orders with a promotion, excluded SKUs, and a
  start (`starts_from`: delivered from a day on, or every order still in the window). Saving
  clears the automation's scheduled and auto-skipped rows and plans again straight away
  (`planOrgReviewRequests`, nothing is sent from the form).
- **Planner** (`server/reviews.ts`, `planReviews`): shipped orders with a delivery date, no
  request yet and an open window (`reviewCandidates`) get `reviewHold` (a reason → skipped) or
  `reviewSendDay` (the delay, no earlier than the window, moved to an allowed weekday) at
  `zonedInstant(day, hour, timezone)`. Orders need their items in when SKUs or promotions are
  filtered on.
- **Sender** (`reviewSender`): paces Amazon calls 1.1 s apart, waits out 429s while the budget
  lasts, then refund check → GET actions → POST. Not offered yet: tried again a day later, up to
  5 tries; errors retry an hour later. One request row per order (`review_requests`, unique
  `order_id`); a sent row is never overwritten (`recordReviewOutcome`).
- **Runs:** the hourly job `/api/cron/review-requests` ("5 * * * *" in `apps/web/vercel.json`,
  `CRON_SECRET`, 240 s, at most 60 s per company, over the security-definer
  `review_request_orgs()`), and the buttons (`askReviewsAction`, 45 s per call; the client calls
  again while `more`, up to 20 rounds). Orders still come in daily, so new deliveries are
  planned within a day.
- **Schema** (migration `0028_review_requests`): `orders.earliest_delivery` (Amazon's
  `EarliestDeliveryDate`), `review_settings`, `review_requests` (status scheduled / sent /
  skipped / not_eligible / failed; source auto / manual / bulk; due and sent times, reason,
  attempts) and `review_request_orgs()`.
- Tests: core `reviews.test.ts` (window, holds, send day, timezones, Amazon's answers), db
  `reviews.test.ts`, e2e "reviews: ask for a review by hand, then turn on automatic requests"
  (the mock offers one request per shipped order, then answers 403).

### Phase 4, slice 1: Amazon settlements (brought in, not posted)

- **Settlements screen** (`/commerce/settlements`, sidebar Commerce → Settlements; feature
  `commerce.settlements`): each payout's period, marketplace, deposit date and amount (negative:
  "No payout", the balance is carried or charged). The settlement page groups the amounts
  (core `settlementGroup`: sales, refunds, promotions, Amazon fees, advertising, tax Amazon
  collects and pays, reimbursements, held back and released, other) with plain names
  (`settlementLineLabel`: "Referral fee" for `Commission`…) and subtotals. Nothing posts yet.
- **How payouts work:** each settlement's total is what Amazon deposits (into RBC for
  Amazon.ca), 1–5 business days after the period. The report's own deposit date and total make
  the later bank match exact. Reserves are inside the total (their own lines).
- **From Amazon** (`server/amazon-settlements.ts`): the Reports API
  (`GET /reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`,
  then `/documents/{id}` → a signed link, gzipped). Amazon makes these on its own and lists the
  last ~90 days, so the first look goes back 89 days, later ones from the last look less 3 days
  (`connections.settlements_synced_at`; a connection looked at in the last 6 hours isn't asked
  again by the daily job). Reports already in (by report ID) aren't downloaded again. Amazon
  rations both calls hard (a listing about once a minute): throttled → wait 5 s while the
  budget lasts, else `more: true`. Needs the Finance and Accounting role.
- **Runs:** "Bring in settlements" (`syncSettlementsAction`, 40 s per call, up to 6 calls) and
  the daily job (`/api/cron/fx-rates` → `syncAllSettlements`, 90 s, at most 60 s per connection,
  over `syncable_amazon_connections()`).
- **Older periods by upload:** "Upload settlement files" (admins) takes Seller Central →
  Payments → All statements → "Flat File V2". The file is read in the browser
  (`parseSettlementReport`); only the summed settlement goes to `uploadSettlementAction` (zod).
- **Parser** (core `commerce/settlements.ts`): columns by header name; amounts in `1,234.56`,
  `1.234,56` or `12,30`; dates `2026-09-01 07:08:16 UTC`, ISO, or `01.09.2026 …` (EU / AE).
  Rows are summed by transaction type + amount type + description; `balanced` says the lines
  add up to the total (shown as "Check" when not). Built without Amazon's docs at hand (the
  SP-API knowledge connector was down): check it against a real Kazomo file.
- **Schema** (migration `0032_settlements`): `settlements` (unique per company + Amazon's
  settlement ID: the same settlement again replaces its lines; channel matched by marketplace
  name, else the only channel in its currency), `settlement_lines` (summed),
  `connections.settlements_synced_at`, and `syncable_amazon_connections()`.
- Tests: core `amazon-settlements.test.ts`, db `settlements.test.ts`, e2e "settlements: bring in
  Amazon's settlement report…" (the mock serves one gzipped report; a second is uploaded).

### Phase 4, slice 2: settlements post to the books

- **How settlements post** (`/commerce/settlements/accounts`, admins): an account for each group
  (core `SETTLEMENT_ACCOUNT_KEYS`: sales, refunds, promotions, fees, advertising, sales tax,
  reimbursements, held back and released, other) plus the **clearing account** (an asset,
  ideally Money in transit) the payout goes to, and "Post settlements from" (default: the start
  of the financial year). The first time, accounts are suggested from names and types (only a
  suggestion: posting reads the saved choices, `settlement_accounts`). Saved with
  `saveSettlementSetupAction` → `saveSettlementSetup`.
- **One entry per settlement** (core `buildSettlementEntry`, db `postSettlement`): each group's
  subtotal to its account (money to the seller credits it), the payout debited to clearing, lines
  for the same account combined; it refuses when the lines don't add up or an account is
  missing. Dated the period's last day (company time), reference = Amazon's settlement ID, memo
  "Amazon.ca settlement … · Jun 5 – Jul 17, 2026", `source: "settlement"`, `source_id` = the
  settlement. Another currency posts at that day's rate (slice 4). `settlements.journal_entry_id` links them; a settlement counts as posted while that
  entry isn't reversed. Main currency only for now (a USD settlement says so).
- **Buyer-paid tax isn't income:** `Tax`, `ShippingTax`, `GiftWrapTax` under ItemPrice are in
  the "Sales tax" group with Amazon's withheld (marketplace facilitator) tax, so they cancel out
  when Amazon pays it. Map the group to the sales tax liability account.
- **Screens:** the settlement page shows the entry (debit / credit per account) with "Post to
  books", or "Posted as JE-…" with "Take out of books" (`unpostSettlement`: reverses on the same
  day). The list shows In books / Ready to post / Before posting starts, and "Post N ready"
  (`settlementsToPost`: balanced, not posted, period ends on or after the start date; 50 per
  click, each in its own transaction). Posting needs an owner or admin.
- **The bank deposit** is matched to the clearing account in slice 3 (below).
- Schema (migration `0033_settlement_posting`): `settlement_accounts`, `settlement_settings`,
  `settlements.journal_entry_id`, journal source `settlement`. Tests: core
  `amazon-settlements.test.ts` (`buildSettlementEntry`), db `settlements.test.ts` (post once,
  take out, post again), e2e settlements test (choose accounts, post, take out).

### Phase 4, slice 3: matching each payout to its bank deposit

- **Why:** a posted settlement already counts its sales (and fees), with the payout in the
  clearing account. Its bank deposit, often categorized Amazon Sales (the Wave way), would count
  them again. Matching moves the deposit to the clearing account: clearing returns to zero and
  the sales are counted once.
- **Possible deposits** (db `settlementDepositCandidates`): current entries with exactly one
  money line (bank, card, cash, not the clearing account) of exactly the payout, in its
  currency, dated within core `settlementDepositWindow` (Amazon's deposit date −3 to +10 days, or
  the period's end to +10), not on the clearing account already, not a settlement entry, not
  turned down for this settlement. In any bank account (Amazon.ca may pay into RBC or Wise).
  Closest date first.
- **Matching** (`matchSettlementDeposit`, posted settlements only): `replaceJournalEntry` with the
  money line kept and one line to clearing for everything else, so bank links, receipts and the
  reviewed tick follow. `settlements.deposit_entry_id` (now) and `deposit_original_entry_id`
  (before) keep the link; it counts while that entry isn't reversed (editing the deposit undoes
  the match). **Unmatch** (`unmatchSettlementDeposit`) reposts the original lines and turns the
  deposit down for the settlement; **Not this one** (`dismissSettlementDeposit`,
  `settlement_deposit_dismissals`). Taking a settlement out of the books waits until its deposit
  is unmatched.
- **Screens:** the settlement page's "Bank deposit" card: the match (date, bank account, entry)
  with Unmatch; else each possible deposit with where it's categorized now ("Now in Amazon
  Sales. Matching moves it to Amazon Clearing…"), Match and Not this one; else "No deposit of
  $X found between …". The list shows "In books · match deposit" / "In books · deposit
  matched", and "Match N deposits" (`settlementsWithOneDeposit`: posted settlements with exactly
  one possible deposit; a dialog says how many already have a category; 50 per click).
- Migration `0034_settlement_deposits`. Tests: core `amazon-settlements.test.ts`
  (`settlementDepositWindow`), db `settlements.test.ts` (found, matched, unpost refused,
  unmatched back to Sales, turned down), e2e settlements test (deposit added as Sales, matched,
  unmatched).

### Phase 4, slice 4: settlements in any currency, deposits in any currency, automatic posting

- **Posting another currency** (e.g. AED in a CAD company): the entry is in the settlement's
  currency at that day's rate (`fxRateOn`, Bank of Canada, the dirham via its USD peg; fetched
  first by `suggestRate` if missing), each line valued and rounded on its own, the cent left to
  the largest non-clearing line (core `convertSettlementEntry`). The clearing line is in the
  settlement's currency, or in the main currency when the clearing account holds only that
  (`clearingLineCurrency`); a clearing account in a third currency is refused. No rate yet: it
  says so and waits. `settlements.posted_fx_rate` and `payout_base_amount` (the payout's
  main-currency value) are kept; the page shows "valued at 1 AED = … CAD".
- **Deposits in any account and currency** (`settlementDepositCandidates` → core `depositFit`):
  the same currency must be the exact amount; another currency (an AED payout into a CAD
  account) is offered when within 10% (`SETTLEMENT_FX_TOLERANCE_BP`) of the market rate on
  Amazon's deposit date, showing the bank's rate, how far it is from the market and the exchange
  difference, with "Match at this rate". Converted ones are never matched in bulk or by the job.
- **Matching** (core `depositMatchLines`): the money line as it is, the payout out of clearing
  at `payout_base_amount`, and any main-currency difference to Loss/Gain on foreign exchange
  (`fx_loss` / `fx_gain`), so clearing returns to zero in both currencies. Same-currency,
  same-rate deposits are unchanged (two lines).
- **Automatic posting** ("Post new settlements automatically" on How settlements post,
  `settlement_settings.auto_post`): the daily job (`/api/cron/fx-rates` → `autoPostSettlements`,
  `server/settlement-posting.ts`) posts what's ready from the start date, then matches deposits
  with exactly one exact fit that are uncategorized or only in the sales account; anything else
  waits on the list. Audit entries have no user and `automatic: true`.
- Migration `0035_settlement_currencies`. Tests: core `amazon-settlements.test.ts`
  (`convertSettlementEntry`, `depositFit`, `depositMatchLines`), db `settlements.test.ts` (AED
  settlement in a CAD company, CAD deposit matched with the exchange loss).

### Phase 4, slice 5: profit by channel

- **Commerce → Channel profit** (`/commerce/profit`, feature `commerce.settlements`): for a
  period (the reports' presets and dates, `resolveRange` + `RangeControls`), one column per
  marketplace in its own currency and, when there's more than one or another currency, "All
  channels" in the main currency. Rows: sales, refunds, promotions → net sales; Amazon fees,
  advertising, reimbursements, other → net from the channel, margin (net over net sales); then
  sales tax and amounts held back (not profit) → paid out.
- From settlements, not the books (so it works before posting): core `addSettlementLines` sums
  lines by `settlementGroup`, `channelProfit` makes the totals. A settlement counts in the
  period its last day falls in (company time zone; db `settlementsForProfit`, shown settlements
  only). The main-currency total uses the rate a settlement posted at, else that day's rate
  (`suggestRate`); without one it's left out and the page says so. Before product costs
  (phase 5).
- Tests: core `amazon-settlements.test.ts` (`channelProfit`), db `settlements.test.ts`
  (`settlementsForProfit`), e2e settlements test (the page shows Amazon.ca's column).

### Order badges: refunded, A-to-z claim, chargeback, replaced

- **Header badges on the order page**, and the same on the Orders list: Refunded / Partly
  refunded and A-to-z claim / Chargeback (red), Replaced / Replacement (amber). A strip under the
  header links a replacement and its original both ways (`getOrder` → `replaces`, `replacedBy`).
- **Why the refund showed only in the review card:** the review sender read the order's own
  financial events (`GET /finances/v0/orders/{id}/financialEvents`) but didn't keep them. Now
  `reviewSender.finance` saves the refunds (`saveRefunds`) and any claim (`orders.buyer_claim`,
  core `buyerClaim`) with `saveOrderFinance`, stamping `orders.finance_checked_at`. The order
  page's check (`checkOrderEligibility`) also reads them when they're over 6 hours old.
- **Refunds sync before items** in `syncChannelOrders` (step 2 of 3): a backlog of item details
  could use each run's whole budget and keep refunds from ever being read.
- **Replacements:** `ReplacedOrderId` is kept as `orders.replaced_order_id` (core
  `AmazonOrder.replacedOrderId`). Replacements already in get the link when Amazon updates them,
  or when orders are re-read from an earlier start date (`upsertOrders` also takes the same copy
  when it brings the replaced order's number for the first time).
- Returns without a refund aren't in the APIs used here (only in FBA returns reports).
- Migration `0031_order_claims_replacements`. Tests: core `amazon-orders.test.ts`
  (`ReplacedOrderId`), `reviews.test.ts` (`buyerClaim`), db `commerce.test.ts` (links both ways,
  claim kept).

### Review eligibility for FBA orders (and Amazon's answer on every order)

- **Why:** Amazon's Orders API gives `EarliestDeliveryDate` / `LatestDeliveryDate` only for
  orders the seller ships. FBA orders (most of the AE ones) had no window, so the order page
  never offered "Ask", the planner never scheduled them and "To ask" left them out.
- **Estimated window** (core `deliveryDates`, `ESTIMATED_DELIVERY_FROM_DAYS` /
  `ESTIMATED_DELIVERY_TO_DAYS`): without Amazon's dates, delivery is taken as 1 to 7 days after
  the purchase day (UTC), so the window is purchase + 6 to purchase + 37 days and the automatic
  send day is purchase + 7 + the chosen delay. `reviewWindow` says `estimated`. The SQL in db
  `reviews.ts` (`earliestDelivery` / `latestDelivery` / `opens` / `closes`) mirrors it, so no
  re-sync is needed for orders already in.
- **Amazon decides eligibility, and the answer is kept** on the order (`orders.review_eligible`,
  `review_checked_at`, migration `0030_review_eligibility`): every `canRequestReview` call goes
  through `reviewSender.eligible`, which saves it. Asked by:
  - the order page: when the answer is over an hour old it checks on its own
    (`EligibilityCheck` → `checkReviewEligibilityAction` → `checkOrderEligibility`), plus a
    "Check with Amazon" button;
  - the hourly job: after automatic requests, `checkEligibility` asks about shipped orders in
    the (estimated) window, not asked or left out, not checked for 12 hours, never-checked
    first (`ordersToCheckEligibility`). `review_request_orgs()` now also lists every company
    with a marketplace bringing orders in; the job checks the plan (`reviews.manual`).
- **Ready** (`readyToday`): Amazon said yes, or never asked and the window has opened. Amazon
  saying "not yet" takes the order out of "Ask all" until a later check says yes; "yes" makes it
  askable even before the estimated window (a quick delivery).
- **By hand, "not yet" is no longer final:** a manual or bulk ask Amazon doesn't take records
  nothing (status `later`, with the reason), so it can be asked again in a few days. An
  estimated window doesn't block a manual ask; Amazon's answer does.
- **Refunds:** an order the orders sync found refunded (`orders.refunded`) is skipped without a
  Finances call; claims and chargebacks are still checked per order.
- **Shown:** order page card ("Ready to ask" / "Not yet" with when it was checked, the estimate
  note for FBA, "Ask for a review now"); Reviews rows (same badges, "about" before estimated
  dates); Orders list ("Ready for review" / "Review requested").
- Tests: core `reviews.test.ts` (FBA estimate), db `reviews.test.ts` (FBA window, Amazon's
  answer, what's checked), e2e reviews test (the mock's FBA coaster order has no delivery dates;
  its page checks with Amazon, then asks; the partly refunded mug is skipped).

### Refunds on orders

- **Red badge:** "Refunded" (everything the buyer paid came back) or "Partly refunded" next to
  the status, on the Orders list and the order page (`refundState`, core
  `commerce/refunds.ts`; badge variant `destructive`). A **Refunded** tab lists them, the
  sales card shows the refunded total, and the order page lists each refund (date, SKU, units,
  amount) under the order total.
- **Where refunds come from:** the Orders API doesn't say; the Finances API does
  (`GET /finances/v0/financialEvents`, `RefundEventList`). The app needs the **Finance and
  Accounting** role; without it the sync says so (orders still come in).
- **Sync step 3** (`syncChannelOrders`, after orders are all in, since a refund is kept only
  against an order already here): events posted since the last sync less two days (Amazon
  posts some late), from the orders' start date the first time, at most 179 days per window
  (`refundSyncWindow`; Amazon allows 180), `PostedBefore` now − 3 min. Cursor on the channel
  (`refunds_synced_through`, `refunds_next_token`, `refunds_window_end`); an earlier start date
  resets it with the orders cursor. Throttled → waits 2.1 s.
- **Amount refunded** = −(item charge adjustments + promotion adjustments): price, shipping,
  tax and gift wrap given back, less promotions clawed back and restocking fees. Amazon's own
  fee refunds to the seller aren't counted. Compared with the order total for full or partial.
- **Schema** (migration `0029_order_refunds`): `order_refunds` (one row per refunded item,
  unique per order + Amazon's `OrderAdjustmentItemId`, so re-reading changes nothing) and
  `orders.refunded` / `orders.last_refund_at`, recomputed by `saveRefunds`.
- Financial events are per seller account, not per marketplace, so each channel of one
  account reads them (a little duplicate work; refunds of other channels' orders are ignored).
  Settlements (phase 4) will read the same API.
- Tests: core `amazon-refunds.test.ts`, db `commerce.test.ts` (refunds saved once), e2e "bring
  in Amazon orders" (mock refunds one of two mugs: "Partly refunded").

### Fix: foreign-currency amounts recorded in the main currency ("Correct from Wise")

- **Why:** Wave's accounting export has only main-currency (CAD) values, so a US$123 Wise
  payment came in as 173.62. Imported while the account held CAD, then the account was switched
  to USD (amounts are never converted on a switch), so it showed US$173.62. CAD reports were
  right all along (the line's base amount is Wave's CAD value); the account's own currency wasn't.
- **Found by:** `misrecordedAccounts` / `misrecordedLines` (db `amount-fix.ts`): current lines on
  an account with a currency whose line currency differs. Bank accounts shows a banner per
  account; the account dialog's currency hint now says to correct them there.
- **Correct from Wise** (admins, accounts a Wise balance fills): `previewAmountFix`
  (`server/amount-fix.ts`) reads the balance's statement over those dates (nothing posted) and
  core `matchStatementAmounts` (`banking/amount-fix.ts`) matches each line: same direction,
  within 4 days, within 3% of the CAD value at that day's Bank of Canada rate (the rate only
  judges the fit; Wise's amount is used); obvious ones first, descriptions break ties, real
  look-alikes are left for a person. The dialog shows counts (matched / need a choice / not in
  Wise), a choice per unclear one, amounts to type (or BoC estimates) for missing ones.
- **Apply** (`applyAmountCorrections`, 100 per request): each entry is replaced like an edit
  with the line in the account's currency and the **same base amount**, so CAD reports don't
  move; the Wise transaction is recorded in `bank_lines` so a later sync recognises it. Closed
  periods, reconciled lines and entries with a second misrecorded account are skipped with the
  reason. No migration.
- **Whole transaction in USD:** when the rest of the entry is categories in the old currency (the
  usual case), they move to the account's currency too, at the rate the fixed line implies
  (`restateAmounts`, core; rounding on the largest line), and the entry's currency and rate
  become USD and |base| ÷ |USD|. Otherwise (e.g. a transfer to a CAD account) the other lines
  keep their currency.
- **Entries corrected before that** (bank line USD, categories still CAD) read in USD anyway:
  `describeTransaction` restates the categories at the money line's own rate, and
  `listTransactions` reports the row in the money account's currency with that implied rate, so
  the edit form shows US$200 (not the CA$283.27 it's worth) and saving keeps the CAD value.
- **Correct from statements** (accounts no Wise balance fills, e.g. a bank's USD account): the
  person adds the bank's PDF statements; they're read **in the browser** (`unpdf`, i.e. pdf.js,
  in `lib/pdf-statement.ts`; the file isn't uploaded) and core `readPdfStatement`
  (`banking/pdf-statement.ts`) rebuilds the rows from positioned text: a header row names the
  columns (date, description, money out / in or one amount, balance), amounts belong to the
  column whose right edge they line up with (±40 pt), descriptions can span lines, dates carry
  down and get their year from the statement period, bold text drawn twice is de-duplicated,
  pages repeat their header. The **running balance** checks the reading (opening + rows = every
  printed balance and the closing balance): "Balances check out", or "Check the matches". The
  rows go to `previewAmountFixAction(slug, accountId, statement)` and the same matching and
  apply as Wise (no bank line is recorded, as there's no feed).
- Not covered: Cash in Hand USD and the 7 rows the import skipped for it (no statement exists:
  type the amounts on the same screen), and scanned (image) PDFs.

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

### Phase 3: review requests, remaining
- [x] Manual, bulk and automatic review requests. Done in slice 3.
- [x] FBA orders (no delivery dates): estimated window, and Amazon's eligibility answer kept on
  each order and shown on the Orders list, the Reviews page and the order page.
- [ ] Amazon's real delivery dates for FBA orders would sharpen the estimate (only in reports,
  e.g. the FBA "Amazon Fulfilled Shipments" report). Worth it if "not yet" answers pile up.
- [ ] Add the Buyer Solicitation and Finance and Accounting roles to Kazomo's Amazon app,
  authorize it again, paste the new refresh token, and turn automatic requests on.
- [ ] Custom review emails: not possible with the official API today (PLAN §3.5). Revisit if
  Amazon opens a route that doesn't need buyer data.

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

- **Changing an account's currency** (migration `0019_account_currency_change`): allowed at any
  time, and no amount changes. Lines already written keep the currency they were written in;
  only new lines must be in the account's new currency (`assert_line_currency_matches_account`).
  Reversals are exempt, so an old transaction can still be edited or removed: it's undone in
  its original currency. Base amounts never change, so CAD reports stay the same.

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

- **Amazon's 4xx answers carry the reason.** SP-API errors come as
  `{"errors":[{"code","message","details"}]}`; `send()` in `server/amazon.ts` keeps that line
  (`amazonErrorDetail` in core), and the order sync adds the marketplace and step ("Amazon.ae,
  refunds: …"). A bare "error (400)" told nobody what to fix.
- **Settlements of a disconnected account or a switched-off marketplace are hidden** (like its
  orders), with a "n settlements … aren't shown" note on the list; ones in the books always show,
  so no entry is left without its settlement. They aren't offered for posting either.
- **Negative settlements** (fees above sales, e.g. a quiet month with the $29.99 plan fee): no
  payout. Posted, they leave clearing negative (what's owed to Amazon) until Amazon charges the
  card on file (that card charge belongs in clearing, by hand for now) or carries the balance into
  the next settlement. Nothing to match, so the list just says "In books".
- **Amazon keeps financial events 730 days.** A refunds query starting earlier is a 400 ("not
  valid, given the retention period: 730"), so `refundSyncWindow` starts at most 729 days back,
  whatever the orders' start date.

- **pnpm only: no `package-lock.json`.** With an npm lockfile at the root, Vercel installs with
  `npm install` (only the root's few dev packages) and the build uses stale cached modules, so a
  newly added dependency is "Module not found" (this broke production builds once). It's in
  `.gitignore`; use `pnpm add`.
- **Dialog triggers made on the server** (`trigger={<Button>…</Button>}` from a page into a
  client dialog) arrive as lazy references, and Radix `asChild` threw "Primitive.button failed to
  slot onto its children". `DialogTrigger` in `components/ui/dialog.tsx` unwraps them first (and
  falls back to a `display: contents` wrapper). Use it rather than `DialogPrimitive.Trigger`.
- **Drizzle wraps Postgres errors.** The real message and code are on `error.cause` (see
  `pgError()` in the accounting actions).
- **Never run `pkill -f <pattern>`** in an agent shell; it can kill the shell itself. Find
  servers with `ps aux | grep next-server` and kill them by PID. `lsof -i:3000` can miss them.
- **A stale `next start` on port 3000** makes Playwright reuse it (`reuseExistingServer`) and
  serve an old build. Symptoms: "This page couldn't load", `ChunkLoadError` or missing chunks.
  Kill it before running e2e.
- **TypeScript is pinned to 6.0.3.** TS 7 native breaks the toolchain here.
- **Better Auth rate limiting** can trip in e2e. The tests wait where needed.
- **Clicks right after `page.reload()`** can land before the page hydrates and do nothing on CI
  (the Transactions list is heavy). Retry the click until the URL changes:
  `expect(async () => { await link.click(); await expect(page).toHaveURL(…, { timeout: 2_000 }); }).toPass()`.
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
- **Local e2e and migrations follow `.env`**, which may point at the live database. Shell
  variables win over `.env`, so export `DATABASE_URL`, `DATABASE_URL_MIGRATOR` and
  `DATABASE_URL_UNPOOLED` for the local Docker database (as in CI) before `pnpm db:setup`,
  `pnpm build` or `pnpm e2e`. To migrate the test database, also set `DATABASE_URL` to its app
  role, so `migrate.ts` grants it `app_runtime`.

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

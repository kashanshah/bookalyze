# Growth plan: the public site, pricing, billing, and help & support

_Written 2026-10-21 to hand this work to a cloud session. Branch: `claude/site-contact-guides`._
Read [`CLAUDE.md`](../CLAUDE.md) and [`docs/STATUS.md`](STATUS.md) first; this file adds the plan
for four workstreams the owner asked for on 2026-10-21. Tick items as they land, and move what's
done into STATUS.md (§2) in the same PR, as usual.

| # | Workstream | Where | State |
|---|---|---|---|
| A | Public site: positioning, Walmart, marketplace and country pages, Contact, Guides (knowledge base), Help centre | `apps/marketing` | **Done in code** (PR #167): every page and all 60 guides; the contact form waits on the owner's Resend key |
| B | Pricing: packages of linked modules plus add-ons, monthly, on the site | `apps/marketing` (pricing page) | **Done in code** (PR #167): packages, add-ons, monthly/yearly, "Free during early access" |
| C | Billing in the app: subscriptions per company, per module | `apps/web`, `packages/core`, `packages/db` | **Done in code, test mode**: [PR #170](https://github.com/kashanshah/bookalyze/pull/170) (packages and add-ons, Stripe Checkout and portal, read-only modules); waits on the owner's Stripe set-up |
| D | Help & support: support tickets in the app, email replies, the site's contact form feeding them | `apps/web`, `packages/db`, `apps/marketing` | **Done in code**: [PR #169](https://github.com/kashanshah/bookalyze/pull/169) (tickets, desk, email replies, intake); the site's form calls the intake from this PR |

A and B are one PR (or two: site pages, then guides). C and D are separate PRs, and can run in
parallel with A (they don't touch the same files, except D's last step, which wires the site's
contact form). **C and D both add migrations: whichever merges second renumbers its migration**
(see STATUS §6 on migration numbering).

---

## 1. What the owner asked for (2026-10-21, in their words, condensed)

1. Work on the site. Walmart is a new channel: add it. Add more pages. A **Contact us** page with
   a working **contact form** on Resend ("share the Resend API keys" with the site).
2. A **knowledge base**: extensive guides on how it works, all the use cases, test cases,
   reports and views.
3. **Positioning:** portray Bookalyze as the **must-have e-commerce accounting platform,
   especially for Amazon, Walmart and Noon**. **Target the countries where these platforms are**.
4. **The message:** a lot of sellers don't realise they're **losing money** until they see the
   numbers (the snapshots: Channel profit, cost of goods, fees, refunds, ads). These are real pains
   in e-commerce and Bookalyze answers them.
5. **Showcase and highlight:** the **Wise sync** integration; **review requests** ("that's a hit
   for sure"); **invoicing and buyer invoicing: generate and send an invoice in seconds**.
6. **Monetization:** module-based **monthly pricing**, moderate, **lower than competitors**.
7. **Help and support**, with **support ticketing**.
8. Put the plan in a readme so the chat can move to the cloud (this file).

## 2. Decisions

### Positioning and message
- **Headline idea:** "Accounting built for Amazon, Walmart and Noon sellers." eBay stays (fully
  supported) but isn't in headlines. Order everywhere: **Amazon, Walmart, Noon, eBay**.
- **Lead with the pain** (home page's first sections), with no invented statistics:
  - "Many sellers find out they were losing money only when they see every fee, refund, ad and
    unit cost against each sale." Then the snapshot that shows it: Channel profit (net from the
    marketplace → cost of goods sold → your own costs → profit and margin, per channel).
  - A **pains → answers** block (each pain one line, the answer one line, linking to a guide):
    | Pain sellers have | What Bookalyze does |
    |---|---|
    | The payout isn't the sales: fees, refunds, ads, reserves and tax are netted out | Each settlement / month posted as one entry split into sales, fees, refunds, ads, tax, held back |
    | Deposits counted as income on top of the sales (double counting) | Each payout matched to its bank deposit, moved to the clearing account |
    | No idea what a unit really cost after freight and duties | Landed cost on each delivery, FIFO stock lots, cost of goods sold monthly |
    | Profitable-looking channel that loses money after ads and storage | Channel profit per marketplace, with your own costs counted against it |
    | FBA/FBN/WFS stock that doesn't match the books; lost units never claimed | Stock movements from the marketplaces' ledgers, returns back in, losses written off, stock compared |
    | Several marketplaces, currencies and companies in spreadsheets | Every company, currency and marketplace in one login |
    | Running out of stock (or ordering too much) | Reorder: run-out day, order-by day, how many |
    | Buyers asking for VAT invoices | Bilingual tax invoice from the order in seconds, sent through Amazon |
    | Too few reviews | Amazon's Request a Review, automatic, at the right time |
    | Bank feeds typed by hand | Wise syncs daily; any bank by statement; rules categorise the routine |
- **Highlights get their own home sections and guides:** Wise sync, review requests, buyer
  invoices ("create and send in seconds": Create invoice on the order → Send to Amazon; invoice
  requests collected by a forwarding address).
- **Honesty rules** (keep them): no numbers we can't back, no "most of our sellers", no ZATCA /
  ETA e-invoicing claims, no state sales-tax filing claims, no Spanish UI, SAR and EGP have no
  automatic daily rates (Bank of Canada's list has MXN but not SAR or EGP), Noon VAT in fees posts
  as a cost (input VAT split is not built), WFS ledger (returns/losses) not built, eBay EU/UK
  finances need the upload until digital signatures land, Walmart report upload not built.

### Countries (pages at `/sellers/<slug>`)
Where Amazon meets **Walmart**: `united-states`, `canada`, `mexico`. Where Amazon meets **Noon**:
`uae`, `saudi-arabia`, `egypt`. Data and copy: `apps/marketing/src/content/countries.ts`
(**written**). Each claim there was checked against the code on 2026-10-21 (Amazon marketplaces
incl. Amazon.com.mx/.sa/.eg exist in `packages/core/src/commerce/amazon.ts`; tax packs are
`ca-gst-hst` and `ae-vat`; VAT thresholds exist for AE, SA and CA; compliance calendar covers
Canadian corporations and the UAE).

### Pricing (workstream B; billing in C uses the same table)
Competitors for the same jobs (searched 2026-10-21; sources disagree, so figures are rough):
QuickBooks Simple Start ~$38/mo; A2X from $29/mo (Amazon) and $79 (Walmart), rising with order
volume; Link My Books from ~$21/mo, by volume; Sellerboard $19–$39/mo; FeedbackWhiz ~$20/mo,
Jungle Scout ~$49/mo. The stack Bookalyze replaces is about **$105+/month**.

The owner's steer (2026-10-21): the separate-tools stack (~$105) is a lot, especially for the
Middle East; offer **packages of linked modules**, plus **small modular add-ons**; and **turning
one module off must never affect the modules still on**.

**Packages (USD per company per month; no order-volume tiers, unlimited users, orders and
marketplaces):**

| Package | What's in it (app modules, `packages/core/src/modules/registry.ts`) | Monthly | Yearly (2 months free) |
|---|---|---|---|
| **Books** | Accounting, Banking (Wise sync, any bank by statement, rules, reconcile), Entity & compliance | $9 | $90 |
| **Seller** | Books + Commerce: Amazon, Walmart, Noon and eBay orders, settlements posted, payouts matched, Channel profit, buyer invoices and invoice requests, listing watch | $19 | $190 |
| **Seller Plus** | Seller + Inventory (stock, cost of goods sold, FBA/FBN/WFS, reorder, prices) + Review requests | $29 | $290 |

**Add-ons** (on Seller): **Stock** (Inventory) +$8 · **Review requests** +$5. Seller with both add-ons
is $32, so Seller Plus saves $3. Analytics (phase 6) isn't sold yet.

Against the ~$105 stack, Seller Plus is about 70% less; Seller alone replaces an accounting app
plus a settlement tool (~$60+) for $19.

**Rules for billing (C):**
- **Independence:** removing an add-on or moving down a package affects only the modules that leave;
  the others keep working unchanged. A module that leaves becomes **read-only, never deleted**; its
  data stays in reports and exports, and comes back as it was when the module is bought again.
- **Linked modules travel together:** a package always contains what its modules need (the
  registry's `requires`: Commerce needs Accounting; Inventory and Review requests need Commerce), so
  no package can switch off a module another active module needs. Add-ons are only offered on a
  package that contains their requirements.
- **Regional prices:** charge in USD everywhere at first; show an approximate local price (AED,
  SAR, EGP, CAD, MXN) on the pricing page. If Middle East conversion is weak after launch,
  consider regional price points (e.g. Egypt) in Stripe; not before.
- **Early access stays free** until billing starts; tell users at least 30 days before. The
  pricing page shows the prices with "Free during early access".
- **Owner to confirm** the numbers before billing goes live (the agent's proposal within
  "moderate, lower than competitors").

### Contact form and Resend
- The site sends with Resend's REST API (`fetch`, no SDK) from a server action. Env on the
  `bookalyze-site` Vercel project: `RESEND_API_KEY` (a **sending-only key for the bookalyze.com
  domain**, separate from the app's), `CONTACT_TO` (default `hello@bookalyze.com`),
  `CONTACT_FROM` (default `Bookalyze website <website@bookalyze.com>`). `reply_to` is the
  visitor's email. No auto-reply to the visitor (it would let anyone send our mail to anyone).
- Spam: hidden honeypot field, a minimum time on the form (3 s), a per-IP limit in memory (5 per
  10 minutes, best effort per instance), zod-validated fields with length caps.
- **Owner:** confirm the `hello@bookalyze.com` mailbox exists (MX is Hostinger) or set
  `CONTACT_TO` to a mailbox that does. Once D lands, the form creates a ticket instead (step D5).

---

## 3. Workstream A: the public site

Site rules: `apps/marketing/README.md`. Static pages, tokens copied from the app, light and dark,
check at 390px, pictures drawn in code with made-up data (`components/previews.tsx`).

**Done on this branch (data only, nothing renders it yet):**
- `src/content/marketplaces.ts`: Amazon, Walmart, Noon, eBay: tagline, where, connect, brings,
  intro, connect steps, sections, FAQ, related guides. Replaces `MARKETPLACES` in
  `src/components/marketplaces.tsx` (move the cards component to read from here).
- `src/content/countries.ts`: the six countries.
- `src/content/guides/types.ts`: the guide format (blocks: `p`, `where`, `steps`, `list`,
  `check`, `note`, `table`; `**bold**`).

**To do:**
1. [x] **Walmart everywhere, and the new order** (Amazon, Walmart, Noon, eBay):
   `components/marketplaces.tsx` (read `content/marketplaces.ts`; 2×2 cards, each linking to
   `/marketplaces/<slug>`), `components/flow.tsx` (four sources: wide `ys = [12,104,196,288]`;
   tall: four boxes 84 wide at `xs = [0,92,184,276]`, wires from `x + 42`; results stay three),
   `app/layout.tsx` (title "Bookalyze · Accounting for Amazon, Walmart and Noon sellers",
   description), `components/footer.tsx` (blurb and the trademarks line: add Walmart),
   `app/features/page.tsx` (metadata; WFS stock with FBA and FBN), `app/pricing/page.tsx`,
   `app/page.tsx` (`CONNECTS`, FAQ "Which marketplaces", hero copy). Previews may show a Walmart
   row where natural (`PayoutsPreview`, `SettlementPreview`).
2. [x] **Home rewrite** around §2: hero ("Accounting built for Amazon, Walmart and Noon sellers",
   lead naming the six countries), "Are you really making money?" (the snapshot: the
   `ProfitWaterfall`, with copy on finding out too late), pains → answers, how it works
   (`MoneyFlow`), marketplaces, **three highlight sections** (Wise sync with a bank-feed preview;
   review requests with `ReviewsPreview`; buyer invoices with a new `InvoicePreview`: an order →
   "Create invoice" → bilingual PDF → "Sent to the buyer"), countries grid (flag, name, its
   marketplaces, link), multi-company, safety, FAQ, CTA.
3. [x] **Marketplace pages** `app/marketplaces/[slug]/page.tsx` (`generateStaticParams` from
   `MARKETPLACES`, `notFound()` otherwise, metadata per page): intro, "brings" checklist,
   connect steps, sections, FAQ (`Faq`), related guides, countries it serves, CTA. Header nav
   "Marketplaces" becomes a link to `/marketplaces` (an index of the four) or a small menu.
4. [x] **Country pages** `app/sellers/[country]/page.tsx` from `COUNTRIES`: title/lead, the
   marketplaces there (cards linking to their pages), points, the pains block, FAQ, CTA.
   `/sellers` lists all six. Metadata per page (e.g. "Accounting for Amazon.ae and Noon sellers in
   the UAE").
5. [x] **Contact** `app/contact/page.tsx` (+ `contact-form.tsx` client with `useActionState`,
   `actions.ts` server action): name, email, company (optional), topic (A question about
   Bookalyze · Help with my account · A marketplace or country you don't cover yet · Partnerships
   and press · Something else), message; inline errors, pending state, a thank-you state; the
   privacy policy linked under the button. Add `zod` to `apps/marketing/package.json` (same
   version as `apps/web`). In development without `RESEND_API_KEY`, log the message and succeed;
   in production without it, say email isn't set up and `console.error`. Footer "Contact" →
   `/contact` (keep the mailto as a line on the page).
6. [x] **Guides (knowledge base)** `app/guides/page.tsx` (categories, a client-side search box
   over titles and summaries, `?q=`), `app/guides/[slug]/page.tsx` (breadcrumb, title, summary,
   an "On this page" list of section headings, the blocks, related guides, "Was this helpful?
   Contact us" → `/contact?topic=help`), a renderer `components/guide-blocks.tsx` for the block
   types (`where` as a pill like "Commerce → Settlements", `check` as a ticked list titled "What
   you should see", `note` tip/caution boxes). Content in `src/content/guides/<category>.ts`,
   collected in `src/content/guides/index.ts` (`GUIDES`, `CATEGORIES`, `guide(slug)`). The full
   list is §6 below. Write them from STATUS.md §2 (it says exactly what each screen does).
7. [x] **Help centre** `app/help/page.tsx`: search the guides, popular guides, categories, "Still
   stuck?" → open a ticket (in the app, once D lands: `APP_URL/help`), or the contact form; the
   status of the service isn't shown (no status page yet). Header: "Guides" and "Help"; footer:
   a **Resources** column (Guides, Help & support, Contact) and **Sellers in** (the six
   countries).
8. [x] **Sitemap** (`app/sitemap.ts`): add `/marketplaces`, each marketplace, `/sellers`, each
   country, `/guides`, each guide, `/help`, `/contact`.
9. [x] **Docs:** `apps/marketing/README.md` (the content folder, how to add a guide, env vars),
   `docs/SETUP.md` → Public site (the three env vars), STATUS.md §2 "The public site".
10. [x] **Check:** `pnpm --filter @bookalyze/marketing build` and `typecheck`, `pnpm lint`;
    every new page at 390px and in dark mode; the contact form end to end on the Vercel preview
    (with the env vars set for Preview too). _Done except the last: the preview needs the owner's
    `RESEND_API_KEY` (§7). Locally, without the key, the form logs the message and thanks the
    visitor._

## 4. Workstream C: billing in the app (module-based subscriptions)

Brief for its own session (fresh context):
- **Goal:** each company pays for a package and add-ons per month (table and rules in §2), via
  **Stripe** (Checkout for
  sign-up to a plan, the Customer Portal for card/cancel, webhooks as the source of truth).
  **Test mode first; no live charges until the owner switches it on.** Early access: every company
  keeps everything free until a `BILLING_STARTS_ON` date the owner sets; nothing is gated before.
- **Model:** `packages/core`: `PACKAGES` and `ADD_ONS` (USD, monthly and yearly, the modules each
  grants) beside the module registry, with a check that every package and add-on satisfies the
  registry's `requires`, and a pure `entitledModules(subscription)` function.
  `packages/db`: `subscriptions` (organization, Stripe customer and subscription ids, status,
  current period end, cancel at period end) and `subscription_items` (module key, price id,
  interval), under RLS, written only by the webhook (security-definer function or the migrator
  path, like other jobs), plus an audit entry per change.
- **Entitlements:** the org's `activeModules` / `can()` gain a billing layer: a module is usable
  when it's switched on **and** (early access, or a subscription item covers it, or within a
  7-day grace after a failed payment). Losing a module makes it **read-only, never deleted**
  (books are kept and exportable); say so plainly on the module's pages. **Test the
  independence rule:** removing the Stock add-on leaves Commerce, Accounting and Review requests
  exactly as they were (e2e and db tests).
- **Screens:** Company settings → **Plan and billing** (owners only): the three packages and the
  add-ons with prices, what's on, monthly / yearly toggle, total, "Subscribe" (Checkout), "Manage billing" (Portal),
  invoices list from Stripe, the early-access note. A banner when payment failed.
- **Env:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` (or look prices up by
  lookup key), `BILLING_STARTS_ON`. Add to `.env.example` and SETUP.md (Stripe section: products
  and prices with lookup keys, webhook endpoint `/api/stripe/webhook`, events
  `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`).
- **Tests:** core (prices, requires, entitlement rules), db (webhook writes, RLS isolation),
  e2e against a Stripe stand-in (like `e2e/*-mock.mjs`) for subscribe → module usable → cancel →
  read-only.
- **Owner input:** confirm prices; create the Stripe account and products; decide the
  `BILLING_STARTS_ON` date; tax on the subscription (Stripe Tax or not) is the owner's call.

## 5. Workstream D: help & support with tickets

Brief for its own session (fresh context):
- **Goal:** signed-in users open support tickets from the app; the team answers from an agent
  view; both sides can reply by email; the public site's contact form creates tickets too.
- **Model:** `packages/db`: `support_tickets` (number `T-0001` global, organization (nullable for
  website enquiries), requester user or email + name, subject, topic, status `open` / `waiting
  on you` / `waiting on us` / `solved` / `closed`, priority, assigned agent, created/updated) and
  `support_messages` (ticket, author user or email, body (plain text, length-capped), internal
  note flag, attachments via the existing `attachments` table), RLS so a company's members see
  their company's tickets; agents (`PLATFORM_ADMIN_EMAILS`, already an env var) see all through
  a platform-admin path.
- **App screens:** a **Help** entry in the sidebar/footer (`/help` in the app): search box over
  the site's guides (link out to `bookalyze.com/guides/...`), **Contact support** form (topic,
  subject, message, files, and the page the user came from), **Your tickets** list and a ticket
  page (thread, reply, mark solved, reopen). Agent view `/admin/support` (platform admins):
  queue by status, assign, internal notes, canned replies later.
- **Email:** new ticket and each reply email the other side (React Email templates in
  `src/emails/`, sent with the existing `server/email.ts`). Replies by email: the existing Resend
  inbound webhook (`/api/inbound/email`, see STATUS "Invoice requests") gets a third address,
  `support-<ticket token>@INBOUND_EMAIL_DOMAIN`, set as `reply_to`; the reply body (quoted text
  stripped) becomes a message.
- **Website intake (D5):** `POST /api/support/intake` with a shared secret header
  (`SUPPORT_INTAKE_SECRET`, also on the `bookalyze-site` project), zod-checked, rate-limited;
  creates a ticket with no organization. Then change the site's contact action to call it, and
  keep emailing `CONTACT_TO` only as a fallback when the call fails.
- **Home:** "N support replies waiting for you" in Needs your attention.
- **Tests:** db (RLS, numbering, statuses), e2e (open a ticket, agent replies, user sees it,
  email reply threads in via the inbound stand-in), the intake endpoint's secret.

## 6. The guides (knowledge base)

**Written (2026-10-21):** `src/content/guides/connections.ts` (`connect-amazon`, `connect-walmart`,
`connect-noon`, `connect-ebay`, `connect-wise`: how to obtain each key or token, step by step,
with the Amazon role-per-feature table and troubleshooting) and `src/content/guides/reviews.ts`
(`automatic-review-requests`, `review-requests`). Collect them in `guides/index.ts` with the
rest. **Owner: automatic review requests are a headline feature**; give them a home section of
their own and a place in the hero's highlights.

**App follow-up (small, its own PR; done in [PR #168](https://github.com/kashanshah/bookalyze/pull/168)):** the Amazon connect dialog's role list
(`apps/web/src/app/o/[slug]/commerce/channels/amazon.tsx`, step 2) names fewer roles than the
features use. Align it with the guide's table: Inventory and Order Tracking, Finance and
Accounting, Buyer Solicitation, Buyer Communication, Amazon Fulfillment, Product Listing,
Pricing, Selling Partner Insights, Tax Invoicing (only if the profile has it); link the guide.

Each guide: what it's for, **where** in the app, steps, what posts to the books (if anything),
**what you should see** (checks a seller can tick: our "test cases"), limits ("Not yet"), related
guides. Slugs already referenced by `content/marketplaces.ts` are marked ★.

**Getting started:** `how-bookalyze-works` (the money path: marketplace → clearing account →
bank; orders vs settlements; what posts and when) · `create-your-company` (country, main
currency, financial year, features to switch on) · `invite-your-team` (owners, admins, members;
accountant access to one company) · `move-from-wave` (and QuickBooks, Xero, Zoho, Sage: the
import wizard, receipts by file name, undo an import) · `your-first-week` (a checklist from sign-up
to the first matched payout).

**Marketplaces:** `connect-amazon` ★ (own SP-API app, roles, region, marketplaces, orders start
date) · `connect-walmart` ★ (countries, who ships, API key per country, what the key can see) ·
`connect-noon` ★ (countries, FBN/FBP, service-account key file, no IP whitelist) ·
`connect-ebay` ★ (sites, one-click consent, read-only) · `channels` (switch off, who ships,
remove one added by mistake, disconnect) · `orders` (tabs, search, badges: refunded, A-to-z,
chargeback, replaced; no buyer details kept).

**Payouts in your books:** `how-payouts-post` (the clearing/balance account idea, choosing
accounts, start date, automatic posting) · `amazon-settlements` ★ (bring in, upload flat files
or the date range transaction report, groups, reserves, tax on fees, post, post again, take
out) · `walmart-settlements` ★ (bring in, "Needs a look", post, corrected settlements) ·
`noon-months` ★ (transaction view by API or upload, months, changed since posted, balance
check) · `ebay-months` ★ (Finances API, Seller Hub report, months) · `match-payouts` ★ (deposit
candidates, any account and currency, exchange differences, Not this one, Unmatch, Match N).

**Banking:** `connect-wise` (read-only token, balances to accounts, daily sync, bank vs books
balance) · `upload-bank-statements` (any bank CSV, columns remembered, several-account files) ·
`bank-rules` (rules, suggested rules, apply to existing) · `duplicates-and-transfers` (possible
duplicates, merge, transfer matching, unmatch) · `reconcile` (statement, ticks, difference, undo).

**Invoices:** `buyer-invoices` (Create invoice on the order, bilingual PDF, registered or not,
correct details, **send to Amazon in seconds**) · `invoice-requests` (the forwarding address,
Gmail forwarding confirmation, answered/dismiss) · `brand-and-invoice-numbers` (logo, letterhead,
prefix/suffix with {YYYY}).

**Reviews and listings:** `review-requests` (Amazon's own request, the window, ask now / ask all,
eligibility) · `automatic-review-requests` (settings, skips: refunded, replacements, business,
promotions, SKUs) · `listing-watch` (what's watched, cadence, email digest, limits) ·
`amazon-prices` (price beside cost and fees, change price, applied or not).

**Accounting:** `transactions` (review, categorise on the list, splits, copy, remove) ·
`receipts` (inbox, attach, receipts by email) · `customers-and-vendors` · `journal-entries` ·
`chart-of-accounts` · `sales-tax` (packs, rates, registrations, report) · `currencies`
(main currency, exchange rates, transfers between currencies) · `close-the-books`.

**Stock and cost of goods:** `products-and-skus` (link SKUs, packs, bundles, SKUs not linked) ·
`purchase-orders` (draft → sent → deliveries, Alibaba receipts, cost/line/order totals) ·
`supplier-payments` (payment plans, payments, purchases in the books, settle the difference) ·
`landed-cost-and-lots` (freight, duty, splits, FIFO lots) · `cost-of-goods-sold` (opening
stock, monthly posting per marketplace, states, undo) · `fba-inventory-ledger` ★ (returns,
losses, write-offs) · `noon-fbn-stock` ★ (ledger, summary, the check) · `stock-overview` ★
(books vs Amazon/Noon/Walmart vs your count) · `stock-taken-out` (take out, move to another
product, put back) · `reorder` (the maths, settings, order now/soon).

**Reports and views:** `home-needs-attention` · `channel-profit` (every row explained, your own
costs, shared costs, All channels) · `financial-reports` (profit and loss, balance sheet, trial
balance, periods, print) · `your-stake` · `sales-tax-report`.

**Your company:** `company-profile-and-documents` · `compliance-calendar` (what's worked out per
country, reminders).

**Worked examples (use cases with checks):** `are-you-losing-money` (find the channel or product
that loses money: Channel profit, Prices, cost of goods) · `month-end-for-sellers` (the monthly
close, in order, with the checks) · `amazon-ae-payout-into-cad` (a settlement in AED, deposit in
CAD, the exchange loss) · `alibaba-to-fba` (a purchase order from a receipt, freight paid, the
delivery's landed cost, FBA sales, cost of goods sold) · `uae-vat-threshold` (approaching AED
375,000: register, add VAT, invoices change) · `books-agree-with-marketplaces` (every check
Bookalyze offers: settlement balanced, Noon balance check, stock compared, bank vs books,
reconcile).

## 7. Owner actions

- [ ] Support (PR #169): generate `SUPPORT_INTAKE_SECRET` (`openssl rand -hex 32`) and set it on
      the app's Vercel project and on `bookalyze-site`, plus
      `SUPPORT_INTAKE_URL=https://app.bookalyze.com/api/support/intake` on the site. Until then the
      form emails `CONTACT_TO`.

- [ ] Resend: a sending-only API key for the site on the `bookalyze-site` Vercel project
      (Production and Preview), plus `CONTACT_TO` / `CONTACT_FROM` if not the defaults. The
      app's key is a sensitive Vercel variable and can't be read back, so make a new one: Resend →
      API Keys → Create, permission **Sending access**, domain **bookalyze.com**; then Vercel →
      bookalyze-site → Settings → Environment Variables → `RESEND_API_KEY`, and redeploy.
- [ ] Confirm `hello@bookalyze.com` receives mail.
- [ ] Confirm the prices in §2; then Stripe (C, PR #170), in **test mode**: products and prices
      with the lookup keys `books_month` … `reviews_year`, the webhook `/api/stripe/webhook` and
      its secret, the customer portal (SETUP → Stripe). Decide `BILLING_STARTS_ON` and Stripe Tax.
      Live keys and `STRIPE_LIVE=true` only when you decide billing goes live.
- [ ] Migrations: PRs #169 and #170 both add `0081`; whichever merges second renumbers its own
      (and merges the neighbouring lines in `env.ts`, `.env.example`, the sidebar and STATUS).
- [ ] `SIGNUP_MODE=open` on the app's project when the site goes out with "Start free".
- [ ] Read the guides (`/guides` on the PR #167 preview) for anything that doesn't match how you
      use the app, above all: the Gmail forwarding steps (`invoice-requests`), the Wise strong
      customer authentication "Not yet", and the compliance calendar's dates. They were written
      from STATUS.md §2, not from a live account.
- [ ] Send one message through the preview's contact form once `RESEND_API_KEY` is set for
      Preview, and check it reaches `CONTACT_TO` with the visitor as reply-to.

## 8. Decisions made overnight (2026-10-21 → 22)

Made without the owner, to keep going; each fits the docs and is easy to change.

**Site (PR #167)**
- **Header "Marketplaces" is a link** to `/marketplaces` (an index of the four), not a menu: one
  less moving part on phones.
- **Contact form:** Resend's REST API with `fetch` (no SDK in the site); reply-to is the visitor.
  Spam guards are a hidden field, a 3-second minimum and 5 messages per address per 10 minutes,
  kept in memory per server instance (good enough for a contact form; no database on the site).
  Topics as in §3 item 5, plus `?topic=` to preselect (Help and guides link `?topic=help`).
- **No reply-time promise** ("within one working day" was removed): nobody has agreed to one.
- **Pricing page:** a Monthly / Yearly switch; local prices only for currencies pegged to the
  dollar (AED 3.6725, SAR 3.75), since others would need a rate we'd be guessing; "Best value" on
  Seller Plus; the add-ons shown under Seller, with a note that Seller with both costs more than
  Seller Plus.
- **Guides all in PR #167** (not split to `claude/site-guides`): they're data files plus one
  renderer, and the site build and a new test check them together.
- **Listing watch and Amazon prices** sit under "Reviews and listings", as §6 lists them.
- **Worked examples use made-up numbers and say so** (an AED 10,000 payout at 1 AED = 0.3720
  CAD; 500 mugs at USD 2.00 + USD 250 freight).
- **"Not yet" where the app isn't there:** daily rates for the riyal and Egyptian pound (the Bank
  of Canada doesn't publish them), Wise profiles that need strong customer authentication,
  sending invoices through Walmart/Noon/eBay, a read-only team role, compliance dates outside
  Canada and the UAE, comparing report periods.
- **Paths say what the sidebar says**, e.g. "Entity & compliance → Brand" (not "Company").
- **D5 wired here:** the contact form posts to the app's `/api/support/intake` when
  `SUPPORT_INTAKE_URL` and `SUPPORT_INTAKE_SECRET` are set, and falls back to emailing `CONTACT_TO`
  when they aren't or the app doesn't answer. Help's "Still stuck?" also offers "Open a ticket in
  the app" (`APP_URL/help`, live once the support PR merges).
- **Billing (PR #170):** a per-company start date (`billing_accounts.starts_on`) can override
  `BILLING_STARTS_ON`; a change in a read-only module sends the person to Plan and billing,
  which explains it; a live Stripe key is ignored without `STRIPE_LIVE=true`; choosing a plan
  during early access starts a trial until billing starts. Not yet: daily jobs still run for
  read-only modules.
- **Support (PR #169):** no files on tickets yet; the desk is the platform admins; website
  visitors get no acknowledgement email; email replies from anyone but the requester or an agent
  are dropped.
- **A test for the content** (`apps/marketing/src/content/guides/guides.test.ts`, run by
  `pnpm test`): unique slugs, and every guide linked from a page, the content files or another
  guide exists, so a renamed guide can't leave a 404.


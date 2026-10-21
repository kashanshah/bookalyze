# Setup

## Local development

Requirements: Node 22, pnpm 10 (`corepack enable`), Docker (or any Postgres 16).

```bash
pnpm install                    # also installs the pre-commit hook (Biome on staged files)
cp apps/web/.env.example apps/web/.env   # then fill in BETTER_AUTH_SECRET (openssl rand -base64 32)
# Optional: put overrides (e.g. Neon connection strings) in apps/web/.env.local; it wins over .env.
# The public site has its own: cp apps/marketing/.env.example apps/marketing/.env.local
```

For local Postgres via Docker, set these in `apps/web/.env`:

```bash
DATABASE_URL=postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze
DATABASE_URL_MIGRATOR=postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze
EMAIL_DEV_LOG=true              # emails go to apps/web/.dev-mail.log instead of Resend
PLATFORM_ADMIN_EMAILS=you@example.com
```

```bash
pnpm db:up                      # starts Postgres and creates the roles + databases
pnpm db:setup                   # migrations + reference data (countries, regions, currencies)
pnpm dev                        # http://localhost:3000
```

Sign up with the email in `PLATFORM_ADMIN_EMAILS`. With `EMAIL_DEV_LOG=true`, open the
verification link from `apps/web/.dev-mail.log`. Email designs can be previewed at
http://localhost:3000/dev/emails.

## Neon (production database)

1. In Vercel → your project → **Storage**, create (or connect) a Neon database. Vercel sets
   `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct), both as the owner role
   (`neondb_owner`). Nothing else to add for the database.
2. Create the tables and reference data from your machine, with the owner's **direct** string
   (`vercel env pull` gives you `DATABASE_URL_UNPOOLED`, or copy it from Neon → Connect with
   pooling off):
   ```bash
   DATABASE_URL_MIGRATOR='postgresql://neondb_owner:…@ep-….neon.tech/neondb?sslmode=require' pnpm db:setup
   ```
   The migrations create the `app_runtime` role and let the owner switch to it.
3. Deploy. The app logs in as the owner, and every company-data query runs inside `withOrg()`,
   which switches the transaction to `app_runtime`. That role owns no tables and can't bypass
   row-level security, so each company only ever sees its own rows.

Neon branches copy roles, so a `preview` branch works the same way with its own host.

## Connections (Wise)

1. Set `APP_ENCRYPTION_KEY` in Vercel (Production and Preview) to `openssl rand -base64 32`. It
   encrypts each company's saved tokens. Keep a copy somewhere safe; if it changes, connections
   must be made again (their transactions stay).
2. In the app: Banking → Bank accounts → Connect Wise. In Wise, a read-only API token comes from
   Settings → API tokens (on the business profile for a company).
3. The daily cron (`vercel.json`, weekdays) syncs every connection after fetching exchange rates;
   "Sync now" does it on demand.

## eBay (Connect eBay)

Bookalyze is **one eBay developer app**: its keys are system secrets (Vercel env vars), and each
company connects its own eBay seller account from an eBay site's page (Channels → eBay … →
Connect eBay) by agreeing on eBay's page. A company's refresh token is kept encrypted with
`APP_ENCRYPTION_KEY`, like other connections. Without the keys, Connect eBay says it isn't
available yet; eBay sites still work for linking SKUs.

1. Sign in at developer.ebay.com with a Bookalyze (not a seller) eBay account and create an
   application. Use the **Production** keyset (Sandbox to try things out).
2. **User Tokens → Get a Token from eBay via Your Application → Add eBay Redirect URL**: set
   "Your auth accepted URL" and "Your auth declined URL" to
   `https://app.bookalyze.com/api/ebay/callback`, and "Privacy policy URL" to
   `https://app.bookalyze.com/privacy-policy`. Note the
   **RuName** it shows (e.g. `Bookalyze-Bookalyz-Bookal-abcdef`).
3. **Alerts & Notifications → Marketplace account deletion**: endpoint
   `https://app.bookalyze.com/api/ebay/account-deletion` and a verification token you make up
   (32–80 letters, digits, `_` or `-`). Set the env vars below and deploy first: eBay checks the
   endpoint when you save. eBay then sends a notice when a seller closes their eBay account, and
   Bookalyze disconnects and forgets them.
4. In Vercel (Production; Preview only with Sandbox keys): `EBAY_CLIENT_ID` (App ID),
   `EBAY_CLIENT_SECRET` (Cert ID), `EBAY_RU_NAME`, `EBAY_VERIFICATION_TOKEN`, and
   `EBAY_ENVIRONMENT=sandbox` when using Sandbox keys (production is the default).
5. Call limits are per app, shared by every connected account. eBay's "Application Growth Check"
   raises them when needed.

## Amazon Ads (Connect Amazon Ads)

Ad spend per product (Channel profit → By product) comes from the **Amazon Ads API**, through
**one Bookalyze Ads app** (a Login with Amazon security profile approved for the Ads API). Its keys
are system secrets (Vercel env vars); each company connects its own ads accounts from an Amazon
marketplace's page (Channels → Amazon.ca → Amazon Ads → Connect Amazon Ads) by agreeing on
Amazon's page, once per Ads region (North America for Amazon.ca, Europe for Amazon.ae). The
refresh token is kept encrypted with `APP_ENCRYPTION_KEY`. Bookalyze only reads reports. This is
separate from the Selling Partner app (Seller Central → Develop Apps): the two use different
Login with Amazon clients. Design: `docs/ADS.md`.

1. **Security profile.** developer.amazon.com → Login with Amazon → Create a New Security Profile:
   name `Bookalyze`, a description, and the privacy notice URL
   `https://app.bookalyze.com/privacy-policy`. Note its **Client ID** and **Client Secret**
   (Show Client ID and Client Secret).
2. **Return URL.** The profile's Web Settings → Edit → **Allowed Return URLs**:
   `https://app.bookalyze.com/api/amazon-ads/callback` (add `http://localhost:3000/api/amazon-ads/callback`
   only on a separate development profile). Allowed Origins can stay empty.
3. **Ads API access.** Apply at advertising.amazon.com → Amazon Ads API → Apply for access (the
   onboarding form), signed in with the Amazon Ads account Kazomo advertises with. Describe the use:
   "Reads Sponsored Products and Sponsored Brands reports (spend and attributed sales per product
   per day) for the advertiser's own accounting and profit reports; no campaign management." Amazon
   reviews it (usually days) and emails when approved. Offering it to other companies' accounts may
   need Amazon's partner (tool provider) route; Amazon says which when it reviews.
4. **Link the profile.** When approved, follow Amazon's email to accept the Ads API terms and assign
   the security profile from step 1 to Ads API access (its Client ID). Until this is done, consent
   works but every report request is refused.
5. **Vercel** (Production): `AMAZON_ADS_CLIENT_ID`, `AMAZON_ADS_CLIENT_SECRET`. Preview deployments
   can't finish consent (their callback isn't an Allowed Return URL).
6. **In Bookalyze**, as an owner or admin: Commerce → Channels → Amazon.ca → **Connect Amazon Ads**,
   and the same on Amazon.ae (the Europe region needs its own consent). Sign in on Amazon's page
   with a login that can see that marketplace's Campaign Manager. Never type an Amazon password or
   one-time code anywhere but Amazon's own page.

Reports: the daily job asks for each channel's last 15 days (60 on first connect); the 5-minute job
collects them when Amazon has made them. Limits are per app and shared by every connected account.

## Vercel

1. Import the GitHub repository. Set **Root Directory** to `apps/web` (framework: Next.js). Vercel
   detects the pnpm workspace automatically.
2. Add the environment variables from `apps/web/.env.example` for Production (and Preview,
   pointing at a Neon preview branch). Don't set `EMAIL_DEV_LOG` in production.
3. Production waits for its database migrations (below, **Deploys**): Vercel builds `main` as
   usual, and puts a build live once the "Bookalyze: migrations" check passes.
4. Add the domain `app.bookalyze.com` under Project → Domains.

## Public site (bookalyze.com)

The marketing site is `apps/marketing`, a second Vercel project from the same repository.
All of the site's variables, with local values, are in `apps/marketing/.env.example`.
Optional: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`. The contact form (`/contact`) needs:

| Variable | Default | |
|---|---|---|
| `RESEND_API_KEY` | none | A **sending-only** Resend key for bookalyze.com (Resend → API Keys → Create → Sending access). Set it for Production and Preview. Without it, the form says email isn't set up |
| `CONTACT_TO` | `hello@bookalyze.com` | Where messages go |
| `CONTACT_FROM` | `Bookalyze website <website@bookalyze.com>` | The sender; its domain must be verified in Resend |
| `SUPPORT_INTAKE_URL` | none | `https://app.bookalyze.com/api/support/intake`: messages become support tickets in the app |
| `SUPPORT_INTAKE_SECRET` | none | The same value as the app's `SUPPORT_INTAKE_SECRET` (`openssl rand -hex 32`). Without both, or when the app can't be reached, the form emails `CONTACT_TO` |

1. Vercel → Add New → Project → import the same repository. **Root Directory** `apps/marketing`
   (framework: Next.js). Name it e.g. `bookalyze-site`.
2. Project → Domains: add `bookalyze.com` and `www.bookalyze.com` (redirect `www` to the apex).
   Vercel shows the DNS records; set them where the domain's DNS is managed (Hostinger → Domains
   → DNS), replacing the old Hostinger site's records. Leave `app.bookalyze.com` as it is.
3. Open sign-ups in the app: on the app's project set `SIGNUP_MODE=open` (Production) and
   redeploy. Until then the site's "Start free" leads to the invite-only sign-up.
4. Once bookalyze.com serves the new site, retire the Hostinger site (`apps/landing/`) and its
   waitlist; email the Resend `Waitlist` segment that sign-up is open.

Its production deploys also start the **Deploy** workflow (it can't tell the two projects apart);
with nothing to migrate it just passes. Don't add the "Bookalyze: migrations" Deployment Check to
this project.

## Deploys

Merging a PR into `main` makes Vercel build it. When the production build is ready, Vercel
tells GitHub, and the **Deploy** workflow (`.github/workflows/deploy.yml`):

1. Waits for CI on that commit. If CI fails, the build doesn't go live.
2. Applies pending database migrations, **only if every one is safe to run unattended**: it adds
   or widens (tables, columns, indexes, constraints, backfills). One that drops a table or column,
   empties or deletes rows, renames something or changes a column's type applies nothing, names
   the statement, and fails. PRs that add such a migration get a warning in CI.
3. Reports the check **Bookalyze: migrations** on the commit. Vercel puts the build live only
   once it passes (Deployment Checks), so new code never goes live before its migrations. Until
   then the previous version keeps running.

**One-time setup:**

- GitHub → the repo → Settings → Secrets and variables → Actions → New repository secret:
  `DATABASE_URL_MIGRATOR`, Neon's **owner** connection, the **direct** string (not the pooled
  one: the workflow holds a lock for the whole run). Only GitHub has it; the app never does. The
  app's own `DATABASE_URL` can't be used: it lives in Vercel, and its role can't change tables.
- Vercel → Project → Settings → Deployment Checks → add **Bookalyze: migrations** (it's listed
  once the workflow has reported it, after the first production build with it).

**When the check fails on a migration:** read what it names (the run's summary). If it's
intended (the data it drops is no longer needed, and the version running doesn't use it), run the
Deploy workflow by hand (Actions → Deploy → Run workflow) with that migration's tag in **Allow
migrations**, or run `DATABASE_URL_MIGRATOR=… pnpm db:migrate` yourself. Then re-run the failed
run (Actions → the run → Re-run jobs): with nothing left to apply it passes and Vercel puts the
build live. Safer still: ship such changes in two PRs, first code that stops using the column,
then the migration that drops it.

**By hand** (as before): `DATABASE_URL_MIGRATOR=… pnpm db:migrate` applies everything pending,
safe or not.

## Stripe (billing)

Test mode until the owner decides otherwise. Nothing is gated before `BILLING_STARTS_ON`.

1. Stripe dashboard, **Test mode** on. **Products**: one product per package (Books $9, Seller $19,
   Seller + Reviews $24, Seller + Stock $27, Seller Plus $29, Review requests only $9), each with
   a monthly and a yearly price in USD (yearly = ten months). Give every price its **lookup key**:
   `books_month`, `books_year`, `seller_month`, `seller_year`, `seller_reviews_month`,
   `seller_reviews_year`, `seller_stock_month`, `seller_stock_year`, `seller_plus_month`,
   `seller_plus_year`, `reviews_only_month`, `reviews_only_year`. There are no add-ons: one
   package per subscription, so the customer portal can switch plans.
2. **Developers → API keys**: the test secret key (`sk_test_…`) → `STRIPE_SECRET_KEY`. A live key
   is ignored unless `STRIPE_LIVE=true`. The publishable key of the same mode (`pk_test_…` or
   `pk_live_…`) → `STRIPE_PUBLISHABLE_KEY`, so the card form shows on our own page (Stripe's
   embedded Checkout). Without it, or with the other mode's key, people pay on Stripe's page.
3. **Developers → Webhooks → Add endpoint** `https://app.bookalyze.com/api/stripe/webhook` with
   events `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`,
   `invoice.paid`. Its signing secret → `STRIPE_WEBHOOK_SECRET`.
4. **Settings → Billing → Customer portal**: let customers update payment methods, see invoices,
   cancel (**at the end of the billing period**, so cancelling during the 30-day trial means no
   charge), and **switch plans** between the six products above (monthly and yearly prices).

   **Sign-up asks for a card** as soon as `STRIPE_SECRET_KEY` is set: a new company's last step
   is Stripe Checkout. With a **test** key (`sk_test_…`), Checkout only accepts Stripe's test cards
   (4242 4242 4242 4242), so real people can't finish signing up. Set the key in production only
   together with live keys (`STRIPE_LIVE=true`), or leave it unset until then.
5. `BILLING_STARTS_ON=YYYY-MM-DD` when billing should start; leave it unset for early access.
   Every company then gets a 30-day free trial of everything (from that day, or from its creation
   if later); nothing is charged before it ends. One company can start earlier (or later) with
   `billing_accounts.starts_on` (owner only, by SQL).
6. Tax on subscriptions (Stripe Tax or not) is the owner's call; nothing here turns it on.

## Google sign-in

1. Google Cloud Console → create (or pick) a project → **APIs & Services → OAuth consent screen**:
   app name *Bookalyze*, support email, logo, authorized domain `bookalyze.com`. Publish the app
   when you're ready for anyone to sign in.
2. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `http://localhost:3000`, `https://app.bookalyze.com`
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`,
     `https://app.bookalyze.com/api/auth/callback/google`
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (locally in `apps/web/.env`,
   in Vercel for production). The "Continue with Google" button appears automatically.
4. For Vercel previews, set `OAUTH_PROXY_PRODUCTION_URL=https://app.bookalyze.com` in the Preview
   environment. Google only allows exact redirect URLs, so previews route the callback through
   production.

Users who signed up with Google can add a password under **Account & security**, then sign in
either way. Signing in with Google using an existing account's email links the two.

## Resend (email)

1. resend.com → **Domains → Add domain** `bookalyze.com`, then add the DNS records it shows (SPF,
   DKIM, and optionally DMARC) at your domain registrar. Wait for "Verified".
2. **API Keys → Create** (sending access) → `RESEND_API_KEY`.
3. `EMAIL_FROM="Bookalyze <no-reply@bookalyze.com>"`.

## Support tickets

- **The desk** is the emails in `PLATFORM_ADMIN_EMAILS`: they open `/admin/support` (a 404 for
  everyone else) and get an email for each new ticket and customer reply.
- **Replies by email** need the receiving domain already used for invoice requests
  (`INBOUND_EMAIL_DOMAIN` and `RESEND_WEBHOOK_SECRET`). Ticket emails then carry a
  `support-<token>@INBOUND_EMAIL_DOMAIN` reply-to, and the same webhook adds the replies.
  Without them, ticket emails have no reply-to and people answer in the app.
- **The website's contact form** (`/contact` on bookalyze.com) makes tickets when both projects
  share a secret: `openssl rand -hex 32`, then set it as `SUPPORT_INTAKE_SECRET` on the app's
  Vercel project and on `bookalyze-site` (with `SUPPORT_INTAKE_URL=https://app.bookalyze.com/api/support/intake`
  on the site). Until then the site emails `CONTACT_TO` as before.

## AWS S3 (receipts and documents)

Files are uploaded by the browser straight to a private S3 bucket using short-lived signed links,
and opened the same way. Nothing in the bucket is public. Locally you can skip S3: with
`STORAGE_DRIVER=local`, files are kept in `apps/web/.uploads` (git-ignored).

1. **Create the bucket** (AWS console → S3 → Create bucket):
   - Name: e.g. `bookalyze-files-prod`. Region: `ca-central-1` (Canada).
   - Keep **Block all public access** on.
   - Turn **Bucket Versioning** on, so deleted or overwritten files can be recovered.
   - Default encryption: SSE-S3 is fine.
2. **Allow browser uploads (CORS).** Bucket → Permissions → Cross-origin resource sharing (CORS):
   ```json
   [
     {
       "AllowedOrigins": ["https://app.bookalyze.com", "https://*.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```
   Drop `http://localhost:3000` if you only use S3 in production. If your previews use a custom
   domain, add it instead of `https://*.vercel.app`.
3. **Create an IAM user for the app** (IAM → Users → Create user, no console access). A new user
   has no permissions, so uploads fail with **403** until you add this. Users → the user →
   Permissions → Add permissions → **Create inline policy** → JSON. Replace `bookalyze-files-prod`
   with **your** bucket name:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::bookalyze-files-prod/*"
       }
     ]
   }
   ```
   Then Security credentials → Create access key → "Application running outside AWS".

   **If uploads fail with 403**, open the failed PUT in the browser's network tab → Response. S3's
   `<Code>` says why:
   - `AccessDenied`: the policy is missing or names another bucket.
   - `SignatureDoesNotMatch`: the secret in Vercel doesn't belong to that access key.
   - `InvalidAccessKeyId`: the key was deleted or mistyped.

   A CORS error instead of a 403 means step 2 is missing.
4. **Add the settings** to Vercel (Production and Preview) and, if you want S3 locally, to
   `apps/web/.env.local`:
   ```bash
   AWS_REGION=ca-central-1
   AWS_S3_BUCKET=bookalyze-files-prod
   AWS_ACCESS_KEY_ID=…
   AWS_SECRET_ACCESS_KEY=…
   ```
   Leave `STORAGE_DRIVER` unset on Vercel; it uses S3 when these are present. Redeploy after
   adding them. Until they're set, the Receipts page explains that storage isn't connected.

Optional: use a separate bucket (e.g. `bookalyze-files-preview`) for Preview deployments so test
uploads never mix with real receipts.

## Logs

Bookalyze writes one JSON line per event to the server logs (Vercel → the project → **Logs**).
Filter by the event (`"event":"request.failed"`, `noon.request_failed`, `job.daily`…), a company
ID, or the **error reference** shown on the "Something went wrong" page. Credentials are never
logged, and email addresses are masked. To keep logs longer than Vercel's retention, add a Log
Drain (Vercel → Settings → Log Drains) to a log service; nothing in the app changes.

## Daily exchange rates (Vercel Cron)

`apps/web/vercel.json` schedules `/api/cron/fx-rates` on weekdays at 22:15 UTC. That's after the
Bank of Canada publishes its daily rates at about 16:30 Eastern. The job stores the last ten days
of rates, so missed runs fill themselves in, then syncs bank connections.

The same file schedules `/api/cron/orders` every 5 minutes (Amazon orders and their items) and
`/api/cron/review-requests` hourly. Both need Vercel Pro (Hobby allows daily jobs only) and the
same `CRON_SECRET`.

1. Generate a secret: `openssl rand -base64 32`.
2. In Vercel → Settings → Environment Variables, add `CRON_SECRET` with that value for
   **Production**. Vercel sends it automatically as `Authorization: Bearer …` when it calls the
   job.
3. Redeploy. Under Settings → Cron Jobs you can see the job and run it once by hand, to load
   recent rates straight away.

Rates for older dates (back-dated entries) are fetched on demand the first time someone needs
them. If the Bank of Canada can't be reached, the form simply asks for the rate.

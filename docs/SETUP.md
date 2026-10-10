# Setup

## Local development

Requirements: Node 22, pnpm 10 (`corepack enable`), Docker (or any Postgres 16).

```bash
pnpm install                    # also installs the pre-commit hook (Biome on staged files)
cp .env.example .env            # then fill in BETTER_AUTH_SECRET (openssl rand -base64 32)
# Optional: put overrides (e.g. Neon connection strings) in a root .env.local; it wins over .env.
```

For local Postgres via Docker, set these in `.env`:

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
   `https://app.bookalyze.com/api/ebay/callback`, and "Privacy policy URL" to the site's. Note the
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

## Vercel

1. Import the GitHub repository. Set **Root Directory** to `apps/web` (framework: Next.js). Vercel
   detects the pnpm workspace automatically.
2. Add the environment variables from `.env.example` for Production (and Preview, pointing at a Neon
   preview branch). Don't set `EMAIL_DEV_LOG` in production.
3. Run migrations before deploying a change that includes a new migration:
   `DATABASE_URL_MIGRATOR=… pnpm db:migrate` (owner, direct string). Automating this comes later.
4. Add the domain `app.bookalyze.com` under Project → Domains.

## Google sign-in

1. Google Cloud Console → create (or pick) a project → **APIs & Services → OAuth consent screen**:
   app name *Bookalyze*, support email, logo, authorized domain `bookalyze.com`. Publish the app
   when you're ready for anyone to sign in.
2. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `http://localhost:3000`, `https://app.bookalyze.com`
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`,
     `https://app.bookalyze.com/api/auth/callback/google`
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (locally in `.env`,
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
4. **Add the settings** to Vercel (Production and Preview) and, if you want S3 locally, to your
   root `.env.local`:
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

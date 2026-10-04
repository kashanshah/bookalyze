# Setup

## Local development

Requirements: Node 22, pnpm 10 (`corepack enable`), Docker (or any Postgres 16).

```bash
pnpm install
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

1. Create a Neon project (region close to your users and to Vercel's function region) and a database
   named `bookalyze`.
2. In the Neon SQL editor, as the owner role, run `packages/db/scripts/create-app-role.sql` with a
   strong password. This creates the `bookalyze_app` login role the app uses.
3. Set `DATABASE_URL_MIGRATOR` (owner, **direct** connection) and run `pnpm db:setup` from your
   machine. This creates the `app_runtime` group, grants it to `bookalyze_app`, and loads reference
   data.
4. Use `bookalyze_app` with the **pooled** connection string as `DATABASE_URL` in Vercel.

Neon branches copy roles, so a `preview` branch works the same way with its own host.

## Vercel

1. Import the GitHub repository. Set **Root Directory** to `apps/web` (framework: Next.js). Vercel
   detects the pnpm workspace automatically.
2. Add the environment variables from `.env.example` for Production (and Preview, pointing at a Neon
   preview branch). Don't set `EMAIL_DEV_LOG` in production.
3. Run migrations before deploying a change that includes a new migration:
   `DATABASE_URL_MIGRATOR=… pnpm db:migrate`. Automating this in CI comes later.
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

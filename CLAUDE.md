# Bookalyze

Multi-company accounting and e-commerce back office (a Wave replacement plus Amazon/marketplace
tooling).

**Start with `docs/STATUS.md`**: what's done, what's next, ledger rules, recipes and gotchas.
Update it in every PR that changes what's done or next. Product plan, roadmap and decisions:
`docs/PLAN.md`. Brand and colours: `docs/BRAND.md`. Environment setup: `docs/SETUP.md`.

## Stack

TypeScript monorepo (pnpm workspaces + Turborepo) · Next.js 16 App Router · React 19 · Tailwind CSS v4
· shadcn/ui-style components (hand-written, Radix primitives) · PostgreSQL + Drizzle ORM · Better Auth
(email/password, Google, organizations) · Resend + React Email · Vitest · Playwright · Biome.

```
apps/web/            Next.js app
  src/app/           routes: (auth), onboarding, o/[slug]/… (org-scoped), account, api, dev/emails
  src/components/    ui/ (design system), shell/ (sidebar, headers), org/ (profile fields), auth/
  src/emails/        React Email templates (+ preview at /dev/emails in development)
  src/server/        server-only code: auth, env, email, org context, accounting context, audit
  src/lib/           shared helpers: dates, formatting, zod schemas (validation/)
  e2e/               Playwright end-to-end tests
packages/core/       pure TS: module registry + entitlements, fiscal-year maths, money (exact decimals),
                     currency, accounting (taxonomy, chart template, journal rules, report shaping),
                     reference data
packages/db/         Drizzle schema, migrations (drizzle/), RLS, client + withOrg(), ledger writes
                     (ledger.ts), seed
```

## Commands

```bash
pnpm db:up          # local Postgres in Docker (first run creates roles + databases)
pnpm db:setup       # migrate + seed reference data
pnpm dev            # http://localhost:3000
pnpm lint           # Biome (pnpm format to auto-fix)
pnpm typecheck
pnpm test           # unit + database (RLS) tests
pnpm e2e            # Playwright; needs a built app (pnpm build) and EMAIL_DEV_LOG=true
pnpm db:generate    # after changing packages/db/src/schema/*: creates a migration in packages/db/drizzle
```

Run `pnpm lint && pnpm typecheck && pnpm test` before pushing.

## Rules

**Tenancy and security**
- Every tenant table has `organization_id` and a row-level security policy (`tenantIsolationPolicy`).
- Query tenant data only inside `withOrg(db, { orgId, userId }, tx => …)`, after `getOrgContext(slug)`
  has confirmed membership. Never query tenant tables outside `withOrg`.
- The app connects as a runtime role that can't bypass RLS (`DATABASE_URL`); migrations use the owner
  role (`DATABASE_URL_MIGRATOR`). Never point `DATABASE_URL` at the owner.
- Log writes with `audit(tx, …)`. Audit logs are append-only.
- Server-only modules import `"server-only"`. Validate all input with zod on the server.

**Money and dates**
- Money is `NUMERIC` in the database and strings in TypeScript. Never use floats for money.
- Round to the currency's ISO minor units (`minorUnits()` in core).
- Accounting dates are ISO `YYYY-MM-DD` strings; fiscal periods come from `fiscalYearFor()`.
- Do money maths with `parseDecimal`/`formatDecimal`/`convertUnits` from core (BigInt), never `Number`.

**Ledger** (details in `docs/STATUS.md` §4)
- Validate entries with `prepareJournalEntry()` (core), write them with `postJournalEntry()` (db).
- Posted entries are immutable: correct them with `reverseJournalEntry()`. The database enforces it.
- Find system accounts by `system_key`, never by name or code.

**Modules**
- Features belong to a module in `packages/core/src/modules/registry.ts` (manifest: label, basePath,
  requires, features, nav, phase). Gate UI and server actions with the org's `activeModules` / `can()`.

**Design and UX (top priority)**
- The product must feel premium and self-explanatory, not like a developer tool.
- Use design tokens from `globals.css` (`bg-primary`, `text-muted-foreground`…), never raw colours.
- Build from `src/components/ui`. Use logical properties (`ms-`, `pe-`, `start-`, `text-start`) so
  right-to-left languages work later.
- Plain-language copy: labels say what the thing is for ("Main currency", "When does your financial
  year end?"). Add a short hint wherever a choice isn't obvious.
- Confirm actions with toasts (`sonner`); show inline errors next to fields; animate entrances subtly
  with `tw-animate-css` (`animate-in fade-in-0 …`). Respect reduced motion (handled globally).
- Check every screen at mobile width (390px) and in dark mode.

**Never**
- Commit secrets, `.env`, financial exports, company documents or personal data (use synthetic data
  in tests and seeds).
- Edit applied migrations. Generate a new one.
- Skip or disable tests to make CI pass.

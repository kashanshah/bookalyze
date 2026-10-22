# Bookalyze public site (bookalyze.com)

The marketing site: Home, Features, Pricing, a page per marketplace (`/marketplaces/<slug>`) and
per country (`/sellers/<country>`), Contact, the Guides (knowledge base) and Help. Next.js, built
separately from the app and deployed as its own Vercel project. It has no database or sign-in;
every page is static except the contact form's server action, which needs one secret
(`RESEND_API_KEY`).

- **Sign up / sign in** go to the app (`NEXT_PUBLIC_APP_URL`, default `https://app.bookalyze.com`).
- **Terms and privacy** live once, in the app (`/terms`, `/privacy-policy`); this site's `/terms`,
  `/privacy` and `/privacy-policy` redirect there (`next.config.ts`).
- **Brand:** the design tokens in `src/app/globals.css` are copied from
  `apps/web/src/app/globals.css`; keep the two in step. Light or dark follows the visitor's device.
- **Pictures of the app** (`src/components/previews.tsx`) are drawn with the same tokens, with
  made-up companies and amounts, and loop like GIFs (`anim-*` utilities in `globals.css`; each
  element's own style is the finished state, which is what reduced motion shows). Charts play when
  scrolled into view (`in-view.tsx`, `on-view-*`). The money-flow infographic is `flow.tsx`.
  Never put real company data or screenshots of real books here.
- **Header and footer links** come from `@bookalyze/core` (`site/`), shared with the app's public
  pages (terms, privacy, sign-in) so they look like the same place. Change a link there, not in
  `components/header.tsx` or `footer.tsx`.
- **Content lives in `src/content/`**, as typed data the pages render:
  - `marketplaces.ts`: Amazon, Walmart, Noon, eBay (where, how it connects, what comes in, FAQ,
    guides). Update it when a connection gains a country or feature.
  - `countries.ts`: the six countries and their marketplaces. `pains.ts`: Home's pains → answers.
  - `pricing.ts`: packages and add-ons (keep in step with billing in the app).
  - `guides/`: the knowledge base, one file per category (`start.ts`, `connections.ts`,
    `payouts.ts`, …), collected in `guides/index.ts` (`GUIDES`, `CATEGORIES`, `POPULAR_GUIDES`).
- **Honesty rule:** say only what the app does today (STATUS.md §2). Anything not built says
  "Not yet". No invented statistics, customers or rates; examples say their numbers are made up.

### Adding a guide

1. Add it to the category's file in `src/content/guides/` (format in `types.ts`: blocks `p`,
   `where` ("Commerce → Settlements"), `steps`, `list`, `check` ("What you should see"), `note`
   (tip or caution), `table`; `**bold**` inside text). New file? Add it to `GUIDES` in `index.ts`.
2. Write it from STATUS.md §2: what it's for, where, the steps, what posts, what you should see,
   "Not yet", related guides.
3. `pnpm --filter @bookalyze/marketing test` checks every slug the site links to exists. The page,
   the index, search and the sitemap pick it up on their own.

### Contact form

`/contact` makes a support ticket in the app (`POST SUPPORT_INTAKE_URL` with
`SUPPORT_INTAKE_SECRET`); when that isn't set up or fails, it emails `CONTACT_TO` through
Resend's API (no SDK) with the visitor as reply-to. Spam guards: a hidden
field, a 3-second minimum, and 5 messages per address per 10 minutes (per server instance).

| Variable | Default | |
|---|---|---|
| `RESEND_API_KEY` | none | A sending-only key. Without it: development logs the message and succeeds; production says email isn't set up |
| `CONTACT_TO` | `info@bookalyze.com` | Where messages go |
| `CONTACT_FROM` | `Bookalyze website <website@bookalyze.com>` | A sender on a domain verified in Resend |
| `SUPPORT_INTAKE_URL` | none | The app's intake, `https://app.bookalyze.com/api/support/intake` |
| `SUPPORT_INTAKE_SECRET` | none | The same secret as the app's `SUPPORT_INTAKE_SECRET` |

```bash
pnpm --filter @bookalyze/marketing dev     # http://localhost:3001
pnpm --filter @bookalyze/marketing build
pnpm --filter @bookalyze/marketing test    # guide links
```

Deploying: `docs/SETUP.md` → **Public site**.

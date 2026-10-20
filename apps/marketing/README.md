# Bookalyze public site (bookalyze.com)

The marketing site: Home, Features and Pricing. Next.js, built separately from the app and
deployed as its own Vercel project. It has no database, sign-in or secrets; every page is static.

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
- **Marketplace facts** (where each one works, how it connects, what comes in) are in
  `src/components/marketplaces.tsx`. Update them when a connection gains a country or feature.

```bash
pnpm --filter @bookalyze/marketing dev     # http://localhost:3001
pnpm --filter @bookalyze/marketing build
```

Deploying: `docs/SETUP.md` → **Public site**.

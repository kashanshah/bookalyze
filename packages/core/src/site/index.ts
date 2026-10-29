/**
 * The public header and footer, in one place: the site (bookalyze.com) and the app's public
 * pages (terms, privacy, sign-in) draw them from here, so a visitor sees the same links
 * wherever they are. Each link says which of the two it lives on; `siteHref` turns it into a
 * relative link where it is, and a full address from the other one.
 */

export type SiteLink = { label: string; on: "site" | "app"; path: string };

/** A link in a header menu, with a short line saying what's there. */
export type SiteMenuLink = SiteLink & { hint: string };

/** A top navigation item; one with a `menu` opens it (its own page is the menu's last link). */
export type SiteNavItem = SiteLink & { menu?: readonly SiteMenuLink[] };

/**
 * One link per feature page (`/features/<slug>` on the site), in the site's order. The site's
 * test checks these match its feature pages exactly.
 */
export const SITE_FEATURES: readonly SiteMenuLink[] = [
  {
    label: "Amazon review requests",
    on: "site",
    path: "/features/review-requests",
    hint: "Ask every buyer for a review, automatically",
  },
  {
    label: "Amazon invoices",
    on: "site",
    path: "/features/amazon-invoices",
    hint: "Tax invoices in English and Arabic, in seconds",
  },
  {
    label: "Settlements and payouts",
    on: "site",
    path: "/features/settlements-and-payouts",
    hint: "Every payout posted and matched to your bank",
  },
  {
    label: "Banking and reconciliation",
    on: "site",
    path: "/features/bank-reconciliation",
    hint: "Every account agreeing with its statement",
  },
  {
    label: "Stock and cost of goods sold",
    on: "site",
    path: "/features/stock-and-cost-of-goods",
    hint: "What each sale really cost, freight included",
  },
  {
    label: "Reorder planning",
    on: "site",
    path: "/features/reorder",
    hint: "When to reorder each product, and how many",
  },
  {
    label: "Channel profit",
    on: "site",
    path: "/features/channel-profit",
    hint: "What each marketplace makes after every fee",
  },
  {
    label: "Profit after ads",
    on: "site",
    path: "/features/profit-after-ads",
    hint: "Each product's profit after fees, cost and ads",
  },
  {
    label: "Listing watch",
    on: "site",
    path: "/features/listing-watch",
    hint: "An email when a listing's price or rank changes",
  },
  {
    label: "Bookkeeping",
    on: "site",
    path: "/features/bookkeeping",
    hint: "Real books, without debits and credits",
  },
  {
    label: "Every company you run",
    on: "site",
    path: "/features/multi-company",
    hint: "One login for all of your businesses",
  },
];

/** The site's top navigation. */
export const SITE_NAV: readonly SiteNavItem[] = [
  { label: "Marketplaces", on: "site", path: "/marketplaces" },
  { label: "Features", on: "site", path: "/features", menu: SITE_FEATURES },
  { label: "Pricing", on: "site", path: "/pricing" },
  { label: "Guides", on: "site", path: "/guides" },
  { label: "Help", on: "site", path: "/help" },
];

export const SIGN_IN: SiteLink = { label: "Sign in", on: "app", path: "/sign-in" };
export const START_FREE: SiteLink = { label: "Start free", on: "app", path: "/sign-up" };
export const TERMS: SiteLink = { label: "Terms of service", on: "app", path: "/terms" };
export const PRIVACY: SiteLink = { label: "Privacy policy", on: "app", path: "/privacy-policy" };
export const CONTACT: SiteLink = { label: "Contact", on: "site", path: "/contact" };

/** The countries the site has a page for, in the footer's order. */
export const SITE_COUNTRIES: readonly { name: string; slug: string }[] = [
  { name: "United States", slug: "united-states" },
  { name: "Canada", slug: "canada" },
  { name: "Mexico", slug: "mexico" },
  { name: "United Arab Emirates", slug: "uae" },
  { name: "Saudi Arabia", slug: "saudi-arabia" },
  { name: "Egypt", slug: "egypt" },
];

export const SITE_FOOTER_COLUMNS: readonly { title: string; links: readonly SiteLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Marketplaces", on: "site", path: "/marketplaces" },
      { label: "Features", on: "site", path: "/features" },
      { label: "Review requests", on: "site", path: "/features/review-requests" },
      { label: "Amazon invoices", on: "site", path: "/features/amazon-invoices" },
      { label: "Pricing", on: "site", path: "/pricing" },
      START_FREE,
      SIGN_IN,
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Guides", on: "site", path: "/guides" },
      { label: "Help & support", on: "site", path: "/help" },
      CONTACT,
    ],
  },
  {
    title: "Sellers in",
    links: SITE_COUNTRIES.map((c) => ({
      label: c.name,
      on: "site" as const,
      path: `/sellers/${c.slug}`,
    })),
  },
  { title: "Company", links: [TERMS, PRIVACY] },
];

export const SITE_TAGLINE =
  "Accounting built for Amazon, Walmart and Noon sellers, and eBay too, for every company you run.";

export const SITE_TRADEMARKS =
  "Amazon, Walmart, Noon, eBay and Wise are trademarks of their owners; Bookalyze isn't made or endorsed by them.";

/** A link's address from `here`: relative on its own side, absolute from the other. */
export function siteHref(
  link: SiteLink,
  here: "site" | "app",
  urls: { site: string; app: string },
): string {
  if (link.on === here) return link.path;
  return `${(link.on === "site" ? urls.site : urls.app).replace(/\/$/, "")}${link.path}`;
}

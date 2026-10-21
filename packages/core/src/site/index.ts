/**
 * The public header and footer, in one place: the site (bookalyze.com) and the app's public
 * pages (terms, privacy, sign-in) draw them from here, so a visitor sees the same links
 * wherever they are. Each link says which of the two it lives on; `siteHref` turns it into a
 * relative link where it is, and a full address from the other one.
 */

export type SiteLink = { label: string; on: "site" | "app"; path: string };

/** The site's top navigation. */
export const SITE_NAV: readonly SiteLink[] = [
  { label: "Marketplaces", on: "site", path: "/marketplaces" },
  { label: "Features", on: "site", path: "/features" },
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

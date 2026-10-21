import { COUNTRIES } from "../content/countries";
import { FEATURES } from "../content/features";
import { GUIDES } from "../content/guides";
import { MARKETPLACES } from "../content/marketplaces";
import { SITE_URL } from "./site";

export type SitemapEntry = { url: string; priority: number };

/** Every public page, most important first. */
export function sitemapEntries(base = SITE_URL): SitemapEntry[] {
  const pages: { path: string; priority: number }[] = [
    { path: "", priority: 1 },
    { path: "/features", priority: 0.8 },
    ...FEATURES.map((f) => ({ path: `/features/${f.slug}`, priority: 0.7 })),
    { path: "/pricing", priority: 0.8 },
    { path: "/marketplaces", priority: 0.8 },
    ...MARKETPLACES.map((m) => ({ path: `/marketplaces/${m.slug}`, priority: 0.8 })),
    { path: "/sellers", priority: 0.7 },
    ...COUNTRIES.map((c) => ({ path: `/sellers/${c.slug}`, priority: 0.8 })),
    { path: "/guides", priority: 0.7 },
    ...GUIDES.map((g) => ({ path: `/guides/${g.slug}`, priority: 0.6 })),
    { path: "/help", priority: 0.6 },
    { path: "/contact", priority: 0.5 },
  ];
  return pages.map(({ path, priority }) => ({ url: `${base}${path}`, priority }));
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * The sitemap as XML. Search engines read it as usual; the stylesheet line makes browsers show
 * it as a readable page (public/sitemap.xsl).
 */
export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map(
    (e) =>
      `  <url>\n    <loc>${escapeXml(e.url)}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

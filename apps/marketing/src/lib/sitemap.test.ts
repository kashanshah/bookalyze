import { describe, expect, it } from "vitest";
import { GUIDES } from "../content/guides";
import { sitemapEntries, sitemapXml } from "./sitemap";

describe("sitemap", () => {
  it("lists every page once, on the site's address", () => {
    const entries = sitemapEntries("https://bookalyze.com");
    const urls = entries.map((e) => e.url);
    expect(urls[0]).toBe("https://bookalyze.com");
    expect(new Set(urls).size).toBe(urls.length);
    for (const g of GUIDES) expect(urls).toContain(`https://bookalyze.com/guides/${g.slug}`);
  });

  it("is valid sitemap XML with the stylesheet for browsers", () => {
    const xml = sitemapXml([
      { url: "https://bookalyze.com", priority: 1 },
      { url: "https://bookalyze.com/a?b=1&c=2", priority: 0.6 },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://bookalyze.com/a?b=1&amp;c=2</loc>");
    expect(xml).toContain("<priority>1.0</priority>");
    expect(xml).toContain("<priority>0.6</priority>");
  });
});

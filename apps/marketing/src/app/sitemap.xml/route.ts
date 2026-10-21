import { sitemapEntries, sitemapXml } from "@/lib/sitemap";

// Built once at build time, like the rest of the site.
export const dynamic = "force-static";

export function GET() {
  return new Response(sitemapXml(sitemapEntries()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

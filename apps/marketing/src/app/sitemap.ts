import type { MetadataRoute } from "next";
import { COUNTRIES } from "@/content/countries";
import { GUIDES } from "@/content/guides";
import { MARKETPLACES } from "@/content/marketplaces";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: { path: string; priority: number }[] = [
    { path: "", priority: 1 },
    { path: "/features", priority: 0.8 },
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
  return pages.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "monthly",
    priority,
  }));
}

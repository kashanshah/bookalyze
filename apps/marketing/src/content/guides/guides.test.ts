import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETPLACES } from "../marketplaces";
import { PAINS } from "../pains";
import { CATEGORIES, GUIDES, guide, POPULAR_GUIDES } from ".";

/** Every .ts and .tsx file under src, for links written into pages. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("guides", () => {
  it("have unique slugs in known categories", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const categories = new Set(CATEGORIES.map((c) => c.id));
    for (const g of GUIDES) expect(categories.has(g.category), g.slug).toBe(true);
  });

  it("every category has at least one guide", () => {
    for (const c of CATEGORIES) {
      expect(
        GUIDES.some((g) => g.category === c.id),
        c.id,
      ).toBe(true);
    }
  });

  it("every guide has sections with content", () => {
    for (const g of GUIDES) {
      expect(g.sections.length, g.slug).toBeGreaterThan(0);
      for (const s of g.sections)
        expect(s.blocks.length, `${g.slug}: ${s.heading}`).toBeGreaterThan(0);
    }
  });

  it("related guides exist and aren't the guide itself", () => {
    for (const g of GUIDES) {
      for (const slug of g.related ?? []) {
        expect(guide(slug), `${g.slug} → ${slug}`).toBeDefined();
        expect(slug).not.toBe(g.slug);
      }
    }
  });

  it("guides linked from content exist", () => {
    const linked = [
      ...POPULAR_GUIDES,
      ...PAINS.map((p) => p.guide),
      ...MARKETPLACES.flatMap((m) => [...m.guides, `connect-${m.slug}`]),
    ];
    for (const slug of linked) expect(guide(slug), slug).toBeDefined();
  });

  it("guides linked from pages exist", () => {
    const root = join(import.meta.dirname, "../..");
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      const slugs = [
        ...text.matchAll(/["`]\/guides\/([a-z0-9-]+)[#"`?]/g),
        ...text.matchAll(/guide="([a-z0-9-]+)"/g),
      ].map((m) => m[1] ?? "");
      for (const slug of slugs) expect(guide(slug), `${file}: ${slug}`).toBeDefined();
    }
  });
});

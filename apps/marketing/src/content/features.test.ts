import { BILLING_PACKAGES, SITE_FEATURES } from "@bookalyze/core";
import { describe, expect, it } from "vitest";
import { FEATURES } from "./features";
import { guide } from "./guides";

describe("feature pages", () => {
  it("each has its own address and at least one plan that includes it", () => {
    const slugs = FEATURES.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const f of FEATURES) {
      const plans = Object.values(BILLING_PACKAGES).filter((p) => p.modules.includes(f.module));
      expect(plans.length, f.slug).toBeGreaterThan(0);
    }
  });

  it("links only to guides that exist, and says how it works", () => {
    for (const f of FEATURES) {
      expect(f.guides.length, f.slug).toBeGreaterThan(0);
      for (const slug of f.guides) expect(guide(slug), `${f.slug} → ${slug}`).toBeDefined();
      expect(f.steps).toHaveLength(3);
      expect(f.sections.length).toBeGreaterThan(0);
      expect(f.faq.length).toBeGreaterThan(0);
    }
  });

  it("are all in the header's Features menu, in the same order and with the same names", () => {
    expect(SITE_FEATURES.map((l) => [l.path, l.label])).toEqual(
      FEATURES.map((f) => [`/features/${f.slug}`, f.name]),
    );
    for (const l of SITE_FEATURES) expect(l.hint.length, l.path).toBeLessThanOrEqual(52);
  });
});

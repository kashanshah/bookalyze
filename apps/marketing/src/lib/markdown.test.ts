import { describe, expect, it } from "vitest";
import { FEATURES } from "../content/features";
import { GUIDES, guide } from "../content/guides";
import { featureMarkdown, guideMarkdown, llmsFullTxt, llmsTxt } from "./markdown";

describe("markdown for AI assistants", () => {
  it("writes a guide's sections, tables, steps, notes and related guides", () => {
    const g = guide("acos-tacos-break-even");
    if (!g) throw new Error("missing guide");
    const md = guideMarkdown(g, "https://example.test");
    expect(md).toMatch(/^# ACOS, TACOS/);
    expect(md).toContain("## One product's month");
    expect(md).toContain("| Number | Formula | Read it as |");
    expect(md).toContain("> **Caution:**");
    expect(md).toContain("](https://example.test/guides/profit-after-ads.md)");
  });

  it("writes a feature with its questions", () => {
    const f = FEATURES.find((x) => x.slug === "profit-after-ads");
    if (!f) throw new Error("missing feature");
    const md = featureMarkdown(f);
    expect(md).toContain("## Questions");
    expect(md).toContain("### Will ad costs be counted twice with my settlements?");
  });

  it("lists every guide and feature in llms.txt, and includes them all in llms-full.txt", () => {
    const index = llmsTxt("https://example.test");
    const full = llmsFullTxt("https://example.test");
    for (const g of GUIDES) {
      expect(index).toContain(`(https://example.test/guides/${g.slug}.md)`);
      expect(full).toContain(`# ${g.title}`);
    }
    for (const f of FEATURES) expect(index).toContain(`/features/${f.slug}.md`);
    // A table cell's own "|" doesn't break the table.
    expect(full).not.toMatch(/\| [^|\n]*[^\\]\|[^ |\n]/);
  });
});

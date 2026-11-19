import { describe, expect, it } from "vitest";
import { SIGN_IN, SITE_FOOTER_COLUMNS, SITE_NAV, siteHref, TERMS } from "../site";

const urls = { site: "https://bookalyze.com", app: "https://app.bookalyze.com/" };

describe("shared site links", () => {
  it("are relative where they live and absolute from the other side", () => {
    const marketplaces = SITE_NAV.find((l) => l.path === "/marketplaces") ?? SIGN_IN;
    expect(siteHref(marketplaces, "site", urls)).toBe("/marketplaces");
    expect(siteHref(marketplaces, "app", urls)).toBe("https://bookalyze.com/marketplaces");
    expect(siteHref(SIGN_IN, "app", urls)).toBe("/sign-in");
    expect(siteHref(TERMS, "site", urls)).toBe("https://app.bookalyze.com/terms");
  });

  it("lead with AI assistants, the headline feature", () => {
    expect(SITE_NAV[0]?.path).toBe("/features/ai-assistants");
  });

  it("have no duplicate labels within a column", () => {
    for (const col of SITE_FOOTER_COLUMNS) {
      const labels = col.links.map((l) => l.label);
      expect(new Set(labels).size, col.title).toBe(labels.length);
    }
  });
});

import { describe, expect, it } from "vitest";
import { SIGN_IN, SITE_FOOTER_COLUMNS, SITE_NAV, siteHref, TERMS } from "../site";

const urls = { site: "https://bookalyze.com", app: "https://app.bookalyze.com/" };

describe("shared site links", () => {
  it("are relative where they live and absolute from the other side", () => {
    expect(siteHref(SITE_NAV[0] ?? SIGN_IN, "site", urls)).toBe("/marketplaces");
    expect(siteHref(SITE_NAV[0] ?? SIGN_IN, "app", urls)).toBe(
      "https://bookalyze.com/marketplaces",
    );
    expect(siteHref(SIGN_IN, "app", urls)).toBe("/sign-in");
    expect(siteHref(TERMS, "site", urls)).toBe("https://app.bookalyze.com/terms");
  });

  it("have no duplicate labels within a column", () => {
    for (const col of SITE_FOOTER_COLUMNS) {
      const labels = col.links.map((l) => l.label);
      expect(new Set(labels).size, col.title).toBe(labels.length);
    }
  });
});

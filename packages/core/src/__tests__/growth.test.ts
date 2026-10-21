import { describe, expect, it } from "vitest";
import {
  decodeSource,
  encodeSource,
  funnelRates,
  isOwnHost,
  readCookie,
  shouldReplace,
  sourceFromVisit,
  sourceLabel,
} from "../growth";

describe("sourceFromVisit", () => {
  it("reads utm tags and the landing page", () => {
    expect(
      sourceFromVisit(
        "https://bookalyze.com/features/review-requests?utm_source=Newsletter&utm_medium=Email&utm_campaign=Oct",
        "",
      ),
    ).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "Oct",
      referrer: null,
      landing: "/features/review-requests",
    });
  });
  it("turns ad click ids into a source", () => {
    expect(sourceFromVisit("https://bookalyze.com/?gclid=abc", "")).toMatchObject({
      source: "google",
      medium: "cpc",
    });
    expect(sourceFromVisit("https://bookalyze.com/?fbclid=abc", "")).toMatchObject({
      source: "facebook",
      medium: null,
    });
  });
  it("keeps other sites as the referrer, never our own", () => {
    expect(sourceFromVisit("https://bookalyze.com/", "https://www.google.com/")?.referrer).toBe(
      "google.com",
    );
    expect(
      sourceFromVisit("https://app.bookalyze.com/sign-up", "https://bookalyze.com/pricing")
        ?.referrer,
    ).toBeNull();
    expect(
      sourceFromVisit("http://localhost:3000/sign-up", "http://localhost:3001/", ["localhost"])
        ?.referrer,
    ).toBeNull();
  });
  it("ignores an address that isn't one", () => {
    expect(sourceFromVisit("not a url", "")).toBeNull();
  });
});

describe("shouldReplace", () => {
  const direct = { source: null, medium: null, campaign: null, referrer: null, landing: "/" };
  const ad = { ...direct, source: "google" };
  it("keeps the first source, but lets a source replace a direct visit", () => {
    expect(shouldReplace(null, direct)).toBe(true);
    expect(shouldReplace(direct, ad)).toBe(true);
    expect(shouldReplace(ad, { ...direct, source: "bing" })).toBe(false);
    expect(shouldReplace(ad, direct)).toBe(false);
    expect(shouldReplace(direct, null)).toBe(false);
  });
});

describe("the cookie", () => {
  it("survives a round trip and refuses junk", () => {
    const s = {
      source: "google",
      medium: "cpc",
      campaign: "Spring; sale=1",
      referrer: null,
      landing: "/pricing",
    };
    const header = `a=1; bkz_src=${encodeSource(s)}; b=2`;
    expect(decodeSource(readCookie(header, "bkz_src"))).toEqual(s);
    expect(decodeSource("%7Bnot json")).toBeNull();
    expect(decodeSource(null)).toBeNull();
    expect(readCookie(null, "bkz_src")).toBeNull();
  });
  it("clips long values", () => {
    const long = decodeSource(encodeURIComponent(JSON.stringify({ s: "x".repeat(500) })));
    expect(long?.source).toHaveLength(100);
  });
});

describe("labels and rates", () => {
  it("labels by source, then referrer, then Direct", () => {
    expect(sourceLabel({ source: "google", referrer: "bing.com" })).toBe("google");
    expect(sourceLabel({ source: null, referrer: "bing.com" })).toBe("bing.com");
    expect(sourceLabel(null)).toBe("Direct");
    expect(isOwnHost("app.bookalyze.com")).toBe(true);
    expect(isOwnHost("notbookalyze.com")).toBe(false);
  });
  it("gives each step's share of the first and of the previous", () => {
    const rates = funnelRates([
      { key: "a", label: "Signed up", count: 40 },
      { key: "b", label: "Verified", count: 30 },
      { key: "c", label: "Paying", count: 0 },
      { key: "d", label: "Cancelled", count: 0 },
    ]);
    expect(rates.map((r) => [r.ofFirst, r.ofPrevious])).toEqual([
      [100, null],
      [75, 75],
      [0, 0],
      [0, null],
    ]);
    expect(funnelRates([{ key: "a", label: "x", count: 0 }])[0]?.ofFirst).toBeNull();
  });
});

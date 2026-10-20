import { describe, expect, it } from "vitest";
import {
  clampLetterheadMargin,
  hexToRgb,
  isDarkColor,
  LETTERHEAD_MARGIN_MAX,
  normalizeHexColor,
} from "../commerce/brand";

describe("normalizeHexColor", () => {
  it("accepts six- and three-digit colours, with or without #", () => {
    expect(normalizeHexColor("#1f6feb")).toBe("#1F6FEB");
    expect(normalizeHexColor("1f6feb")).toBe("#1F6FEB");
    expect(normalizeHexColor("#abc")).toBe("#AABBCC");
  });

  it("rejects anything else", () => {
    expect(normalizeHexColor("blue")).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });
});

describe("hexToRgb and isDarkColor", () => {
  it("reads channels as 0–1", () => {
    expect(hexToRgb("#FF0000")).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("tells dark accents from light ones", () => {
    expect(isDarkColor("#1F2937")).toBe(true);
    expect(isDarkColor("#FACC15")).toBe(false);
  });
});

describe("clampLetterheadMargin", () => {
  it("keeps margins in range", () => {
    expect(clampLetterheadMargin(-5)).toBe(0);
    expect(clampLetterheadMargin(1000)).toBe(LETTERHEAD_MARGIN_MAX);
    expect(clampLetterheadMargin(120.6)).toBe(121);
  });
});

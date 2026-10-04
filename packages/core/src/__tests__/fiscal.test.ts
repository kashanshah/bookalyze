import { describe, expect, it } from "vitest";
import {
  fiscalQuarters,
  fiscalYearFor,
  previousFiscalYear,
  validateFiscalYearEnd,
} from "../fiscal";

const calendar = { endMonth: 12, endDay: 31 };
const julyToJune = { endMonth: 6, endDay: 30 };

describe("fiscalYearFor", () => {
  it("handles a calendar fiscal year", () => {
    expect(fiscalYearFor("2026-10-04", calendar)).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
      label: "FY2026",
      isShortFirstYear: false,
    });
  });

  it("handles a July–June fiscal year (e.g. Pakistan)", () => {
    expect(fiscalYearFor("2026-10-04", julyToJune)).toMatchObject({
      start: "2026-07-01",
      end: "2027-06-30",
      label: "FY2026-27",
    });
    expect(fiscalYearFor("2026-06-30", julyToJune)).toMatchObject({
      start: "2025-07-01",
      end: "2026-06-30",
      label: "FY2025-26",
    });
  });

  it("produces a short first year from the first fiscal year start", () => {
    const cfg = { ...calendar, firstFiscalYearStart: "2026-06-23" };
    expect(fiscalYearFor("2026-10-04", cfg)).toEqual({
      start: "2026-06-23",
      end: "2026-12-31",
      label: "FY2026",
      isShortFirstYear: true,
    });
    // Later years are full years.
    expect(fiscalYearFor("2027-03-01", cfg)).toMatchObject({
      start: "2027-01-01",
      isShortFirstYear: false,
    });
  });

  it("keeps the full-year label for a short first year spanning two calendar years", () => {
    const cfg = { ...julyToJune, firstFiscalYearStart: "2027-01-15" };
    expect(fiscalYearFor("2027-02-01", cfg)).toMatchObject({
      start: "2027-01-15",
      end: "2027-06-30",
      label: "FY2026-27",
      isShortFirstYear: true,
    });
  });

  it("clamps a 29 Feb year end in non-leap years", () => {
    const cfg = { endMonth: 2, endDay: 29 };
    expect(fiscalYearFor("2027-01-10", cfg)).toMatchObject({
      start: "2026-03-01",
      end: "2027-02-28",
    });
    expect(fiscalYearFor("2028-01-10", cfg)).toMatchObject({
      start: "2027-03-01",
      end: "2028-02-29",
    });
  });

  it("rejects invalid year ends", () => {
    expect(validateFiscalYearEnd(4, 31)).toBe("Day must be 1–30");
    expect(validateFiscalYearEnd(13, 1)).toBe("Month must be 1–12");
    expect(validateFiscalYearEnd(2, 29)).toBeNull();
  });
});

describe("previousFiscalYear", () => {
  it("returns the year before", () => {
    expect(previousFiscalYear("2026-10-04", julyToJune)).toMatchObject({
      start: "2025-07-01",
      end: "2026-06-30",
    });
  });
});

describe("fiscalQuarters", () => {
  it("splits the fiscal year into four quarters", () => {
    expect(fiscalQuarters("2026-10-04", julyToJune).map((q) => [q.start, q.end, q.label])).toEqual([
      ["2026-07-01", "2026-09-30", "FY2026-27 Q1"],
      ["2026-10-01", "2026-12-31", "FY2026-27 Q2"],
      ["2027-01-01", "2027-03-31", "FY2026-27 Q3"],
      ["2027-04-01", "2027-06-30", "FY2026-27 Q4"],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { pageCount, pageNumbers, readPaging } from "../pagination";

describe("readPaging", () => {
  it("reads the page and an allowed page size, else the defaults", () => {
    expect(readPaging({ page: "3", per: "100" })).toEqual({ page: 3, perPage: 100, offset: 200 });
    expect(readPaging({})).toEqual({ page: 1, perPage: 50, offset: 0 });
    expect(readPaging({ page: "0", per: "37" })).toEqual({ page: 1, perPage: 50, offset: 0 });
    expect(readPaging({ page: "x", per: "25" }, 50)).toEqual({ page: 1, perPage: 25, offset: 0 });
    expect(readPaging({ page: ["2", "9"] }, 25)).toEqual({ page: 2, perPage: 25, offset: 25 });
  });
});

describe("pageCount", () => {
  it("is at least one", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
  });
});

describe("pageNumbers", () => {
  it("shows the first two, the last two and the pages around the current one", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(1, 20)).toEqual([1, 2, "gap", 19, 20]);
    expect(pageNumbers(10, 20)).toEqual([1, 2, "gap", 9, 10, 11, "gap", 19, 20]);
    expect(pageNumbers(20, 20)).toEqual([1, 2, "gap", 19, 20]);
    // A single skipped page is shown rather than a gap.
    expect(pageNumbers(5, 20)).toEqual([1, 2, 3, 4, 5, 6, "gap", 19, 20]);
    expect(pageNumbers(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 19, 20]);
  });
});

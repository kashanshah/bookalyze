import { describe, expect, it } from "vitest";
import {
  estimateForeignAmount,
  type MisrecordedLine,
  matchStatementAmounts,
  type StatementLine,
} from "../banking/amount-fix";

const rate = () => "1.4100000000";
const line = (lineId: string, date: string, baseAmount: string, text = ""): MisrecordedLine => ({
  lineId,
  date,
  baseAmount,
  text,
});
const wise = (externalId: string, date: string, amount: string, text = ""): StatementLine => ({
  externalId,
  date,
  amount,
  text,
});

describe("estimateForeignAmount", () => {
  it("converts at the rate and rounds to the currency's cents", () => {
    expect(estimateForeignAmount("-173.62", "1.41", "USD")).toBe("-123.1300");
    expect(estimateForeignAmount("173.62", null, "USD")).toBeNull();
  });
});

describe("matchStatementAmounts", () => {
  it("finds the real amount: same direction, a few days apart, close to the converted value", () => {
    const fixes = matchStatementAmounts(
      [line("a", "2026-09-24", "-173.62", "Ahsan Ahmed (Sent)")],
      [
        wise("w1", "2026-09-24", "-123.00", "Sent money to Ahsan Ahmed"),
        wise("w2", "2026-09-24", "123.00", "Received money"),
        wise("w3", "2026-09-10", "-123.00", "Too early"),
      ],
      rate,
      "USD",
    );
    expect(fixes).toEqual([
      {
        lineId: "a",
        status: "matched",
        match: wise("w1", "2026-09-24", "-123.00", "Sent money to Ahsan Ahmed"),
        estimate: "-123.1300",
      },
    ]);
  });

  it("uses each statement line once, settling the obvious ones first", () => {
    const fixes = matchStatementAmounts(
      [line("a", "2026-03-02", "-141.00"), line("b", "2026-03-03", "-141.00")],
      [wise("w1", "2026-03-02", "-100.00"), wise("w2", "2026-03-09", "-100.00")],
      rate,
      "USD",
    );
    // w2 is 6 days from b: too far, so b has nothing left once a takes w1.
    expect(fixes.map((f) => [f.lineId, f.status])).toEqual([
      ["a", "matched"],
      ["b", "unmatched"],
    ]);
  });

  it("lets the description decide between look-alikes, and otherwise asks", () => {
    const statement = [
      wise("w1", "2026-05-01", "-50.00", "Card transaction at Coffee House"),
      wise("w2", "2026-05-01", "-50.00", "Card transaction at Book Shop"),
    ];
    const byText = matchStatementAmounts(
      [line("a", "2026-05-01", "-70.50", "Book Shop downtown")],
      statement,
      rate,
      "USD",
    );
    expect(byText[0]).toMatchObject({ status: "matched", match: { externalId: "w2" } });
    const unclear = matchStatementAmounts(
      [line("a", "2026-05-01", "-70.50", "Card purchase")],
      statement,
      rate,
      "USD",
    );
    expect(unclear[0]).toMatchObject({ status: "ambiguous" });
    expect(unclear[0]?.status === "ambiguous" && unclear[0].candidates.length).toBe(2);
  });

  it("leaves lines with no fitting statement line, and lines without a rate, unmatched", () => {
    expect(
      matchStatementAmounts(
        [line("a", "2026-05-01", "-70.50")],
        [wise("w", "2026-05-01", "-80")],
        rate,
        "USD",
      )[0],
    ).toMatchObject({ status: "unmatched", estimate: "-50.0000" });
    expect(
      matchStatementAmounts(
        [line("a", "2026-05-01", "-70.50")],
        [wise("w", "2026-05-01", "-50")],
        () => null,
        "USD",
      )[0],
    ).toMatchObject({ status: "unmatched", estimate: null });
  });
});

import { describe, expect, it } from "vitest";
import type { MergeCandidate } from "../accounting/merge";
import {
  pairTransfers,
  type TransferCandidate,
  transferMatchProblem,
} from "../accounting/transfer-match";

const side = (
  entryId: string,
  accountId: string,
  amount: string,
  date = "2026-03-02",
  over: Partial<TransferCandidate> = {},
): TransferCandidate => ({
  entryId,
  date,
  accountId,
  currency: "CAD",
  amount,
  baseAmount: amount,
  ...over,
});

describe("pairTransfers", () => {
  it("pairs money out of one account with the same money into another", () => {
    expect(
      pairTransfers([
        side("out", "chequing", "-500"),
        side("in", "visa", "500", "2026-03-04"),
        side("coffee", "chequing", "-4.50"),
      ]),
    ).toEqual([{ outId: "out", inId: "in" }]);
  });

  it("needs the same amount, different accounts and a few days at most", () => {
    expect(pairTransfers([side("a", "chequing", "-500"), side("b", "visa", "499.99")])).toEqual([]);
    expect(pairTransfers([side("a", "chequing", "-500"), side("b", "chequing", "500")])).toEqual(
      [],
    );
    expect(
      pairTransfers([side("a", "chequing", "-500"), side("b", "visa", "500", "2026-03-08")]),
    ).toEqual([]);
  });

  it("uses each transaction once, closest date first", () => {
    expect(
      pairTransfers([
        side("out", "chequing", "-200", "2026-03-02"),
        side("far", "visa", "200", "2026-03-06"),
        side("near", "savings", "200", "2026-03-03"),
      ]),
    ).toEqual([{ outId: "out", inId: "near" }]);
  });

  it("compares different currencies by their main-currency value, within a few percent", () => {
    const out = side("cad", "wise-cad", "-1370", "2026-03-02");
    const usd = (entryId: string, base: string) =>
      side(entryId, "wise-usd", "1000", "2026-03-02", { currency: "USD", baseAmount: base });
    expect(pairTransfers([out, usd("usd", "1365.20")])).toEqual([{ outId: "cad", inId: "usd" }]);
    expect(pairTransfers([out, usd("usd", "1200")])).toEqual([]);
  });

  it("skips pairs someone said aren't transfers", () => {
    expect(
      pairTransfers(
        [side("out", "chequing", "-500"), side("in", "visa", "500")],
        (p) => p.outId === "out" && p.inId === "in",
      ),
    ).toEqual([]);
  });
});

const tx = (over: Partial<MergeCandidate> = {}): MergeCandidate => ({
  kind: "withdrawal",
  amount: "500",
  currency: "CAD",
  moneyAccountIds: ["chequing"],
  splits: [{ accountId: "uncategorized", amount: "500" }],
  ...over,
});

describe("transferMatchProblem", () => {
  it("allows money out of one account and the same money into another", () => {
    expect(
      transferMatchProblem(tx(), tx({ kind: "deposit", moneyAccountIds: ["visa"] })),
    ).toBeNull();
    // Between currencies the amounts differ.
    expect(
      transferMatchProblem(
        tx(),
        tx({ kind: "deposit", moneyAccountIds: ["usd"], currency: "USD", amount: "365" }),
      ),
    ).toBeNull();
  });

  it("explains what's missing", () => {
    expect(transferMatchProblem(tx(), tx({ moneyAccountIds: ["visa"] }))).toMatch(/went out/);
    expect(transferMatchProblem(tx(), tx({ kind: "deposit" }))).toMatch(/same account/);
    expect(
      transferMatchProblem(tx(), tx({ kind: "deposit", moneyAccountIds: ["visa"], amount: "5" })),
    ).toMatch(/same amount/);
    expect(transferMatchProblem(tx({ kind: "transfer" }), tx({ kind: "deposit" }))).toMatch(
      /already a transfer/,
    );
  });
});

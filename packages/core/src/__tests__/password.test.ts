import { describe, expect, it } from "vitest";
import { PASSWORD_MESSAGES, passwordError, passwordProblems } from "../index";

describe("password rules", () => {
  it("accepts long passphrases, unrelated to the person", () => {
    for (const p of ["correct-horse-battery", "another-strong-pass", "Maple syrup on Tuesdays"]) {
      expect(passwordProblems(p, { email: "owner@example.com", name: "Olivia Owner" })).toEqual([]);
    }
  });

  it("needs 12 to 128 characters, counted as characters", () => {
    expect(passwordProblems("short-pass")).toContain("length");
    expect(passwordProblems("x".repeat(129))).toContain("too_long");
    // 12 emoji are 12 characters, not 48 bytes.
    expect(passwordProblems("🍁🌲🦫🏒🍁🌲🦫🏒🍁🌲🦫🏒")).not.toContain("length");
  });

  it("refuses common passwords, with digits, symbols or swapped letters", () => {
    for (const p of [
      "password1234",
      "Password2026!",
      "P4ssw0rd!!!!",
      "!!qwerty123456",
      "qwertyuiopasdf",
      "123456789012",
      "aaaaaaaaaaaa",
      "abcabcabcabc",
      "zyxwvutsrqpo",
      "iloveyou2026",
      "amazonseller1",
    ]) {
      expect(passwordProblems(p), p).toContain("common");
    }
  });

  it("refuses the person's name, email or Bookalyze", () => {
    const who = { email: "kashan.shah@teknoffice.com", name: "Kashan Shah" };
    expect(passwordProblems("kashanshah-2026-ok", who)).toContain("personal");
    expect(passwordProblems("my-K4shan-password-x", who)).toContain("personal");
    expect(passwordProblems("bookalyze-is-great", who)).toContain("personal");
    // Short pieces (under 4 letters) don't count: "Shah" does, "Al" wouldn't.
    expect(passwordProblems("fresh-oranges-daily", { name: "Al Ng" })).toEqual([]);
  });

  it("says the first problem in plain words", () => {
    expect(passwordError("short")).toBe(PASSWORD_MESSAGES.length);
    expect(passwordError("long-and-fine-words")).toBeNull();
  });
});

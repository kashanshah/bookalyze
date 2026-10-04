import { describe, expect, it } from "vitest";
import { activeModules, can, INTERNAL_UNLIMITED_PLAN } from "../modules/entitlements";
import { MODULE_KEYS, modules, toggleModule } from "../modules/registry";

describe("module registry", () => {
  it("only references known modules as dependencies", () => {
    for (const m of Object.values(modules)) {
      for (const dep of m.requires) expect(MODULE_KEYS).toContain(dep);
    }
  });

  it("enables a module when its dependencies are on", () => {
    expect(toggleModule(["accounting"], "commerce", true)).toEqual({
      ok: true,
      enabled: ["accounting", "commerce"],
    });
  });

  it("refuses to enable a module with missing dependencies", () => {
    const result = toggleModule(["accounting"], "reviews", true);
    expect(result).toMatchObject({ ok: false, blocking: ["commerce"] });
  });

  it("refuses to disable a module others depend on", () => {
    const result = toggleModule(["accounting", "banking"], "accounting", false);
    expect(result).toMatchObject({ ok: false, blocking: ["banking"] });
  });

  it("refuses modules the plan does not allow", () => {
    const result = toggleModule([], "accounting", true, []);
    expect(result.ok).toBe(false);
  });
});

describe("entitlements", () => {
  it("intersects plan modules with enabled modules", () => {
    expect(activeModules(INTERNAL_UNLIMITED_PLAN, ["banking", "accounting"])).toEqual([
      "accounting",
      "banking",
    ]);
    expect(
      activeModules({ key: "x", name: "X", modules: ["accounting"] }, ["accounting", "banking"]),
    ).toEqual(["accounting"]);
  });

  it("checks features through active modules", () => {
    expect(
      can(INTERNAL_UNLIMITED_PLAN, ["accounting", "commerce", "reviews"], "reviews.bulk"),
    ).toBe(true);
    expect(can(INTERNAL_UNLIMITED_PLAN, ["accounting"], "reviews.bulk")).toBe(false);
  });
});

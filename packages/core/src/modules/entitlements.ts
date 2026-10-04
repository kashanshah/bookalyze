import { MODULE_KEYS, type ModuleKey, modules } from "./registry";

export type Plan = {
  key: string;
  name: string;
  modules: readonly ModuleKey[];
};

/** Every organization is on this plan until billing exists. */
export const INTERNAL_UNLIMITED_PLAN: Plan = {
  key: "internal_unlimited",
  name: "Free (unlimited)",
  modules: MODULE_KEYS,
};

export const PLANS: Record<string, Plan> = {
  [INTERNAL_UNLIMITED_PLAN.key]: INTERNAL_UNLIMITED_PLAN,
};

export function getPlan(key: string | null | undefined): Plan {
  return (key && PLANS[key]) || INTERNAL_UNLIMITED_PLAN;
}

/** Modules that are both allowed by the plan and switched on by the organization. */
export function activeModules(plan: Plan, enabled: readonly ModuleKey[]): ModuleKey[] {
  return MODULE_KEYS.filter((m) => plan.modules.includes(m) && enabled.includes(m));
}

/** Whether a feature (e.g. "reviews.bulk") is available to the organization. */
export function can(plan: Plan, enabled: readonly ModuleKey[], feature: string): boolean {
  return activeModules(plan, enabled).some((m) => modules[m].features.includes(feature));
}

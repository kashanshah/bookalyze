/**
 * Module registry. Every product area is a module with a manifest. Whether a module is active
 * for an organization is decided by two layers:
 *   plan entitlements (what the plan allows) ∩ org module toggles (what the org switched on).
 */

export const MODULE_KEYS = [
  "accounting",
  "banking",
  "commerce",
  "inventory",
  "reviews",
  "analytics",
  "entity",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type NavItem = {
  label: string;
  /** Path relative to the organization root, e.g. "/accounting/transactions". */
  href: string;
};

export type ModuleManifest = {
  key: ModuleKey;
  label: string;
  description: string;
  /** URL segment under the organization root, e.g. "/accounting". Nav hrefs start with it. */
  basePath: string;
  /** Roadmap phase in which the module ships (see docs/PLAN.md). */
  phase: string;
  /** Modules that must be enabled for this one to be enabled. */
  requires: ModuleKey[];
  /** Fine-grained feature keys this module provides (used for plan gating). */
  features: string[];
  nav: NavItem[];
  /** Built and usable today, or listed as coming soon. */
  status: "available" | "coming_soon";
};

export const modules: Record<ModuleKey, ModuleManifest> = {
  accounting: {
    key: "accounting",
    label: "Accounting",
    description:
      "Chart of accounts, transactions, receipts, reconciliation, sales tax, journal entries and financial reports.",
    basePath: "/accounting",
    phase: "1",
    requires: [],
    features: ["accounting.core", "accounting.reports", "accounting.import"],
    nav: [
      { label: "Transactions", href: "/accounting/transactions" },
      { label: "Receipts", href: "/accounting/receipts" },
      { label: "Reconcile", href: "/accounting/reconcile" },
      { label: "Customers & vendors", href: "/accounting/contacts" },
      { label: "Journal entries", href: "/accounting/journal" },
      { label: "Chart of accounts", href: "/accounting/accounts" },
      { label: "Sales tax", href: "/accounting/sales-tax" },
      { label: "Reports", href: "/accounting/reports" },
      { label: "Import", href: "/accounting/import" },
    ],
    status: "available",
  },
  banking: {
    key: "banking",
    label: "Banking",
    description:
      "Connect bank accounts (Wise first) so transactions arrive on their own, then sort them on the Transactions screen.",
    basePath: "/banking",
    phase: "2",
    requires: ["accounting"],
    features: ["banking.imports", "banking.wise", "banking.rules", "banking.reconciliation"],
    nav: [
      { label: "Bank accounts", href: "/banking/accounts" },
      { label: "Rules", href: "/banking/rules" },
    ],
    status: "available",
  },
  commerce: {
    key: "commerce",
    label: "Commerce",
    description: "Sales channels, marketplace connections, orders, settlements and listing watch.",
    basePath: "/commerce",
    phase: "3",
    requires: ["accounting"],
    features: ["commerce.channels", "commerce.orders", "commerce.settlements", "commerce.listings"],
    nav: [
      { label: "Orders", href: "/commerce/orders" },
      { label: "Listing watch", href: "/commerce/watch" },
      { label: "Settlements", href: "/commerce/settlements" },
      { label: "Channel profit", href: "/commerce/profit" },
      { label: "Channels", href: "/commerce/channels" },
    ],
    status: "available",
  },
  inventory: {
    key: "inventory",
    label: "Inventory",
    description:
      "The products you sell, linked to your marketplace SKUs, and purchase orders to your suppliers. Landed costs and cost of goods sold come next.",
    basePath: "/inventory",
    phase: "5",
    requires: ["accounting", "commerce"],
    features: ["inventory.products", "inventory.purchasing", "inventory.cogs"],
    nav: [
      { label: "Products", href: "/inventory/products" },
      { label: "Purchase orders", href: "/inventory/purchase-orders" },
    ],
    status: "available",
  },
  reviews: {
    key: "reviews",
    label: "Review requests",
    description: "Manual, bulk and automatic Amazon review requests.",
    basePath: "/reviews",
    phase: "3",
    requires: ["commerce"],
    features: ["reviews.manual", "reviews.bulk", "reviews.auto_rules"],
    nav: [
      { label: "Requests", href: "/reviews" },
      { label: "Automatic requests", href: "/reviews/automatic" },
    ],
    status: "available",
  },
  analytics: {
    key: "analytics",
    label: "Analytics",
    description: "SKU profitability, reorder planning and alerts.",
    basePath: "/analytics",
    phase: "6",
    requires: ["inventory"],
    features: ["analytics.profitability", "analytics.reorder", "analytics.alerts"],
    nav: [{ label: "Analytics", href: "/analytics" }],
    status: "coming_soon",
  },
  entity: {
    key: "entity",
    label: "Entity & compliance",
    description: "Company profile, people, document vault and compliance calendar with reminders.",
    basePath: "/company",
    phase: "2",
    requires: [],
    features: ["entity.profile", "entity.documents", "entity.compliance"],
    nav: [
      { label: "Profile", href: "/company" },
      { label: "Documents", href: "/company/documents" },
      { label: "Compliance calendar", href: "/company/calendar" },
    ],
    status: "available",
  },
};

/** The module that owns a URL segment under the organization root (e.g. "company" → entity). */
export function moduleForSegment(segment: string): ModuleManifest | undefined {
  return Object.values(modules).find((m) => m.basePath === `/${segment}`);
}

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Modules enabled for a newly created organization. */
export const DEFAULT_ENABLED_MODULES: readonly ModuleKey[] = ["accounting", "banking", "entity"];

export type ToggleResult =
  | { ok: true; enabled: ModuleKey[] }
  | { ok: false; reason: string; blocking: ModuleKey[] };

/**
 * Validates turning a module on or off against the dependency graph. Enabling requires all
 * dependencies to be enabled; disabling requires no enabled module to depend on it.
 */
export function toggleModule(
  current: readonly ModuleKey[],
  key: ModuleKey,
  enable: boolean,
  allowed: readonly ModuleKey[] = MODULE_KEYS,
): ToggleResult {
  const set = new Set(current);
  if (enable) {
    if (!allowed.includes(key)) {
      return {
        ok: false,
        reason: `${modules[key].label} is not included in your plan.`,
        blocking: [],
      };
    }
    const missing = modules[key].requires.filter((dep) => !set.has(dep));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `${modules[key].label} requires ${missing.map((m) => modules[m].label).join(", ")}.`,
        blocking: missing,
      };
    }
    set.add(key);
  } else {
    const dependents = [...set].filter((m) => modules[m].requires.includes(key));
    if (dependents.length > 0) {
      return {
        ok: false,
        reason: `Turn off ${dependents.map((m) => modules[m].label).join(", ")} first; ${
          dependents.length > 1 ? "they depend" : "it depends"
        } on ${modules[key].label}.`,
        blocking: dependents,
      };
    }
    set.delete(key);
  }
  return { ok: true, enabled: MODULE_KEYS.filter((m) => set.has(m)) };
}

import { MODULE_KEYS, type ModuleKey, modules } from "../modules/registry";
import { formatDecimal, parseDecimal } from "../money";

/**
 * Billing: packages of linked modules plus add-ons, per company per month or year (yearly is ten
 * months). Prices in USD (docs/GROWTH-PLAN.md §2; the site's `content/pricing.ts` shows the same).
 *
 * The independence rule: each module is paid for on its own line, so losing one (an add-on
 * removed, a package changed) makes only that module read-only. Nothing is ever deleted.
 */

export type BillingInterval = "month" | "year";

export type PackageKey = "books" | "seller" | "seller_plus";
export type AddOnKey = "stock" | "reviews";
export type BillingItemKey = PackageKey | AddOnKey;

export type BillingItem = {
  key: BillingItemKey;
  kind: "package" | "add_on";
  name: string;
  /** USD, exact decimals. */
  monthly: string;
  yearly: string;
  /** What it unlocks. */
  modules: readonly ModuleKey[];
  /** Add-ons: the packages they can be added to. */
  addTo?: readonly PackageKey[];
};

export const BILLING_PACKAGES: Record<PackageKey, BillingItem> = {
  books: {
    key: "books",
    kind: "package",
    name: "Books",
    monthly: "9.00",
    yearly: "90.00",
    modules: ["accounting", "banking", "entity"],
  },
  seller: {
    key: "seller",
    kind: "package",
    name: "Seller",
    monthly: "19.00",
    yearly: "190.00",
    modules: ["accounting", "banking", "entity", "commerce"],
  },
  seller_plus: {
    key: "seller_plus",
    kind: "package",
    name: "Seller Plus",
    monthly: "29.00",
    yearly: "290.00",
    modules: ["accounting", "banking", "entity", "commerce", "inventory", "reviews", "analytics"],
  },
};

export const BILLING_ADD_ONS: Record<AddOnKey, BillingItem> = {
  stock: {
    key: "stock",
    kind: "add_on",
    name: "Stock",
    monthly: "8.00",
    yearly: "80.00",
    modules: ["inventory", "analytics"],
    addTo: ["seller"],
  },
  reviews: {
    key: "reviews",
    kind: "add_on",
    name: "Review requests",
    monthly: "5.00",
    yearly: "50.00",
    modules: ["reviews"],
    addTo: ["seller"],
  },
};

export const PACKAGE_KEYS = Object.keys(BILLING_PACKAGES) as PackageKey[];
export const ADD_ON_KEYS = Object.keys(BILLING_ADD_ONS) as AddOnKey[];

export function billingItem(key: string): BillingItem | null {
  return BILLING_PACKAGES[key as PackageKey] ?? BILLING_ADD_ONS[key as AddOnKey] ?? null;
}

/** Stripe price lookup key for an item and interval, e.g. "seller_plus_year". */
export function priceLookupKey(key: BillingItemKey, interval: BillingInterval): string {
  return `${key}_${interval}`;
}

/** The item and interval behind a lookup key, or null. */
export function parseLookupKey(
  lookupKey: string | null | undefined,
): { key: BillingItemKey; interval: BillingInterval } | null {
  const match = /^(books|seller_plus|seller|stock|reviews)_(month|year)$/.exec(lookupKey ?? "");
  if (!match) return null;
  return { key: match[1] as BillingItemKey, interval: match[2] as BillingInterval };
}

/**
 * Catalogue problems: an item that unlocks a module without the modules it needs (counting the
 * packages an add-on goes on), or an add-on that adds nothing. Empty when consistent.
 */
export function catalogProblems(): string[] {
  const problems: string[] = [];
  const check = (name: string, have: readonly ModuleKey[]) => {
    for (const m of have) {
      for (const needed of modules[m].requires) {
        if (!have.includes(needed)) problems.push(`${name}: ${m} needs ${needed}`);
      }
    }
  };
  for (const p of Object.values(BILLING_PACKAGES)) check(p.name, p.modules);
  for (const a of Object.values(BILLING_ADD_ONS)) {
    for (const base of a.addTo ?? []) {
      const have = [...new Set([...BILLING_PACKAGES[base].modules, ...a.modules])];
      check(`${BILLING_PACKAGES[base].name} + ${a.name}`, have);
      if (a.modules.every((m) => BILLING_PACKAGES[base].modules.includes(m))) {
        problems.push(`${a.name} adds nothing to ${BILLING_PACKAGES[base].name}`);
      }
    }
  }
  return problems;
}

/** A choice: one package and any add-ons it takes. */
export type BillingSelection = {
  package: PackageKey;
  addOns: readonly AddOnKey[];
  interval: BillingInterval;
};

/** Why a selection can't be bought, or null. */
export function selectionProblem(selection: BillingSelection): string | null {
  for (const a of selection.addOns) {
    const addOn = BILLING_ADD_ONS[a];
    if (!addOn?.addTo?.includes(selection.package)) {
      return `${addOn?.name ?? a} can't be added to ${BILLING_PACKAGES[selection.package].name}.`;
    }
  }
  return null;
}

/** The selection's price per interval, USD. */
export function selectionTotal(selection: BillingSelection): string {
  const price = (item: BillingItem) => (selection.interval === "year" ? item.yearly : item.monthly);
  const parts = [
    price(BILLING_PACKAGES[selection.package]),
    ...selection.addOns.map((a) => price(BILLING_ADD_ONS[a])),
  ];
  return formatDecimal(
    parts.map((p) => parseDecimal(p, 2)).reduce((a, b) => a + b, 0n),
    2,
  );
}

/** Stripe's subscription states, plus none. */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type SubscriptionSnapshot = {
  status: SubscriptionStatus | string;
  /** Item keys on the subscription (a package and add-ons). */
  items: readonly string[];
  /** When the last payment failed (the grace period counts from here). */
  paymentFailedAt?: Date | null;
};

/** Days after a failed payment that everything keeps working. */
export const BILLING_GRACE_DAYS = 7;

export type Entitlement = {
  /** early_access: free until billing starts. grace: a payment failed, still working. */
  mode: "early_access" | "subscribed" | "grace" | "lapsed" | "none";
  modules: ModuleKey[];
  /** When early access ends (ISO date), when known. */
  billingStartsOn: string | null;
};

/**
 * What a company may use. Before billing starts (no date, or a date still ahead) everything is
 * free. After that: the modules on an active subscription; while a payment has failed, the
 * same for BILLING_GRACE_DAYS; otherwise none (they turn read-only, never deleted).
 */
export function entitledModules(
  subscription: SubscriptionSnapshot | null,
  options: { now: Date; billingStartsOn: string | null },
): Entitlement {
  const { now, billingStartsOn } = options;
  const today = now.toISOString().slice(0, 10);
  if (!billingStartsOn || today < billingStartsOn) {
    return { mode: "early_access", modules: [...MODULE_KEYS], billingStartsOn };
  }
  if (!subscription) return { mode: "none", modules: [], billingStartsOn };
  const unlocked = [
    ...new Set(subscription.items.flatMap((key) => billingItem(key)?.modules ?? [])),
  ];
  const ordered = MODULE_KEYS.filter((m) => unlocked.includes(m));
  if (subscription.status === "active" || subscription.status === "trialing") {
    return { mode: "subscribed", modules: ordered, billingStartsOn };
  }
  if (subscription.status === "past_due") {
    const failed = subscription.paymentFailedAt ?? now;
    const graceEnds = failed.getTime() + BILLING_GRACE_DAYS * 86_400_000;
    if (now.getTime() < graceEnds) return { mode: "grace", modules: ordered, billingStartsOn };
  }
  return { mode: "lapsed", modules: [], billingStartsOn };
}

/** Modules switched on but not paid for: they open read-only. */
export function readOnlyModules(
  enabled: readonly ModuleKey[],
  entitlement: Pick<Entitlement, "modules">,
): ModuleKey[] {
  return MODULE_KEYS.filter((m) => enabled.includes(m) && !entitlement.modules.includes(m));
}

/** The package and add-ons a company's switched-on modules suggest. */
export function suggestedSelection(
  enabled: readonly ModuleKey[],
): Omit<BillingSelection, "interval"> {
  const commerce = enabled.includes("commerce");
  const stock = enabled.includes("inventory");
  const reviews = enabled.includes("reviews");
  if (!commerce) return { package: "books", addOns: [] };
  if (stock && reviews) return { package: "seller_plus", addOns: [] };
  return {
    package: "seller",
    addOns: [...(stock ? (["stock"] as const) : []), ...(reviews ? (["reviews"] as const) : [])],
  };
}

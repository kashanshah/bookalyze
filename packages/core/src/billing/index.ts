import { MODULE_KEYS, type ModuleKey, modules } from "../modules/registry";

/**
 * Billing: packages of linked modules, one per subscription, per company per month or year (yearly
 * is ten months). Prices in USD (docs/GROWTH-PLAN.md §2; the site's `content/pricing.ts` shows the
 * same). One item per subscription, so Stripe's customer portal can switch between packages.
 *
 * The independence rule: moving to a package without a module makes only that module read-only;
 * the others keep working. Nothing is ever deleted.
 *
 * Review requests only is the one package that uses a module in part (`partly`): it connects
 * marketplaces and brings in orders through Commerce, and the rest of Commerce stays read-only.
 */

export type BillingInterval = "month" | "year";

export type PackageKey =
  | "books"
  | "seller"
  | "seller_reviews"
  | "seller_stock"
  | "seller_plus"
  | "reviews_only";
/** Add-ons once sold on Seller (now packages); a subscription that still has one keeps it. */
export type LegacyAddOnKey = "stock" | "reviews";
export type BillingItemKey = PackageKey | LegacyAddOnKey;

export type BillingItem = {
  key: BillingItemKey;
  kind: "package" | "add_on";
  name: string;
  /** USD, exact decimals. */
  monthly: string;
  yearly: string;
  /** What it unlocks. */
  modules: readonly ModuleKey[];
  /**
   * Modules it uses only in part: connecting marketplaces and bringing in their orders
   * (`CONNECTION_AREA`). Everything else in them stays read-only.
   */
  partly?: readonly ModuleKey[];
};

/**
 * What a module used in part may still change: its marketplace connections, the channels they
 * make and bringing in orders. Review requests needs these; settlements, payouts, Channel profit,
 * invoices and the books stay read-only.
 */
export const CONNECTION_AREA = "connections" as const;

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
  seller_reviews: {
    key: "seller_reviews",
    kind: "package",
    name: "Seller + Reviews",
    monthly: "24.00",
    yearly: "240.00",
    modules: ["accounting", "banking", "entity", "commerce", "reviews"],
  },
  seller_stock: {
    key: "seller_stock",
    kind: "package",
    name: "Seller + Stock",
    monthly: "27.00",
    yearly: "270.00",
    modules: ["accounting", "banking", "entity", "commerce", "inventory", "analytics"],
  },
  seller_plus: {
    key: "seller_plus",
    kind: "package",
    name: "Seller Plus",
    monthly: "29.00",
    yearly: "290.00",
    modules: ["accounting", "banking", "entity", "commerce", "inventory", "reviews", "analytics"],
  },
  reviews_only: {
    key: "reviews_only",
    kind: "package",
    name: "Review requests only",
    monthly: "9.00",
    yearly: "90.00",
    modules: ["reviews"],
    partly: ["commerce"],
  },
};

/**
 * No longer sold (Seller + Reviews and Seller + Stock replaced them): only so a subscription from
 * before keeps the modules it pays for.
 */
export const LEGACY_ADD_ONS: Record<LegacyAddOnKey, BillingItem> = {
  stock: {
    key: "stock",
    kind: "add_on",
    name: "Stock",
    monthly: "8.00",
    yearly: "80.00",
    modules: ["inventory", "analytics"],
  },
  reviews: {
    key: "reviews",
    kind: "add_on",
    name: "Review requests",
    monthly: "5.00",
    yearly: "50.00",
    modules: ["reviews"],
  },
};

export const PACKAGE_KEYS = Object.keys(BILLING_PACKAGES) as PackageKey[];

export function billingItem(key: string): BillingItem | null {
  return BILLING_PACKAGES[key as PackageKey] ?? LEGACY_ADD_ONS[key as LegacyAddOnKey] ?? null;
}

/** Stripe price lookup key for an item and interval, e.g. "seller_plus_year". */
export function priceLookupKey(key: BillingItemKey, interval: BillingInterval): string {
  return `${key}_${interval}`;
}

/** The item and interval behind a lookup key, or null. */
export function parseLookupKey(
  lookupKey: string | null | undefined,
): { key: BillingItemKey; interval: BillingInterval } | null {
  const match =
    /^(books|seller_plus|seller_reviews|seller_stock|seller|stock|reviews_only|reviews)_(month|year)$/.exec(
      lookupKey ?? "",
    );
  if (!match) return null;
  return { key: match[1] as BillingItemKey, interval: match[2] as BillingInterval };
}

/** Catalogue problems: a package that unlocks a module without the modules it needs. */
export function catalogProblems(): string[] {
  const problems: string[] = [];
  // A module used in part counts as there for what needs it; its own needs aren't checked, since
  // only its connections are used.
  const check = (name: string, have: readonly ModuleKey[], partly: readonly ModuleKey[] = []) => {
    for (const m of have) {
      for (const needed of modules[m].requires) {
        if (!have.includes(needed) && !partly.includes(needed)) {
          problems.push(`${name}: ${m} needs ${needed}`);
        }
      }
    }
    for (const m of partly) {
      if (have.includes(m)) problems.push(`${name}: ${m} is both in full and in part`);
    }
  };
  for (const p of Object.values(BILLING_PACKAGES)) check(p.name, p.modules, p.partly);
  return problems;
}

/** A choice: one package, monthly or yearly. */
export type BillingSelection = {
  package: PackageKey;
  interval: BillingInterval;
};

/** The selection's price per interval, USD. */
export function selectionTotal(selection: BillingSelection): string {
  const item = BILLING_PACKAGES[selection.package];
  return selection.interval === "year" ? item.yearly : item.monthly;
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
  /** The end of the current period; while `trialing`, when the trial ends and Stripe charges. */
  currentPeriodEnd?: Date | null;
};

/** Days after a failed payment that everything keeps working. */
export const BILLING_GRACE_DAYS = 7;

/** Days every company has everything free once billing applies to it. */
export const TRIAL_DAYS = 30;

export type Entitlement = {
  /**
   * early_access: free until billing starts. trial: the 30 days of everything, from the later
   * of billing starting and the company being created, or a card-at-sign-up company's Stripe
   * trial. grace: a payment failed, still working. needs_card: created since sign-up asks for a
   * card, and no plan chosen in Checkout yet; the company doesn't open until there is one.
   */
  mode: "early_access" | "trial" | "subscribed" | "grace" | "lapsed" | "none" | "needs_card";
  modules: ModuleKey[];
  /** When early access ends (ISO date), when known. */
  billingStartsOn: string | null;
  /** The trial's last day (ISO date), once billing has started for the company. */
  trialEndsOn: string | null;
  /**
   * Modules used only in part (not in `modules`): read-only apart from their connections
   * (`CONNECTION_AREA`).
   */
  partly: ModuleKey[];
};

const addDaysIso = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The trial's last day: TRIAL_DAYS from the later of the day billing starts and the day the
 * company was created, so existing companies get it when billing starts and new ones on sign-up.
 */
export function trialEndsOn(billingStartsOn: string, companyCreatedOn: string): string {
  const start = companyCreatedOn > billingStartsOn ? companyCreatedOn : billingStartsOn;
  return addDaysIso(start, TRIAL_DAYS - 1);
}

/**
 * What a company may use. Before billing starts (no date, or a date still ahead) everything is
 * free. Then TRIAL_DAYS of everything (`trialEndsOn`). After that: the modules on an active
 * subscription; while a payment has failed, the
 * same for BILLING_GRACE_DAYS; otherwise none (they turn read-only, never deleted).
 */
export function entitledModules(
  subscription: SubscriptionSnapshot | null,
  options: {
    now: Date;
    billingStartsOn: string | null;
    companyCreatedOn?: string | null;
    /** The company was created since sign-up asks for a card (`billing_accounts.card_required`). */
    cardRequired?: boolean;
  },
): Entitlement {
  const { now, billingStartsOn } = options;
  const today = now.toISOString().slice(0, 10);
  if (options.cardRequired) return cardEntitlement(subscription, now, billingStartsOn);
  if (!billingStartsOn || today < billingStartsOn) {
    return {
      mode: "early_access",
      modules: [...MODULE_KEYS],
      billingStartsOn,
      trialEndsOn: null,
      partly: [],
    };
  }
  const trialEnd = trialEndsOn(billingStartsOn, options.companyCreatedOn ?? billingStartsOn);
  const base = { billingStartsOn, trialEndsOn: trialEnd, partly: [] as ModuleKey[] };
  // The trial is unrestricted: every module, whatever plan was chosen meanwhile.
  if (today <= trialEnd) return { mode: "trial", modules: [...MODULE_KEYS], ...base };
  if (!subscription) return { mode: "none", modules: [], ...base };
  const unlocked = [
    ...new Set(subscription.items.flatMap((key) => billingItem(key)?.modules ?? [])),
  ];
  const ordered = MODULE_KEYS.filter((m) => unlocked.includes(m));
  const inPart = new Set(subscription.items.flatMap((key) => billingItem(key)?.partly ?? []));
  const partly = MODULE_KEYS.filter((m) => inPart.has(m) && !unlocked.includes(m));
  if (subscription.status === "active" || subscription.status === "trialing") {
    return { mode: "subscribed", modules: ordered, ...base, partly };
  }
  if (subscription.status === "past_due") {
    const failed = subscription.paymentFailedAt ?? now;
    const graceEnds = failed.getTime() + BILLING_GRACE_DAYS * 86_400_000;
    if (now.getTime() < graceEnds) return { mode: "grace", modules: ordered, ...base, partly };
  }
  return { mode: "lapsed", modules: [], ...base };
}

/** Subscription states that never got a working plan (Checkout left, or its payment failed). */
const NEVER_STARTED = ["incomplete", "incomplete_expired"];

/**
 * A company that gave a card at sign-up: early access and BILLING_STARTS_ON don't apply. Without
 * a plan from Checkout it doesn't open; while Stripe's trial runs, everything is open; then its
 * plan, as for any subscription.
 */
function cardEntitlement(
  subscription: SubscriptionSnapshot | null,
  now: Date,
  billingStartsOn: string | null,
): Entitlement {
  const none = { billingStartsOn, trialEndsOn: null, partly: [] as ModuleKey[] };
  if (!subscription || NEVER_STARTED.includes(subscription.status)) {
    return { mode: "needs_card", modules: [], ...none };
  }
  if (subscription.status === "trialing") {
    const chargeOn = (subscription.currentPeriodEnd ?? now).toISOString().slice(0, 10);
    return {
      mode: "trial",
      modules: [...MODULE_KEYS],
      billingStartsOn,
      trialEndsOn: addDaysIso(chargeOn, -1),
      partly: [],
    };
  }
  // Its trial is over: the usual subscription rules (active, grace, lapsed).
  const paid = entitledModules(subscription, { now, billingStartsOn: "1970-01-01" });
  return { ...paid, ...none, partly: paid.partly };
}

/**
 * Days free before the first charge for a plan chosen now by a company that gives its card at
 * sign-up: its trial days (30 for an owner's first company) until it has had a plan; 0 after,
 * so a plan cancelled and chosen again doesn't start another trial.
 */
export function signupTrialDays(
  account: { cardRequired: boolean; trialDays: number } | null,
  subscription: { status: string } | null,
): number {
  if (!account?.cardRequired) return 0;
  if (subscription && !NEVER_STARTED.includes(subscription.status)) return 0;
  return account.trialDays;
}

/** Days left in the trial, counting today; 0 when it's over or not started. */
export function trialDaysLeft(trialEnd: string | null, now = new Date()): number {
  if (!trialEnd) return 0;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((Date.parse(`${trialEnd}T00:00:00Z`) - today) / 86_400_000) + 1);
}

/**
 * The first day a plan chosen now may be charged (ISO date), or null to charge straight away:
 * the day after the trial, whether we're still in early access or already in the trial.
 */
export function firstChargeOn(
  entitlement: Pick<Entitlement, "mode" | "billingStartsOn" | "trialEndsOn">,
  companyCreatedOn: string,
): string | null {
  if (entitlement.mode === "trial" && entitlement.trialEndsOn) {
    return addDaysIso(entitlement.trialEndsOn, 1);
  }
  if (entitlement.mode === "early_access" && entitlement.billingStartsOn) {
    return addDaysIso(trialEndsOn(entitlement.billingStartsOn, companyCreatedOn), 1);
  }
  return null;
}

/** Modules switched on but not paid for: they open read-only. */
export function readOnlyModules(
  enabled: readonly ModuleKey[],
  entitlement: Pick<Entitlement, "modules">,
): ModuleKey[] {
  return MODULE_KEYS.filter((m) => enabled.includes(m) && !entitlement.modules.includes(m));
}

/**
 * Whether a change may be made in a module: always unless it's read-only, and in a module used
 * only in part, just its connections (`area` = CONNECTION_AREA).
 */
export function mayChange(
  billing: { readOnly: readonly ModuleKey[]; entitlement: Pick<Entitlement, "partly"> },
  module: ModuleKey,
  area?: typeof CONNECTION_AREA,
): boolean {
  if (!billing.readOnly.includes(module)) return true;
  return area === CONNECTION_AREA && billing.entitlement.partly.includes(module);
}

/** The package a company's switched-on modules suggest. */
export function suggestedSelection(enabled: readonly ModuleKey[]): PackageKey {
  const commerce = enabled.includes("commerce");
  const stock = enabled.includes("inventory");
  const reviews = enabled.includes("reviews");
  if (!commerce) return "books";
  if (stock && reviews) return "seller_plus";
  if (stock) return "seller_stock";
  if (reviews) return "seller_reviews";
  return "seller";
}

/**
 * Whether a publishable key belongs with a secret (or restricted) key: both test or both live.
 * A mismatch would show a payment form that can't load the session, so the app uses Stripe's
 * own page instead.
 */
export function stripeKeysPair(secretKey: string, publishableKey: string): boolean {
  const secret = /^(?:sk|rk)_(test|live)_/.exec(secretKey)?.[1];
  const publishable = /^pk_(test|live)_/.exec(publishableKey)?.[1];
  return Boolean(secret) && secret === publishable;
}

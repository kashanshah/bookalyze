import "server-only";
import {
  type CONNECTION_AREA,
  type Entitlement,
  entitledModules,
  type ModuleKey,
  mayChange,
  modules,
  readOnlyModules,
} from "@bookalyze/core";
import { type BillingState, getBilling, type Transaction } from "@bookalyze/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";
import { stripeConfigured } from "./stripe";

export type OrgBilling = {
  entitlement: Entitlement;
  /** Switched on but not paid for: they open, and nothing in them can be changed. */
  readOnly: ModuleKey[];
  state: BillingState;
  /** The day the company was created (ISO): a trial starts then if billing already had. */
  companyCreatedOn: string;
};

/** What the company may use, from its subscription and when billing starts for it. */
export async function loadOrgBilling(
  tx: Transaction,
  enabled: readonly ModuleKey[],
  company: { createdOn: string },
  now = new Date(),
): Promise<OrgBilling> {
  const state = await getBilling(tx);
  const billingStartsOn = state.account?.startsOn ?? env().BILLING_STARTS_ON ?? null;
  const entitlement = entitledModules(
    state.subscription
      ? {
          status: state.subscription.status,
          items: state.items.map((i) => i.itemKey),
          paymentFailedAt: state.subscription.paymentFailedAt,
          currentPeriodEnd: state.subscription.currentPeriodEnd,
        }
      : null,
    {
      now,
      billingStartsOn,
      companyCreatedOn: company.createdOn,
      // Asked for a card at sign-up; without Stripe set up nothing can be bought, so it's free.
      cardRequired: Boolean(state.account?.cardRequired) && stripeConfigured(),
    },
  );
  return {
    entitlement,
    readOnly: readOnlyModules(enabled, entitlement),
    state,
    companyCreatedOn: company.createdOn,
  };
}

/**
 * Stops a change in a read-only module: a server action (a POST carrying Next-Action) is sent to
 * Plan and billing, which says why. Pages still open, so everything stays visible. `area` names a
 * part a plan may use on its own (Review requests only: Commerce's connections and orders).
 */
export async function guardWrites(
  ctx: { org: { slug: string }; billing: OrgBilling },
  module: ModuleKey,
  area?: typeof CONNECTION_AREA,
) {
  if (mayChange(ctx.billing, module, area)) return;
  const h = await headers();
  if (!h.get("next-action")) return;
  redirect(`/o/${ctx.org.slug}/settings/billing?readonly=${module}`);
}

export function moduleLabel(key: string): string {
  return modules[key as ModuleKey]?.label ?? key;
}

/** The read-only modules by name; one used in part says what still works in it. */
export function readOnlyLabels(billing: OrgBilling): string[] {
  return billing.readOnly.map((m) =>
    billing.entitlement.partly.includes(m)
      ? `${moduleLabel(m)} (apart from connecting marketplaces and bringing in orders)`
      : moduleLabel(m),
  );
}

import "server-only";
import {
  type Entitlement,
  entitledModules,
  type ModuleKey,
  modules,
  readOnlyModules,
} from "@bookalyze/core";
import { type BillingState, getBilling, type Transaction } from "@bookalyze/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";

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
        }
      : null,
    { now, billingStartsOn, companyCreatedOn: company.createdOn },
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
 * Plan and billing, which says why. Pages still open, so everything stays visible.
 */
export async function guardWrites(
  ctx: { org: { slug: string }; billing: OrgBilling },
  module: ModuleKey,
) {
  if (!ctx.billing.readOnly.includes(module)) return;
  const h = await headers();
  if (!h.get("next-action")) return;
  redirect(`/o/${ctx.org.slug}/settings/billing?readonly=${module}`);
}

export function moduleLabel(key: string): string {
  return modules[key as ModuleKey]?.label ?? key;
}

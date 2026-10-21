import { billingItem, suggestedSelection } from "@bookalyze/core";
import { CircleAlert, Gift, Lock, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { moduleLabel } from "@/server/billing";
import { getOrgContext } from "@/server/org";
import { listInvoices, type StripeInvoice, stripeConfigured } from "@/server/stripe";
import { PlanPicker } from "./plan-picker";
import { PortalButton } from "./portal-button";

export const metadata: Metadata = { title: "Plan and billing" };

const STATUS: Record<
  string,
  { label: string; variant: "success" | "warning" | "destructive" | "secondary" }
> = {
  active: { label: "Active", variant: "success" },
  trialing: { label: "Free until billing starts", variant: "success" },
  past_due: { label: "Payment failed", variant: "destructive" },
  unpaid: { label: "Unpaid", variant: "destructive" },
  canceled: { label: "Cancelled", variant: "secondary" },
  incomplete: { label: "Waiting for payment", variant: "warning" },
  incomplete_expired: { label: "Payment didn't go through", variant: "secondary" },
  paused: { label: "Paused", variant: "secondary" },
};

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ readonly?: string; checkout?: string }>;
}) {
  const { slug } = await params;
  const { readonly, checkout } = await searchParams;
  const ctx = await getOrgContext(slug);
  const { entitlement, readOnly, state } = ctx.billing;
  const owner = ctx.role === "owner";
  const configured = stripeConfigured();
  const subscription = state.subscription;
  const current = subscription && !["canceled", "incomplete_expired"].includes(subscription.status);
  const locale = ctx.profile?.locale ?? "en-CA";
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  const startsOn = entitlement.billingStartsOn
    ? day.format(new Date(`${entitlement.billingStartsOn}T00:00:00Z`))
    : null;
  let invoices: StripeInvoice[] = [];
  if (configured && owner && state.account) {
    invoices = await listInvoices(state.account.stripeCustomerId).catch(() => []);
  }
  const blocked = readonly && readOnly.includes(readonly as never) ? moduleLabel(readonly) : null;

  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Plan and billing"
        description={`What ${ctx.org.name} pays for. Each company has its own plan; people, orders and marketplaces are unlimited.`}
      />

      {blocked ? (
        <p className="fade-in-0 flex animate-in items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">{blocked} is read-only.</span> It isn't in this company's
            plan, so nothing in it can be changed. Everything in it is kept; choose a plan that
            includes it to carry on.
          </span>
        </p>
      ) : null}
      {checkout === "done" ? (
        <p className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm">
          Thanks. Your plan shows here as soon as Stripe confirms it, usually within a few seconds.
        </p>
      ) : null}

      {entitlement.mode === "early_access" ? (
        <section className="flex items-start gap-3 rounded-2xl border bg-card p-5 shadow-xs">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Gift className="size-4.5" />
          </span>
          <div className="grid gap-1">
            <h2 className="font-semibold">Free during early access</h2>
            <p className="text-muted-foreground text-sm">
              {startsOn
                ? `Everything is included until ${startsOn}. You can choose a plan now; nothing is charged before then.`
                : "Everything is included, and nothing is charged. We'll tell you well before billing starts."}
            </p>
          </div>
        </section>
      ) : null}

      {entitlement.mode === "grace" ? (
        <p className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          The last payment didn't go through. Everything keeps working for a week; update the card
          in Manage billing.
        </p>
      ) : null}

      {readOnly.length && !blocked ? (
        <p className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" />
          Read-only, because they aren't in the plan: {readOnly.map(moduleLabel).join(", ")}.
          Nothing in them is deleted.
        </p>
      ) : null}

      {current && subscription ? (
        <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <h2 className="font-semibold">
                {[...state.items]
                  .sort(
                    (a, b) =>
                      Number(billingItem(a.itemKey)?.kind === "add_on") -
                      Number(billingItem(b.itemKey)?.kind === "add_on"),
                  )
                  .map((i) => billingItem(i.itemKey)?.name ?? i.itemKey)
                  .join(" + ") || "Your plan"}
              </h2>
              <p className="text-muted-foreground text-sm">
                Paid {subscription.interval === "year" ? "yearly" : "monthly"}
                {subscription.currentPeriodEnd
                  ? ` · ${subscription.cancelAtPeriodEnd ? "ends" : "renews"} ${day.format(subscription.currentPeriodEnd)}`
                  : ""}
              </p>
            </div>
            <Badge variant={STATUS[subscription.status]?.variant ?? "secondary"}>
              {STATUS[subscription.status]?.label ?? subscription.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Includes{" "}
            {entitlement.modules
              .filter((m) => m !== "analytics")
              .map(moduleLabel)
              .join(", ")}
            .
          </p>
          {owner && configured ? (
            <div>
              <PortalButton slug={slug} />
            </div>
          ) : null}
        </section>
      ) : (
        <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
          <div className="grid gap-1">
            <h2 className="font-semibold">Choose a plan</h2>
            <p className="text-muted-foreground text-sm">
              Suggested from the features {ctx.org.name} has switched on. Change it any time; a
              feature you stop paying for becomes read-only, and nothing in it is deleted.
            </p>
          </div>
          {!configured ? (
            <p className="rounded-xl border border-dashed px-4 py-3 text-muted-foreground text-sm">
              Payments aren't switched on yet.
            </p>
          ) : !owner ? (
            <p className="rounded-xl border border-dashed px-4 py-3 text-muted-foreground text-sm">
              Only owners can choose the plan.
            </p>
          ) : null}
          <PlanPicker
            slug={slug}
            suggested={suggestedSelection(ctx.enabledModules)}
            canBuy={owner && configured}
          />
        </section>
      )}

      {invoices.length ? (
        <section className="grid gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <ReceiptText className="size-4 text-muted-foreground" />
            Invoices
          </h2>
          <ul className="divide-y rounded-2xl border bg-card shadow-xs">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <span>
                  {inv.number ?? inv.id} · {day.format(new Date(inv.created * 1000))}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">
                    {new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: inv.currency.toUpperCase(),
                    }).format(inv.total / 100)}
                  </span>
                  {inv.hosted_invoice_url ? (
                    <a
                      href={inv.hosted_invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      View
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

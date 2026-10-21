import { trialDaysLeft } from "@bookalyze/core";
import { Gift, Lock } from "lucide-react";
import Link from "next/link";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar, SidebarContent } from "@/components/shell/sidebar";
import { moduleLabel } from "@/server/billing";
import { getOrgContext, listUserOrgs } from "@/server/org";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  const orgs = await listUserOrgs(ctx.session.user.id);
  // The trial's last week, while no plan is chosen: a reminder on every page.
  const trialLeft = trialDaysLeft(ctx.billing.entitlement.trialEndsOn);
  const trialEnding =
    ctx.billing.entitlement.mode === "trial" &&
    trialLeft <= 7 &&
    !ctx.billing.state.subscription?.status.match(/^(active|trialing)$/);
  return (
    <div className="flex min-h-dvh">
      {/* Printouts (and saved PDFs) are just the page: no navigation. */}
      <div className="contents print:hidden">
        <Sidebar ctx={ctx} orgs={orgs} />
      </div>
      <div className="min-w-0 flex-1">
        {/* display: contents keeps the bar sticky inside the column. */}
        <div className="contents print:hidden">
          <MobileNav>
            <SidebarContent ctx={ctx} orgs={orgs} />
          </MobileNav>
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:px-10 lg:py-10 print:max-w-none print:p-0">
          {trialEnding ? (
            <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm print:hidden">
              <Gift className="size-4 shrink-0 text-primary" />
              <span className="flex-1">
                Your free trial ends in {trialLeft} {trialLeft === 1 ? "day" : "days"}. Choose a
                plan to keep what you use; nothing is deleted either way.
              </span>
              <Link
                href={`/o/${slug}/settings/billing`}
                className="basis-full ps-6 font-medium text-primary underline-offset-4 hover:underline sm:basis-auto sm:ps-0"
              >
                Choose a plan
              </Link>
            </p>
          ) : null}
          {ctx.billing.readOnly.length ? (
            <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm print:hidden">
              <Lock className="size-4 shrink-0" />
              <span className="flex-1">
                Read-only, because they aren't in the plan:{" "}
                <span className="font-medium">
                  {ctx.billing.readOnly.map(moduleLabel).join(", ")}
                </span>
                . Nothing in them is deleted.
              </span>
              <Link
                href={`/o/${slug}/settings/billing`}
                className="basis-full ps-6 font-medium text-primary underline-offset-4 hover:underline sm:basis-auto sm:ps-0"
              >
                Plan and billing
              </Link>
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

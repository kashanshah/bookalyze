import { funnelRates } from "@bookalyze/core";
import { getDb, platformFunnel, platformSignupSources } from "@bookalyze/db";
import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { cn } from "@/lib/utils";
import { env } from "@/server/env";
import { requireSupportAgent } from "@/server/support";

export const metadata: Metadata = { title: "Growth" };

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
] as const;

const count = new Intl.NumberFormat("en-CA");
const percent = (value: number | null) => (value === null ? "–" : `${value}%`);

/** Sign-ups and how far they get, for platform admins. Totals only, never a person. */
export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireSupportAgent("/admin/growth");
  const { days: daysParam } = await searchParams;
  const period = PERIODS.find((p) => String(p.days) === daysParam) ?? PERIODS[1];
  const to = new Date();
  const from = new Date(to.getTime() - period.days * 86_400_000);
  const query = { from, to, exclude: env().PLATFORM_ADMIN_EMAILS };
  const [funnel, sources] = await Promise.all([
    platformFunnel(getDb(), query),
    platformSignupSources(getDb(), query),
  ]);
  const steps = funnelRates([
    { key: "signed_up", label: "Signed up", count: funnel.signedUp },
    { key: "verified", label: "Confirmed their email", count: funnel.verified },
    { key: "company", label: "Set up a company", count: funnel.withCompany },
    { key: "card", label: "Gave a card", count: funnel.cardGiven },
  ]);
  const outcomes = [
    { label: "In the free trial", value: funnel.trialing, hint: "Card given, not charged yet" },
    { label: "Paying", value: funnel.paying, hint: "Charged at least once, still on a plan" },
    { label: "Payment failed", value: funnel.paymentFailed, hint: "Stripe is retrying the card" },
    { label: "Cancelled", value: funnel.cancelled, hint: "Or cancelling at the period's end" },
  ];

  return (
    <>
      <PageHeader
        title="Growth"
        description={`People who signed up in the last ${period.label}, and how far they got with their first company. Platform admins aren't counted.`}
      />
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4" aria-label="Period">
        {PERIODS.map((p) => (
          <Link
            key={p.days}
            href={`/admin/growth?days=${p.days}`}
            aria-current={p.days === period.days ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm",
              p.days === period.days
                ? "bg-card font-medium shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      {funnel.signedUp === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <BarChart3 className="size-6 text-muted-foreground" />
          <p className="font-medium">No sign-ups in the last {period.label}</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            They appear here as people create accounts. Try a longer period.
          </p>
        </div>
      ) : (
        <>
          <section className="grid gap-3 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
            <h2 className="font-semibold">Sign-up funnel</h2>
            <ol className="grid gap-4">
              {steps.map((step, i) => (
                <li key={step.key} className="grid gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="font-medium">{step.label}</span>
                    <span className="tabular-nums">
                      <span className="font-semibold">{count.format(step.count)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {percent(step.ofFirst)} of sign-ups
                        {i > 0 ? ` · ${percent(step.ofPrevious)} of the step before` : ""}
                      </span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${step.ofFirst ?? 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="grid gap-3">
            <h2 className="font-semibold">Where those with a card are now</h2>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {outcomes.map((o) => (
                <li key={o.label} className="grid gap-1 rounded-2xl border bg-card p-4 shadow-xs">
                  <span className="text-muted-foreground text-sm">{o.label}</span>
                  <span className="font-semibold text-2xl tabular-nums">
                    {count.format(o.value)}
                  </span>
                  <span className="text-muted-foreground text-xs">{o.hint}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-3">
            <div>
              <h2 className="font-semibold">Where they came from</h2>
              <p className="text-muted-foreground text-sm">
                The first source we saw: a campaign's utm tags or an ad click, else the site that
                linked to us, else Direct.
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border bg-card shadow-xs">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="whitespace-nowrap border-b text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">Source</th>
                    <th className="px-4 py-2.5 text-end font-medium">Signed up</th>
                    <th className="px-4 py-2.5 text-end font-medium">Company</th>
                    <th className="px-4 py-2.5 text-end font-medium">Card</th>
                    <th className="px-4 py-2.5 text-end font-medium">Paying</th>
                    <th className="px-4 py-2.5 text-end font-medium">Sign-up to card</th>
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums">
                  {sources.map((s) => (
                    <tr key={s.source}>
                      <td className="max-w-[14rem] truncate px-4 py-2.5 font-medium">{s.source}</td>
                      <td className="px-4 py-2.5 text-end">{count.format(s.signedUp)}</td>
                      <td className="px-4 py-2.5 text-end">{count.format(s.withCompany)}</td>
                      <td className="px-4 py-2.5 text-end">{count.format(s.cardGiven)}</td>
                      <td className="px-4 py-2.5 text-end">{count.format(s.paying)}</td>
                      <td className="px-4 py-2.5 text-end text-muted-foreground">
                        {percent(s.signedUp ? Math.round((s.cardGiven * 100) / s.signedUp) : null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="text-muted-foreground text-sm">
        Visits and clicks on Start free are in Vercel: the bookalyze-site project → Analytics (the
        “Start free” event, by page). People are counted in the period they signed up in.
      </p>
    </>
  );
}

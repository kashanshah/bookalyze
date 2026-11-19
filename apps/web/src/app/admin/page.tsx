import { getDb, platformDaily, platformOverview, platformPeople } from "@bookalyze/db";
import {
  Activity,
  BarChart3,
  Building2,
  CreditCard,
  ExternalLink,
  KeyRound,
  LifeBuoy,
  UserPlus,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { cn } from "@/lib/utils";
import { env } from "@/server/env";
import { requireSupportAgent } from "@/server/support";
import { DailyChart } from "./daily-chart";

export const metadata: Metadata = { title: "Overview" };

const count = new Intl.NumberFormat("en-CA");
const signedUp = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** The platform at a glance, for platform admins. Totals only, never a person or a company. */
export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  await requireSupportAgent("/admin");
  const { all } = await searchParams;
  const includeAdmins = all === "1";
  const at = { now: new Date(), exclude: includeAdmins ? [] : env().PLATFORM_ADMIN_EMAILS };
  const [o, daily, latest] = await Promise.all([
    platformOverview(getDb(), at),
    platformDaily(getDb(), { ...at, days: 30 }),
    platformPeople(getDb(), {
      from: new Date(0),
      to: at.now,
      exclude: at.exclude,
      limit: 8,
      offset: 0,
    }),
  ]);
  const analyticsOn = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

  const tiles = [
    {
      icon: UserPlus,
      label: "People",
      value: o.users,
      detail: `${count.format(o.signups7d)} new this week · ${count.format(o.signups30d)} in 30 days`,
    },
    {
      icon: Activity,
      label: "Active this week",
      value: o.active7d,
      detail: `${count.format(o.active1d)} today · ${count.format(o.active30d)} in 30 days`,
    },
    {
      icon: Building2,
      label: "Companies",
      value: o.companies,
      detail: `${count.format(o.companiesActive30d)} with changes in 30 days · ${count.format(o.companiesNew30d)} new`,
    },
    {
      icon: CreditCard,
      label: "Paying",
      value: o.paying,
      detail: `${count.format(o.trialing)} in the trial · ${count.format(o.paymentFailed)} payment failed · ${count.format(o.cancelled)} cancelled`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          includeAdmins
            ? "Everyone on Bookalyze, your own accounts and companies included."
            : "Everyone on Bookalyze except platform admins and the companies they own."
        }
      />

      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4" aria-label="Who's counted">
        {[
          { href: "/admin", label: "Customers only", current: !includeAdmins },
          { href: "/admin?all=1", label: "Include my accounts", current: includeAdmins },
        ].map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.current ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm",
              tab.current
                ? "bg-card font-medium shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <li
            key={t.label}
            className="grid content-start gap-1 rounded-2xl border bg-card p-4 shadow-xs"
          >
            <span className="flex items-center gap-2 text-muted-foreground text-sm">
              <t.icon className="size-4" />
              {t.label}
            </span>
            <span className="font-semibold text-3xl tabular-nums">{count.format(t.value)}</span>
            <span className="text-muted-foreground text-xs leading-5">{t.detail}</span>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        <DailyChart
          title="Sign-ups"
          hint="New accounts each day, last 30 days (UTC)."
          rows={daily}
          value={(r) => r.signups}
          unit="sign-ups"
          href={(r) => `/admin/people?day=${r.day}${includeAdmins ? "&all=1" : ""}`}
        />
        <DailyChart
          title="Active people"
          hint="Signed in or changed something that day."
          rows={daily}
          value={(r) => r.active}
          unit="people"
        />
      </div>

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-semibold">Latest sign-ups</h2>
          <Link
            href={includeAdmins ? "/admin/people?all=1" : "/admin/people"}
            className="font-medium text-primary text-sm underline-offset-4 hover:underline"
          >
            See everyone
          </Link>
        </div>
        {latest.rows.length ? (
          <ul className="divide-y rounded-2xl border bg-card text-sm shadow-xs">
            {latest.rows.map((r) => (
              <li
                key={r.userId}
                className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name || "No name"}</span>
                  <span className="block truncate text-muted-foreground">{r.email}</span>
                </span>
                <span className="text-muted-foreground">
                  {r.companyName ?? "No company yet"}
                  {r.emailVerified ? "" : " · email not confirmed"}
                </span>
                <span className="w-full text-muted-foreground tabular-nums sm:w-44 sm:text-end">
                  {signedUp.format(r.signedUpAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No one has signed up yet.</p>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/admin/support"
          className="grid content-start gap-1 rounded-2xl border bg-card p-4 shadow-xs transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2 font-medium text-sm">
            <LifeBuoy className="size-4 text-muted-foreground" />
            Support desk
          </span>
          <span className="text-muted-foreground text-sm">
            {o.openTickets
              ? `${count.format(o.openTickets)} ${o.openTickets === 1 ? "ticket waits" : "tickets wait"} for a reply`
              : "Nothing waiting for a reply"}
          </span>
        </Link>
        <Link
          href="/admin/growth"
          className="grid content-start gap-1 rounded-2xl border bg-card p-4 shadow-xs transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2 font-medium text-sm">
            <BarChart3 className="size-4 text-muted-foreground" />
            Growth
          </span>
          <span className="text-muted-foreground text-sm">
            How far new sign-ups get, and where they came from
          </span>
        </Link>
        <a
          href="https://us.posthog.com"
          target="_blank"
          rel="noreferrer"
          className="grid content-start gap-1 rounded-2xl border bg-card p-4 shadow-xs transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2 font-medium text-sm">
            <ExternalLink className="size-4 text-muted-foreground" />
            Product analytics
          </span>
          <span className="text-muted-foreground text-sm">
            {analyticsOn
              ? "Visits, pages and clicks in PostHog (filter by product = bookalyze)"
              : "PostHog isn't set up here: NEXT_PUBLIC_POSTHOG_KEY is empty"}
          </span>
        </a>
      </section>

      <p className="flex items-start gap-2 text-muted-foreground text-sm">
        <KeyRound className="mt-0.5 size-4 shrink-0" />
        <span>
          {count.format(o.apiKeysUsed30d)} AI assistant or API{" "}
          {o.apiKeysUsed30d === 1 ? "connection was" : "connections were"} used in the last 30 days.{" "}
          {count.format(o.verifiedUsers)} of {count.format(o.users)} people have confirmed their
          email.
        </span>
      </p>
    </>
  );
}

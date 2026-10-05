import { addDaysIso, daysBetween, fiscalYearFor, modules } from "@bookalyze/core";
import { getCountry, getSubdivision } from "@bookalyze/core/reference-data";
import { getDb, schema, withOrg } from "@bookalyze/db";
import { and, count, eq, gt, like } from "drizzle-orm";
import { ArrowRight, CalendarClock, CalendarRange, Check, Coins, Lock, MapPin } from "lucide-react";
import Link from "next/link";
import { MODULE_ICONS } from "@/components/shell/module-icons";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "@/components/ui/progress-ring";
import { formatDate, nowIn } from "@/lib/dates";
import { timezoneLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { dueIn, loadCalendar } from "@/server/compliance";
import { fiscalConfigOf, getOrgContext } from "@/server/org";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function OrgHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  const p = ctx.profile;
  const now = nowIn(p?.timezone ?? "UTC");
  const fy = p ? fiscalYearFor(now.date, fiscalConfigOf(p)) : null;
  const fmt = (d: string) =>
    new Intl.DateTimeFormat(p?.locale ?? "en-CA", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${d}T00:00:00Z`));
  const daysLeft = fy
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${fy.end}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) / 86_400_000,
        ),
      )
    : 0;

  const db = getDb();
  const showCompliance = Boolean(p) && ctx.activeModules.includes("entity");
  const [[members], [invites], moduleChanges, setup, comingUp] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.member)
      .where(eq(schema.member.organizationId, ctx.org.id)),
    db
      .select({ n: count() })
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, ctx.org.id),
          eq(schema.invitation.status, "pending"),
          gt(schema.invitation.expiresAt, new Date()),
        ),
      ),
    withOrg(db, { orgId: ctx.org.id }, (tx) =>
      tx
        .select({ n: count() })
        .from(schema.auditLogs)
        .where(like(schema.auditLogs.action, "module.%")),
    ),
    withOrg(db, { orgId: ctx.org.id }, async (tx) => ({
      imports: (await tx.select({ n: count() }).from(schema.importBatches))[0]?.n ?? 0,
      banks: (await tx.select({ n: count() }).from(schema.connections))[0]?.n ?? 0,
    })),
    // What's due in the next 60 days (and anything overdue in the last 90), not yet done.
    showCompliance && p
      ? withOrg(db, { orgId: ctx.org.id }, (tx) =>
          loadCalendar(tx, p, { from: addDaysIso(now.date, -90), to: addDaysIso(now.date, 60) }),
        ).then((items) => items.filter((i) => !i.done).slice(0, 5))
      : Promise.resolve([]),
  ]);

  const base = `/o/${slug}`;
  const steps = [
    {
      title: "Set up your company",
      body: "Name, location, currency and financial year.",
      href: `${base}/settings/general`,
      done: Boolean(p),
    },
    {
      title: "Choose the features you need",
      body: "Turn on only what this company uses. You can change it any time.",
      href: `${base}/settings/modules`,
      done: (moduleChanges[0]?.n ?? 0) > 0,
    },
    {
      title: "Invite your accountant or team",
      body: "Give people access to this company only.",
      href: `${base}/settings/members`,
      done: (members?.n ?? 0) > 1 || (invites?.n ?? 0) > 0,
    },
    ...(ctx.activeModules.includes("accounting")
      ? [
          {
            title: "Bring over your books from Wave",
            body: "Full history, including receipts.",
            href: `${base}/accounting/import`,
            done: setup.imports > 0,
          },
        ]
      : []),
    ...(ctx.activeModules.includes("banking")
      ? [
          {
            title: "Connect your bank accounts",
            body: "Wise sync, or statement uploads from any bank.",
            href: `${base}/banking/accounts`,
            done: setup.banks > 0,
          },
        ]
      : []),
  ] as { title: string; body: string; href?: string; done?: boolean; soon?: string }[];
  const doneCount = steps.filter((s) => s.done).length;
  const actionable = steps.filter((s) => !s.soon).length;
  const location = p
    ? [
        p.subdivisionCode && getSubdivision(p.subdivisionCode)?.name,
        getCountry(p.countryCode)?.name,
      ]
        .filter(Boolean)
        .join(", ")
    : "—";

  return (
    <div className="grid gap-8">
      <div>
        <p className="font-medium text-muted-foreground text-sm">
          {greeting(now.hour)}, {ctx.session.user.name.split(" ")[0]}
        </p>
        <h1 className="mt-1 font-semibold text-[28px] leading-tight tracking-tight">
          {ctx.org.name}
        </h1>
        {p && p.legalName !== ctx.org.name ? (
          <p className="mt-1 text-muted-foreground text-sm">{p.legalName}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        <StatCard icon={CalendarRange} label="Financial year" className="col-span-2 md:col-span-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-2xl tracking-tight">{fy?.label ?? "—"}</span>
            {fy?.isShortFirstYear ? <Badge variant="primary">Short first year</Badge> : null}
          </div>
          {fy ? (
            <>
              <p className="tabular mt-1 text-muted-foreground text-sm">
                {fmt(fy.start)} – {fmt(fy.end)}
              </p>
              <p className="mt-3 text-muted-foreground text-xs">{daysLeft} days until year end</p>
            </>
          ) : null}
        </StatCard>
        <StatCard icon={MapPin} label="Location">
          <span className="font-semibold text-lg tracking-tight">{location}</span>
          <p className="mt-1 text-muted-foreground text-sm">
            {p ? timezoneLabel(p.timezone) : null}
          </p>
        </StatCard>
        <StatCard icon={Coins} label="Main currency">
          <span className="font-semibold text-2xl tracking-tight">{p?.baseCurrency ?? "—"}</span>
          <p className="mt-1 text-muted-foreground text-sm">Plan: {ctx.plan.name}</p>
        </StatCard>
      </div>

      {showCompliance ? (
        <section className="rounded-2xl border bg-card shadow-xs">
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4 sm:px-6">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarClock className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Coming up</h2>
              <p className="text-muted-foreground text-sm">
                Filings and renewals in the next 60 days.
              </p>
            </div>
            <Link
              href={`${base}/company/calendar`}
              className="whitespace-nowrap font-medium text-primary text-sm hover:underline"
            >
              Open calendar
            </Link>
          </div>
          {comingUp.length ? (
            <ul className="divide-y">
              {comingUp.map((item) => {
                const days = daysBetween(now.date, item.dueDate);
                return (
                  <li key={item.occurrence} className="flex items-center gap-4 px-5 py-3 sm:px-6">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-sm">{item.title}</span>
                      <span className="block text-muted-foreground text-xs">
                        {formatDate(item.dueDate, p?.locale, "long")}
                      </span>
                    </span>
                    <Badge variant={days <= 7 ? "warning" : "outline"}>
                      {days < 0 ? "Overdue" : dueIn(now.date, item.dueDate)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-5 text-muted-foreground text-sm sm:px-6">
              Nothing due in the next 60 days.
            </p>
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03),0_4px_16px_-8px_rgb(0_0_0/0.06)]">
        <div className="flex items-center gap-4 border-b p-5 sm:p-6">
          <div className="relative">
            <ProgressRing value={doneCount / actionable} />
            <span className="tabular absolute inset-0 flex items-center justify-center font-semibold text-xs">
              {doneCount}/{actionable}
            </span>
          </div>
          <div>
            <h2 className="font-semibold">
              {doneCount === actionable ? "You're all set" : "Get started with Bookalyze"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {doneCount === actionable
                ? "Everything's in place. Keep an eye on what's coming up."
                : `A few steps to get ${ctx.org.name} ready.`}
            </p>
          </div>
        </div>
        <ul className="divide-y">
          {steps.map((s) => {
            const content = (
              <>
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                    s.done && "border-success bg-success text-white",
                    s.soon && "border-dashed text-muted-foreground",
                  )}
                >
                  {s.done ? (
                    <Check className="size-4" strokeWidth={2.5} />
                  ) : s.soon ? (
                    <Lock className="size-3.5" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block font-medium text-sm",
                      s.done && "text-muted-foreground line-through decoration-muted-foreground/40",
                    )}
                  >
                    {s.title}
                  </span>
                  <span className="block text-muted-foreground text-sm">{s.body}</span>
                  {s.soon ? (
                    <Badge variant="outline" className="mt-2 sm:hidden">
                      Coming in {s.soon}
                    </Badge>
                  ) : null}
                </span>
                {s.soon ? (
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    Coming in {s.soon}
                  </Badge>
                ) : (
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                )}
              </>
            );
            return (
              <li key={s.title}>
                {s.href ? (
                  <Link
                    href={s.href}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40 sm:px-6"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-4 px-5 py-4 opacity-75 sm:px-6">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <h2 className="font-semibold text-lg tracking-tight">Your workspace</h2>
            <p className="text-muted-foreground text-sm">Features switched on for this company.</p>
          </div>
          <Link
            href={`${base}/settings/modules`}
            className="whitespace-nowrap font-medium text-primary text-sm hover:underline"
          >
            Manage features
          </Link>
        </div>
        {ctx.activeModules.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground text-sm">
            No features are switched on yet.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ctx.activeModules.map((key, i) => {
              const m = modules[key];
              const Icon = MODULE_ICONS[key];
              return (
                <Link
                  key={key}
                  href={`${base}${m.basePath}`}
                  className="group fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 shadow-xs transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/5">
                    <div className="flex items-center justify-between">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="size-5" />
                      </span>
                      {m.status === "coming_soon" ? (
                        <Badge variant="outline">Phase {m.phase}</Badge>
                      ) : null}
                    </div>
                    <div>
                      <p className="font-medium">{m.label}</p>
                      <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                        {m.description}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_4px_16px_-8px_rgb(0_0_0/0.06)] sm:p-5",
        className,
      )}
    >
      <p className="mb-3 flex items-center gap-2 text-muted-foreground text-sm">
        <Icon className="size-4" />
        {label}
      </p>
      {children}
    </div>
  );
}

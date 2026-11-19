import { readPaging } from "@bookalyze/core";
import { getDb, type PersonRow, platformPeople, platformPeopleSummary } from "@bookalyze/db";
import { Search, Users, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { env } from "@/server/env";
import { requireSupportAgent } from "@/server/support";

export const metadata: Metadata = { title: "People" };

const PERIODS = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "Everyone", days: null },
] as const;

const count = new Intl.NumberFormat("en-CA");
const when = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
const dayOnly = new Intl.DateTimeFormat("en-CA", {
  weekday: "short",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const country = (code: string | null) => {
  if (!code || code === "–") return "No country";
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
};

/** "3 hours ago", "2 days ago", from `now`. */
function ago(at: Date | null, now: Date): string {
  if (!at) return "Never";
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

const PLAN: Record<
  string,
  { label: string; variant: "success" | "primary" | "warning" | "destructive" | "secondary" }
> = {
  active: { label: "Paying", variant: "success" },
  trialing: { label: "Trial", variant: "primary" },
  past_due: { label: "Payment failed", variant: "destructive" },
  unpaid: { label: "Payment failed", variant: "destructive" },
  canceled: { label: "Cancelled", variant: "secondary" },
  incomplete: { label: "Card not finished", variant: "warning" },
  incomplete_expired: { label: "Card not finished", variant: "warning" },
};

function plan(row: PersonRow) {
  if (!row.planStatus) return null;
  if (row.planEnding && (row.planStatus === "active" || row.planStatus === "trialing")) {
    return { label: "Cancelling", variant: "warning" as const };
  }
  return PLAN[row.planStatus] ?? { label: row.planStatus, variant: "secondary" as const };
}

function cameFrom(row: PersonRow): string {
  const parts = [row.source, row.medium, row.campaign].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Direct";
}

/**
 * Who signed up, for platform admins: each person with how they signed up, whether they
 * confirmed their email, their first company and its plan, where they came from and when they
 * were last active. Never any of a company's books.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{
    days?: string;
    day?: string;
    q?: string;
    all?: string;
    page?: string;
    per?: string;
  }>;
}) {
  await requireSupportAgent("/admin/people");
  const params = await searchParams;
  const now = new Date();
  const includeAdmins = params.all === "1";
  const exclude = includeAdmins ? [] : env().PLATFORM_ADMIN_EMAILS;
  const q = (params.q ?? "").slice(0, 100);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? (params.day as string) : null;
  const period = PERIODS.find((p) => p.key === params.days) ?? PERIODS[1];

  let from: Date;
  let to: Date;
  if (day) {
    from = new Date(`${day}T00:00:00Z`);
    to = new Date(from.getTime() + 86_400_000);
  } else {
    to = now;
    from = period.days ? new Date(now.getTime() - period.days * 86_400_000) : new Date(0);
  }
  if (Number.isNaN(from.getTime())) {
    from = new Date(now.getTime() - 30 * 86_400_000);
    to = now;
  }

  const { page, perPage, offset } = readPaging(params);
  const [list, summary] = await Promise.all([
    platformPeople(getDb(), { from, to, exclude, search: q, limit: perPage, offset }),
    platformPeopleSummary(getDb(), { from, to, exclude }),
  ]);

  const keep = {
    days: day ? undefined : period.key === "30" ? undefined : period.key,
    day: day ?? undefined,
    q: q || undefined,
    all: includeAdmins ? "1" : undefined,
  };
  const link = (change: Partial<typeof keep>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...change })) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/admin/people?${s}` : "/admin/people";
  };

  const heading = day
    ? `Signed up on ${dayOnly.format(from)}`
    : `Signed up in the last ${period.label}`;
  const scope = includeAdmins ? "Your own accounts included." : "Platform admins left out.";

  return (
    <>
      <PageHeader
        title="People"
        description="Who signed up, how far they got, and when they were last here. Times are in UTC."
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <nav className="-mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Period">
            {PERIODS.map((p) => {
              const current = !day && p.key === period.key;
              return (
                <Link
                  key={p.key}
                  href={link({ days: p.key === "30" ? undefined : p.key, day: undefined })}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "shrink-0 rounded-lg px-3 py-1.5 text-sm",
                    current
                      ? "bg-card font-medium shadow-xs ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </Link>
              );
            })}
          </nav>
          {day ? (
            <Link
              href={link({ day: undefined })}
              className="flex items-center gap-1 rounded-lg bg-card px-3 py-1.5 font-medium text-sm shadow-xs ring-1 ring-border"
            >
              {dayOnly.format(from)}
              <X className="size-3.5 text-muted-foreground" aria-label="Show the whole period" />
            </Link>
          ) : null}
          <Link
            href={link({ all: includeAdmins ? undefined : "1" })}
            className="ms-auto text-muted-foreground text-sm hover:text-foreground"
          >
            {includeAdmins ? "Leave out my accounts" : "Include my accounts"}
          </Link>
        </div>

        <form action="/admin/people" className="relative max-w-sm">
          {keep.days ? <input type="hidden" name="days" value={keep.days} /> : null}
          {keep.day ? <input type="hidden" name="day" value={keep.day} /> : null}
          {keep.all ? <input type="hidden" name="all" value="1" /> : null}
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search by name or email"
            aria-label="Search by name or email"
            className="ps-9"
          />
        </form>
      </div>

      <section className="grid gap-3 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <div>
          <h2 className="font-semibold">{heading}</h2>
          <p className="text-muted-foreground text-sm">{scope}</p>
        </div>
        <dl className="grid grid-cols-3 gap-3">
          {[
            { label: "People", value: summary.people },
            { label: "Confirmed email", value: summary.verified },
            { label: "Set up a company", value: summary.withCompany },
          ].map((s) => (
            <div key={s.label} className="grid gap-0.5">
              <dt className="text-muted-foreground text-xs sm:text-sm">{s.label}</dt>
              <dd className="font-semibold text-2xl tabular-nums">
                {count.format(s.value)}
                {s.label !== "People" && summary.people ? (
                  <span className="ms-1.5 font-normal text-muted-foreground text-sm">
                    {Math.round((s.value * 100) / summary.people)}%
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        {summary.people ? (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="text-muted-foreground">
              <span className="text-foreground">Signed up with: </span>
              {summary.methods
                .map((m) => `${m.label === "none" ? "unknown" : m.label} ${count.format(m.people)}`)
                .join(" · ")}
            </p>
            {summary.countries.length ? (
              <p className="text-muted-foreground">
                <span className="text-foreground">Company country: </span>
                {summary.countries
                  .map((c) => `${country(c.label)} ${count.format(c.people)}`)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {list.rows.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <Users className="size-6 text-muted-foreground" />
          <p className="font-medium">{q ? `No one matches “${q}”` : "No sign-ups here"}</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {q
              ? "Try part of the name or email."
              : "Try a longer period, or include your accounts."}
          </p>
        </div>
      ) : (
        <>
          {/* Phones: one card a person. */}
          <ul className="grid gap-3 md:hidden">
            {list.rows.map((r) => {
              const p = plan(r);
              return (
                <li
                  key={r.userId}
                  className="grid gap-2 rounded-2xl border bg-card p-4 text-sm shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.name || "No name"}</p>
                      <p className="truncate text-muted-foreground">{r.email}</p>
                    </div>
                    {p ? <Badge variant={p.variant}>{p.label}</Badge> : null}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                    <dt>Signed up</dt>
                    <dd className="text-foreground">
                      {when.format(r.signedUpAt)} · {r.signIn ?? "unknown"}
                      {r.emailVerified ? "" : " · email not confirmed"}
                    </dd>
                    <dt>Company</dt>
                    <dd className="text-foreground">
                      {r.companyName
                        ? `${r.companyName} · ${country(r.companyCountry)}`
                        : "None yet"}
                    </dd>
                    <dt>Came from</dt>
                    <dd className="text-foreground">{cameFrom(r)}</dd>
                    <dt>Last here</dt>
                    <dd className="text-foreground">
                      {ago(r.lastSeenAt, now)}
                      {r.changes30d ? ` · ${count.format(r.changes30d)} changes` : ""}
                    </dd>
                  </dl>
                </li>
              );
            })}
          </ul>

          {/* Wider screens: a table. */}
          <div className="hidden overflow-x-auto rounded-2xl border bg-card shadow-xs md:block">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="whitespace-nowrap border-b text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">Person</th>
                  <th className="px-4 py-2.5 text-start font-medium">Signed up (UTC)</th>
                  <th className="px-4 py-2.5 text-start font-medium">Company</th>
                  <th className="px-4 py-2.5 text-start font-medium">Plan</th>
                  <th className="px-4 py-2.5 text-start font-medium">Came from</th>
                  <th className="px-4 py-2.5 text-end font-medium">Last here</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.rows.map((r) => {
                  const p = plan(r);
                  return (
                    <tr key={r.userId} className="align-top">
                      <td className="max-w-[16rem] px-4 py-3">
                        <p className="truncate font-medium">{r.name || "No name"}</p>
                        <p className="truncate text-muted-foreground">{r.email}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="tabular-nums">{when.format(r.signedUpAt)}</p>
                        <p className="text-muted-foreground">
                          {r.signIn ?? "unknown"}
                          {r.emailVerified ? (
                            " · confirmed"
                          ) : (
                            <span className="font-medium text-foreground"> · not confirmed</span>
                          )}
                        </p>
                      </td>
                      <td className="max-w-[14rem] px-4 py-3">
                        {r.companyName ? (
                          <>
                            <p className="truncate">{r.companyName}</p>
                            <p className="truncate text-muted-foreground">
                              {country(r.companyCountry)}
                              {r.companies > 1 ? ` · ${r.companies} companies` : ""}
                            </p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">None yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p ? (
                          <Badge variant={p.variant}>{p.label}</Badge>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>
                      <td className="max-w-[14rem] px-4 py-3">
                        <p className="truncate">{cameFrom(r)}</p>
                        {r.landing ? (
                          <p className="truncate text-muted-foreground">{r.landing}</p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-end">
                        <p>{ago(r.lastSeenAt, now)}</p>
                        <p className="text-muted-foreground">
                          {r.changes30d
                            ? `${count.format(r.changes30d)} changes in 30 days`
                            : "No changes"}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            perPage={perPage}
            total={list.total}
            noun={["person", "people"]}
            locale="en-CA"
            query={keep}
          />
        </>
      )}
    </>
  );
}

import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { signupSources } from "./schema/growth";

/**
 * Sign-up analytics. The app only adds a source for a new account; the admin Growth page reads
 * totals through security-definer functions that never return a person or a company.
 */

export type NewSignupSource = {
  userId: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
  landing: string | null;
};

/** Keeps where a new account came from (once; a second call changes nothing). */
export async function recordSignupSource(db: Database, input: NewSignupSource) {
  await db.insert(signupSources).values(input).onConflictDoNothing();
}

export type PlatformFunnel = {
  signedUp: number;
  verified: number;
  withCompany: number;
  cardGiven: number;
  trialing: number;
  paying: number;
  paymentFailed: number;
  cancelled: number;
};

export type SourceRow = {
  source: string;
  signedUp: number;
  withCompany: number;
  cardGiven: number;
  paying: number;
};

type Period = { from: Date; to: Date; exclude: readonly string[] };

// Emails can't contain a comma, so one text parameter carries the list.
const emails = (list: readonly string[]) =>
  sql`string_to_array(${list.map((e) => e.trim().toLowerCase()).join(",")}, ',')`;

/** How far the people who signed up in the period got. */
export async function platformFunnel(db: Database, period: Period): Promise<PlatformFunnel> {
  const result = await db.execute<Record<string, string | number>>(
    sql`select * from platform_funnel(${period.from.toISOString()}::timestamptz, ${period.to.toISOString()}::timestamptz, ${emails(period.exclude)})`,
  );
  const row = result.rows[0] ?? {};
  const n = (key: string) => Number(row[key] ?? 0);
  return {
    signedUp: n("signed_up"),
    verified: n("verified"),
    withCompany: n("with_company"),
    cardGiven: n("card_given"),
    trialing: n("trialing"),
    paying: n("paying"),
    paymentFailed: n("payment_failed"),
    cancelled: n("cancelled"),
  };
}

/** The same people, by where they came from, most first. */
export async function platformSignupSources(db: Database, period: Period): Promise<SourceRow[]> {
  const result = await db.execute<Record<string, string | number>>(
    sql`select * from platform_signup_sources(${period.from.toISOString()}::timestamptz, ${period.to.toISOString()}::timestamptz, ${emails(period.exclude)})`,
  );
  return result.rows.map((row) => ({
    source: String(row.source),
    signedUp: Number(row.signed_up),
    withCompany: Number(row.with_company),
    cardGiven: Number(row.card_given),
    paying: Number(row.paying),
  }));
}

export type PlatformOverview = {
  users: number;
  verifiedUsers: number;
  signups7d: number;
  signups30d: number;
  active1d: number;
  active7d: number;
  active30d: number;
  companies: number;
  companiesNew30d: number;
  companiesActive30d: number;
  trialing: number;
  paying: number;
  paymentFailed: number;
  cancelled: number;
  apiKeysUsed30d: number;
  openTickets: number;
};

export type DailyRow = { day: string; signups: number; active: number; newCompanies: number };

type AsOf = { now: Date; exclude: readonly string[] };

/** The admin Overview's totals as of `now`. Platform admins and their companies aren't counted. */
export async function platformOverview(db: Database, at: AsOf): Promise<PlatformOverview> {
  const result = await db.execute<Record<string, string | number>>(
    sql`select * from platform_overview(${at.now.toISOString()}::timestamptz, ${emails(at.exclude)})`,
  );
  const row = result.rows[0] ?? {};
  const n = (key: string) => Number(row[key] ?? 0);
  return {
    users: n("users"),
    verifiedUsers: n("verified_users"),
    signups7d: n("signups_7d"),
    signups30d: n("signups_30d"),
    active1d: n("active_1d"),
    active7d: n("active_7d"),
    active30d: n("active_30d"),
    companies: n("companies"),
    companiesNew30d: n("companies_new_30d"),
    companiesActive30d: n("companies_active_30d"),
    trialing: n("trialing"),
    paying: n("paying"),
    paymentFailed: n("payment_failed"),
    cancelled: n("cancelled"),
    apiKeysUsed30d: n("api_keys_used_30d"),
    openTickets: n("open_tickets"),
  };
}

/** Sign-ups, active people and new companies for each of the last `days` days (UTC), oldest first. */
export async function platformDaily(
  db: Database,
  at: AsOf & { days: number },
): Promise<DailyRow[]> {
  const result = await db.execute<Record<string, string | number | Date>>(
    sql`select day::text as day, signups, active, new_companies from platform_daily(${at.now.toISOString()}::timestamptz, ${at.days}::int, ${emails(at.exclude)})`,
  );
  return result.rows.map((row) => ({
    day: String(row.day),
    signups: Number(row.signups),
    active: Number(row.active),
    newCompanies: Number(row.new_companies),
  }));
}

export type PersonRow = {
  userId: string;
  name: string;
  email: string;
  signedUpAt: Date;
  emailVerified: boolean;
  /** "email", "google", or both ("email, google"); null if neither (shouldn't happen). */
  signIn: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  /** The landing page, else the referring site. */
  landing: string | null;
  companies: number;
  companyName: string | null;
  companyCountry: string | null;
  companyCreatedAt: Date | null;
  planStatus: string | null;
  planEnding: boolean;
  lastSeenAt: Date | null;
  changes30d: number;
};

export type PeopleQuery = {
  from: Date;
  to: Date;
  exclude: readonly string[];
  search?: string;
  limit: number;
  offset: number;
};

const date = (v: unknown) => (v == null ? null : new Date(v as string | Date));
const text = (v: unknown) => (v == null || v === "" ? null : String(v));

/**
 * The people who signed up in the period, newest first, for platform admins (the People page).
 * Each with their first company's name, country and plan, never any of its books.
 */
export async function platformPeople(
  db: Database,
  q: PeopleQuery,
): Promise<{ rows: PersonRow[]; total: number }> {
  // % and _ in a search are literal characters, not wildcards.
  const search = (q.search ?? "").trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const result = await db.execute<Record<string, unknown>>(
    sql`select * from platform_people(${q.from.toISOString()}::timestamptz, ${q.to.toISOString()}::timestamptz, ${emails(q.exclude)}, ${search}, ${q.limit}::int, ${q.offset}::int)`,
  );
  const rows = result.rows.map((r) => ({
    userId: String(r.user_id),
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    signedUpAt: new Date(r.signed_up_at as string | Date),
    emailVerified: Boolean(r.email_verified),
    signIn: text(r.sign_in),
    source: text(r.source),
    medium: text(r.medium),
    campaign: text(r.campaign),
    landing: text(r.landing),
    companies: Number(r.companies ?? 0),
    companyName: text(r.company_name),
    companyCountry: text(r.company_country),
    companyCreatedAt: date(r.company_created_at),
    planStatus: text(r.plan_status),
    planEnding: Boolean(r.plan_ending),
    lastSeenAt: date(r.last_seen_at),
    changes30d: Number(r.changes_30d ?? 0),
  }));
  return { rows, total: Number(result.rows[0]?.total ?? 0) };
}

export type PeopleSummary = {
  people: number;
  verified: number;
  withCompany: number;
  /** Sign-in methods, most first ("email", "google", "email, google", "none"). */
  methods: { label: string; people: number }[];
  /** Country of each person's first company, most first ("–" for a company without one). */
  countries: { label: string; people: number }[];
};

/** Totals for the same people as `platformPeople` (without the search). */
export async function platformPeopleSummary(
  db: Database,
  q: Pick<PeopleQuery, "from" | "to" | "exclude">,
): Promise<PeopleSummary> {
  const result = await db.execute<{ kind: string; label: string; people: string | number }>(
    sql`select * from platform_people_summary(${q.from.toISOString()}::timestamptz, ${q.to.toISOString()}::timestamptz, ${emails(q.exclude)})`,
  );
  const rows = result.rows.map((r) => ({ kind: r.kind, label: r.label, people: Number(r.people) }));
  const total = (label: string) =>
    rows.find((r) => r.kind === "total" && r.label === label)?.people ?? 0;
  const of = (kind: string) =>
    rows
      .filter((r) => r.kind === kind)
      .map(({ label, people }) => ({ label, people }))
      .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label));
  return {
    people: total("People"),
    verified: total("Confirmed their email"),
    withCompany: total("Set up a company"),
    methods: of("method"),
    countries: of("country"),
  };
}

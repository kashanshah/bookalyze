import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { platformDaily, platformOverview } from "../growth";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

// "Now" is in 1999, before every other test's rows (made today, or dated 2000 onwards), so they
// are all in its future and don't count, whatever order the test files run in. Keep other tests'
// rows after mid-1999 (platform-people uses August 2000, growth March 2001).
const now = new Date("1999-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const exclude = ["Admin@Overview.test"];

async function person(key: string, createdAt: Date, verified = true) {
  const [row] = await owner.db
    .insert(schema.user)
    .values({ name: key, email: `${key}@overview.test`, emailVerified: verified, createdAt })
    .returning({ id: schema.user.id });
  return row?.id ?? "";
}

async function company(userId: string, key: string, createdAt: Date, status?: string) {
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: key, slug: `overview-${key}`, createdAt })
    .returning({ id: schema.organization.id });
  const orgId = org?.id ?? "";
  await owner.db
    .insert(schema.member)
    .values({ organizationId: orgId, userId, role: "owner", createdAt });
  if (status) {
    await owner.db.insert(schema.subscriptions).values({
      organizationId: orgId,
      stripeSubscriptionId: `sub_overview_${key}`,
      status,
      interval: "month",
      cancelAtPeriodEnd: false,
      stripeUpdatedAt: createdAt,
    });
  }
  return orgId;
}

async function signIn(userId: string, at: Date) {
  await owner.db.insert(schema.session).values({
    userId,
    token: `overview-${userId}-${at.getTime()}`,
    expiresAt: new Date(at.getTime() + 7 * 86_400_000),
    createdAt: at,
    updatedAt: at,
  });
}

async function change(orgId: string, userId: string, at: Date) {
  await owner.db.insert(schema.auditLogs).values({
    organizationId: orgId,
    actorUserId: userId,
    action: "create",
    entityType: "contact",
    createdAt: at,
  });
}

beforeAll(async () => {
  // Signed up long ago, signed in today, changed something 3 days ago.
  const old = await person("old", daysAgo(200));
  const oldCo = await company(old, "old", daysAgo(200), "active");
  await signIn(old, daysAgo(0.25));
  await change(oldCo, old, daysAgo(3));

  // Signed up 5 days ago (unverified), set up a company, in the trial, last seen 5 days ago.
  const recent = await person("recent", daysAgo(5), false);
  await company(recent, "recent", daysAgo(5), "trialing");
  await signIn(recent, daysAgo(5));

  // Signed up 20 days ago, never came back; no company.
  await person("quiet", daysAgo(20));

  // Paid, then the card failed; seen 60 days ago only.
  const failed = await person("failed", daysAgo(90));
  await company(failed, "failed", daysAgo(90), "past_due");
  await signIn(failed, daysAgo(60));

  // A platform admin and their company: never counted.
  const admin = await person("admin", daysAgo(1));
  const adminCo = await company(admin, "admin", daysAgo(1), "active");
  await signIn(admin, daysAgo(0.1));
  await change(adminCo, admin, daysAgo(0.1));
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("platform overview", () => {
  it("adds up people, activity and companies, leaving platform admins out", async () => {
    expect(await platformOverview(app.db, { now, exclude })).toEqual({
      users: 4,
      verifiedUsers: 3,
      signups7d: 1,
      signups30d: 2,
      active1d: 1,
      active7d: 2,
      active30d: 2,
      companies: 3,
      companiesNew30d: 1,
      companiesActive30d: 1,
      trialing: 1,
      paying: 1,
      paymentFailed: 1,
      cancelled: 0,
      apiKeysUsed30d: 0,
      openTickets: expect.any(Number),
    });
  });

  it("counts admins too when nobody is excluded", async () => {
    const all = await platformOverview(app.db, { now, exclude: [] });
    expect(all.users).toBe(5);
    expect(all.companies).toBe(4);
    expect(all.active1d).toBe(2);
  });

  it("lists each day, oldest first", async () => {
    const days = await platformDaily(app.db, { now, days: 7, exclude });
    expect(days).toHaveLength(7);
    expect(days[0]?.day).toBe("1999-06-24");
    expect(days.at(-1)?.day).toBe("1999-06-30");
    const on = (day: string) => days.find((d) => d.day === day);
    expect(on("1999-06-25")).toEqual({ day: "1999-06-25", signups: 1, active: 1, newCompanies: 1 });
    expect(on("1999-06-27")).toEqual({ day: "1999-06-27", signups: 0, active: 1, newCompanies: 0 });
    expect(on("1999-06-30")).toEqual({ day: "1999-06-30", signups: 0, active: 1, newCompanies: 0 });
    expect(on("1999-06-29")).toEqual({ day: "1999-06-29", signups: 0, active: 0, newCompanies: 0 });
  });
});

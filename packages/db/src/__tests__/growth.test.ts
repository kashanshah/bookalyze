import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { platformFunnel, platformSignupSources, recordSignupSource } from "../growth";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

// A month of its own, so other tests' users (signed up today) don't count.
const period = {
  from: new Date("2001-03-01T00:00:00Z"),
  to: new Date("2001-04-01T00:00:00Z"),
  exclude: ["Admin@Growth.test"],
};
const at = new Date("2001-03-10T12:00:00Z");
const ids: Record<string, string> = {};

async function person(key: string, verified: boolean, createdAt = at) {
  const [row] = await owner.db
    .insert(schema.user)
    .values({ name: key, email: `${key}@growth.test`, emailVerified: verified, createdAt })
    .returning({ id: schema.user.id });
  ids[key] = row?.id ?? "";
  return ids[key];
}

async function company(userId: string, key: string, status?: string, ending = false) {
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: key, slug: `growth-${key}`, createdAt: at })
    .returning({ id: schema.organization.id });
  const orgId = org?.id ?? "";
  await owner.db
    .insert(schema.member)
    .values({ organizationId: orgId, userId, role: "owner", createdAt: at });
  if (status) {
    await owner.db.insert(schema.subscriptions).values({
      organizationId: orgId,
      stripeSubscriptionId: `sub_growth_${key}`,
      status,
      interval: "month",
      cancelAtPeriodEnd: ending,
      stripeUpdatedAt: at,
    });
  }
}

beforeAll(async () => {
  await person("unverified", false);
  await person("verified", true);
  await company(await person("nocard", true), "nocard");
  await company(await person("abandoned", true), "abandoned", "incomplete");
  await company(await person("trial", true), "trial", "trialing");
  await company(await person("trialcancel", true), "trialcancel", "trialing", true);
  await company(await person("paying", true), "paying", "active");
  await company(await person("failed", true), "failed", "past_due");
  await company(await person("gone", true), "gone", "canceled");
  // Not counted: a platform admin, and someone from another month.
  await company(await person("admin", true), "admin", "active");
  await person("later", true, new Date("2001-04-02T00:00:00Z"));
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("sign-up analytics", () => {
  it("counts how far each person got with their first company", async () => {
    expect(await platformFunnel(app.db, period)).toEqual({
      signedUp: 9,
      verified: 8,
      withCompany: 7,
      cardGiven: 5,
      trialing: 1,
      paying: 1,
      paymentFailed: 1,
      cancelled: 2,
    });
  });

  it("lets the app add a source but never read one back", async () => {
    await recordSignupSource(app.db, {
      userId: ids.paying ?? "",
      source: "google",
      medium: "cpc",
      campaign: "spring",
      referrer: null,
      landing: "/pricing",
    });
    await recordSignupSource(app.db, {
      userId: ids.trial ?? "",
      source: null,
      medium: null,
      campaign: null,
      referrer: "reddit.com",
      landing: "/",
    });
    // A second source for the same person changes nothing.
    await recordSignupSource(app.db, {
      userId: ids.paying ?? "",
      source: "bing",
      medium: null,
      campaign: null,
      referrer: null,
      landing: "/",
    });
    expect(await app.db.select().from(schema.signupSources)).toEqual([]);
    const kept = await owner.db.select().from(schema.signupSources);
    expect(kept.find((r) => r.userId === ids.paying)?.source).toBe("google");
  });

  it("groups the funnel by where people came from", async () => {
    const rows = await platformSignupSources(app.db, period);
    expect(rows).toEqual([
      { source: "Direct", signedUp: 7, withCompany: 5, cardGiven: 3, paying: 0 },
      { source: "google", signedUp: 1, withCompany: 1, cardGiven: 1, paying: 1 },
      { source: "reddit.com", signedUp: 1, withCompany: 1, cardGiven: 1, paying: 0 },
    ]);
  });
});

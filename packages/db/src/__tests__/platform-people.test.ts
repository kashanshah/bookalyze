import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client";
import { platformPeople, platformPeopleSummary, recordSignupSource } from "../growth";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

// A month in 1998, before every other test's rows, so only these people are in it.
const period = {
  from: new Date("1998-03-01T00:00:00Z"),
  to: new Date("1998-04-01T00:00:00Z"),
  exclude: ["Admin@People.test"],
};
const day = (d: number, h = 12) => new Date(Date.UTC(1998, 2, d, h));

async function person(key: string, at: Date, opts: { verified?: boolean; google?: boolean } = {}) {
  const [row] = await owner.db
    .insert(schema.user)
    .values({
      name: `Person ${key}`,
      email: `${key}@people.test`,
      emailVerified: opts.verified ?? true,
      createdAt: at,
    })
    .returning({ id: schema.user.id });
  const id = row?.id ?? "";
  await owner.db.insert(schema.account).values({
    userId: id,
    accountId: opts.google ? `google-${key}` : id,
    providerId: opts.google ? "google" : "credential",
    createdAt: at,
    updatedAt: at,
  });
  return id;
}

async function company(userId: string, key: string, at: Date, status?: string) {
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: `Company ${key}`, slug: `people-${key}`, createdAt: at })
    .returning({ id: schema.organization.id });
  const orgId = org?.id ?? "";
  await owner.db
    .insert(schema.member)
    .values({ organizationId: orgId, userId, role: "owner", createdAt: at });
  await owner.db.insert(schema.organizationProfiles).values({
    organizationId: orgId,
    legalName: `Company ${key} Inc.`,
    countryCode: "CA",
    baseCurrency: "CAD",
    timezone: "America/Toronto",
    locale: "en-CA",
  });
  if (status) {
    await owner.db.insert(schema.subscriptions).values({
      organizationId: orgId,
      stripeSubscriptionId: `sub_people_${key}`,
      status,
      interval: "month",
      cancelAtPeriodEnd: false,
      stripeUpdatedAt: at,
    });
  }
  return orgId;
}

let annaId = "";

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  await owner.db
    .insert(schema.countries)
    .values({ code: "CA", name: "Canada", currencyCode: "CAD" })
    .onConflictDoNothing();

  annaId = await person("anna", day(5));
  await company(annaId, "anna", day(5), "trialing");
  await owner.db.insert(schema.session).values({
    userId: annaId,
    token: "people-anna",
    expiresAt: day(30),
    createdAt: day(5),
    updatedAt: day(9),
  });
  await recordSignupSource(app.db, {
    userId: annaId,
    source: "google",
    medium: "cpc",
    campaign: "spring",
    referrer: null,
    landing: "/pricing",
  });

  await person("ben", day(10), { google: true });
  await person("cara", day(20), { verified: false });
  await person("admin", day(15));
  await person("later", new Date("1998-04-02T00:00:00Z"));
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("platform people", () => {
  it("lists who signed up, newest first, with their first company and plan", async () => {
    const { rows, total } = await platformPeople(app.db, { ...period, limit: 50, offset: 0 });
    expect(total).toBe(3);
    expect(rows.map((r) => r.email)).toEqual([
      "cara@people.test",
      "ben@people.test",
      "anna@people.test",
    ]);
    expect(rows[0]).toMatchObject({ emailVerified: false, signIn: "email", companies: 0 });
    expect(rows[1]).toMatchObject({ signIn: "google", companyName: null, planStatus: null });
    expect(rows[2]).toMatchObject({
      name: "Person anna",
      signIn: "email",
      source: "google",
      medium: "cpc",
      campaign: "spring",
      landing: "/pricing",
      companies: 1,
      companyName: "Company anna",
      companyCountry: "CA",
      planStatus: "trialing",
      planEnding: false,
    });
    expect(rows[2]?.lastSeenAt?.toISOString()).toBe(day(9).toISOString());
  });

  it("pages, and searches by name or email (wildcards are literal)", async () => {
    const page = await platformPeople(app.db, { ...period, limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.email)).toEqual(["ben@people.test"]);
    const found = await platformPeople(app.db, { ...period, search: "ANNA", limit: 50, offset: 0 });
    expect(found.rows.map((r) => r.email)).toEqual(["anna@people.test"]);
    expect(found.total).toBe(1);
    const literal = await platformPeople(app.db, { ...period, search: "%", limit: 50, offset: 0 });
    expect(literal.total).toBe(0);
  });

  it("includes platform admins when nobody is excluded", async () => {
    const { total } = await platformPeople(app.db, {
      ...period,
      exclude: [],
      limit: 50,
      offset: 0,
    });
    expect(total).toBe(4);
  });

  it("sums them up by sign-in method and country", async () => {
    expect(await platformPeopleSummary(app.db, period)).toEqual({
      people: 3,
      verified: 2,
      withCompany: 1,
      methods: [
        { label: "email", people: 2 },
        { label: "google", people: 1 },
      ],
      countries: [{ label: "CA", people: 1 }],
    });
  });
});

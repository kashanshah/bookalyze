import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withOrg } from "../client";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";

const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

/** Drizzle wraps driver errors; return the underlying Postgres message. */
async function pgErrorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(error);
  }
  throw new Error("Expected the query to fail");
}

let orgA: string;
let orgB: string;

beforeAll(async () => {
  const db = owner.db;
  await db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  await db
    .insert(schema.countries)
    .values({ code: "CA", name: "Canada", currencyCode: "CAD" })
    .onConflictDoNothing();
  await db
    .insert(schema.subdivisions)
    .values({ code: "CA-ON", countryCode: "CA", name: "Ontario" })
    .onConflictDoNothing();

  const [a, b] = await db
    .insert(schema.organization)
    .values([
      { name: "Org A", slug: "org-a", createdAt: new Date() },
      { name: "Org B", slug: "org-b", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  if (!a || !b) throw new Error("Failed to create test organizations");
  orgA = a.id;
  orgB = b.id;

  const profile = {
    countryCode: "CA",
    subdivisionCode: "CA-ON",
    baseCurrency: "CAD",
    timezone: "America/Toronto",
    locale: "en-CA",
  };
  await db.insert(schema.organizationProfiles).values([
    { organizationId: orgA, legalName: "Org A Inc.", ...profile },
    { organizationId: orgB, legalName: "Org B Inc.", ...profile },
  ]);
  await db.insert(schema.organizationModules).values([
    { organizationId: orgA, moduleKey: "accounting", enabled: true },
    { organizationId: orgB, moduleKey: "accounting", enabled: true },
    { organizationId: orgB, moduleKey: "banking", enabled: true },
  ]);
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("row-level security", () => {
  it("switches to app_runtime for tenant queries, then back", async () => {
    for (const db of [app.db, owner.db]) {
      const inside = await withOrg(db, { orgId: orgA }, (tx) =>
        tx.execute<{ role: string }>(sql`select current_user as role`),
      );
      expect(inside.rows[0]?.role).toBe("app_runtime");
    }
    // SET LOCAL: the next query on the same pooled connection is back to the login role.
    const after = await owner.db.execute<{ role: string }>(sql`select current_user as role`);
    expect(after.rows[0]?.role).not.toBe("app_runtime");
  });

  it("isolates organizations even when the app logs in as the owner", async () => {
    // Vercel's Neon integration only provides the owner login, which bypasses RLS on its own.
    expect((await owner.db.select().from(schema.organizationProfiles)).length).toBeGreaterThan(1);
    const profiles = await withOrg(owner.db, { orgId: orgA }, (tx) =>
      tx.select().from(schema.organizationProfiles),
    );
    expect(profiles.map((p) => p.legalName)).toEqual(["Org A Inc."]);

    const message = await pgErrorOf(
      withOrg(owner.db, { orgId: orgA }, (tx) =>
        tx
          .insert(schema.organizationModules)
          .values({ organizationId: orgB, moduleKey: "commerce", enabled: true }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it("returns no tenant rows without an organization context", async () => {
    expect(await app.db.select().from(schema.organizationProfiles)).toEqual([]);
    expect(await app.db.select().from(schema.organizationModules)).toEqual([]);
  });

  it("returns only the scoped organization's rows", async () => {
    const rows = await withOrg(app.db, { orgId: orgB }, (tx) =>
      tx.select().from(schema.organizationModules),
    );
    expect(rows.map((r) => r.organizationId)).toEqual([orgB, orgB]);

    const profiles = await withOrg(app.db, { orgId: orgA }, (tx) =>
      tx.select().from(schema.organizationProfiles),
    );
    expect(profiles.map((p) => p.legalName)).toEqual(["Org A Inc."]);
  });

  it("rejects writes into another organization", async () => {
    const message = await pgErrorOf(
      withOrg(app.db, { orgId: orgA }, (tx) =>
        tx
          .insert(schema.organizationModules)
          .values({ organizationId: orgB, moduleKey: "commerce", enabled: true }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it("cannot update another organization's rows", async () => {
    const updated = await withOrg(app.db, { orgId: orgA }, (tx) =>
      tx
        .update(schema.organizationProfiles)
        .set({ legalName: "Hijacked" })
        .where(eq(schema.organizationProfiles.organizationId, orgB))
        .returning(),
    );
    expect(updated).toEqual([]);
  });

  it("keeps the audit log append-only", async () => {
    await withOrg(app.db, { orgId: orgA }, (tx) =>
      tx
        .insert(schema.auditLogs)
        .values({ organizationId: orgA, action: "test", entityType: "test" }),
    );
    const message = await pgErrorOf(
      withOrg(app.db, { orgId: orgA }, (tx) => tx.delete(schema.auditLogs)),
    );
    expect(message).toMatch(/permission denied/);
  });

  it("keeps reference data read-only", async () => {
    const count = () =>
      app.db
        .execute<{ n: number }>(sql`select count(*)::int as n from currencies`)
        .then((r) => r.rows[0]?.n);
    const before = await count();
    const message = await pgErrorOf(
      app.db.insert(schema.currencies).values({ code: "ZZZ", name: "Test", minorUnits: 2 }),
    );
    expect(message).toMatch(/permission denied/);
    expect(await count()).toBe(before);
  });
});

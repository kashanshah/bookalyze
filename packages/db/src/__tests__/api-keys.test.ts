import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApiKey,
  generateApiKey,
  hashApiKey,
  listApiKeys,
  looksLikeApiKey,
  MAX_API_KEYS,
  resolveApiKey,
  revokeApiKey,
  touchApiKey,
} from "../api-keys";
import { createDb } from "../client";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let ana: string;
let ben: string;

beforeAll(async () => {
  const rows = await owner.db
    .insert(schema.user)
    .values([
      { name: "Ana Agent", email: "ana@api-keys.test" },
      { name: "Ben Builder", email: "ben@api-keys.test" },
    ])
    .returning({ id: schema.user.id });
  ana = rows[0]?.id ?? "";
  ben = rows[1]?.id ?? "";
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("API key secrets", () => {
  it("are long, random and recognisable, and only their hash is kept", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.secret).toMatch(/^bka_[A-Za-z0-9_-]{43}$/);
    expect(a.secret).not.toBe(b.secret);
    expect(a.prefix).toBe(a.secret.slice(0, 12));
    expect(a.hash).toBe(hashApiKey(a.secret));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(looksLikeApiKey(a.secret)).toBe(true);
    expect(looksLikeApiKey("bka_short")).toBe(false);
    expect(looksLikeApiKey(`Bearer ${a.secret}`)).toBe(false);
  });
});

describe("API keys in the database", () => {
  it("resolve by secret, with the key's access and companies", async () => {
    const orgs = ["00000000-0000-4000-8000-000000000001"];
    const made = await createApiKey(app.db, {
      userId: ana,
      name: "Claude Code",
      access: "write",
      organizationIds: orgs,
      expiresAt: null,
    });
    const [stored] = await owner.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, made.id));
    // The secret itself is never stored.
    expect(stored?.keyHash).toBe(hashApiKey(made.secret));
    expect(JSON.stringify(stored)).not.toContain(made.secret);

    const resolved = await resolveApiKey(app.db, made.secret);
    expect(resolved).toEqual({
      ok: true,
      key: { id: made.id, userId: ana, access: "write", organizationIds: orgs },
    });
  });

  it("refuse malformed, unknown, revoked and expired keys", async () => {
    expect(await resolveApiKey(app.db, "not-a-key")).toEqual({ ok: false, reason: "malformed" });
    expect(await resolveApiKey(app.db, generateApiKey().secret)).toEqual({
      ok: false,
      reason: "unknown",
    });

    const revoked = await createApiKey(app.db, {
      userId: ana,
      name: "Old script",
      access: "read",
      organizationIds: null,
      expiresAt: null,
    });
    // Someone else can't revoke it; its owner can, once.
    expect(await revokeApiKey(app.db, ben, revoked.id)).toBe(false);
    expect((await resolveApiKey(app.db, revoked.secret)).ok).toBe(true);
    expect(await revokeApiKey(app.db, ana, revoked.id)).toBe(true);
    expect(await revokeApiKey(app.db, ana, revoked.id)).toBe(false);
    expect(await resolveApiKey(app.db, revoked.secret)).toEqual({ ok: false, reason: "revoked" });

    const expiring = await createApiKey(app.db, {
      userId: ana,
      name: "Short-lived",
      access: "read",
      organizationIds: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await resolveApiKey(app.db, expiring.secret)).ok).toBe(true);
    expect(await resolveApiKey(app.db, expiring.secret, new Date(Date.now() + 120_000))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("are private to their owner, even to the app's own database role", async () => {
    await createApiKey(app.db, {
      userId: ben,
      name: "Ben's key",
      access: "read",
      organizationIds: null,
      expiresAt: null,
    });
    const anas = await listApiKeys(app.db, ana);
    const bens = await listApiKeys(app.db, ben);
    expect(anas.length).toBeGreaterThan(0);
    expect(anas.every((k) => k.userId === ana)).toBe(true);
    expect(bens.map((k) => k.name)).toEqual(["Ben's key"]);
    expect(Object.keys(bens[0] ?? {})).not.toContain("keyHash");
    // Outside withUser(), row-level security shows the runtime role no keys at all.
    const seen = await app.db.transaction(async (tx) => {
      await tx.execute("select set_config('role', 'app_runtime', true)");
      return tx.select().from(schema.apiKeys);
    });
    expect(seen).toEqual([]);
  });

  it("record when they were last used", async () => {
    const made = await createApiKey(app.db, {
      userId: ben,
      name: "Touched",
      access: "read",
      organizationIds: null,
      expiresAt: null,
    });
    await touchApiKey(app.db, made.id);
    const [row] = await owner.db
      .select({ lastUsedAt: schema.apiKeys.lastUsedAt })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, made.id));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("are capped per person", async () => {
    const user = (
      await owner.db
        .insert(schema.user)
        .values({ name: "Many Keys", email: "many@api-keys.test" })
        .returning({ id: schema.user.id })
    )[0]?.id as string;
    for (let i = 0; i < MAX_API_KEYS; i++) {
      await createApiKey(app.db, {
        userId: user,
        name: `Key ${i}`,
        access: "read",
        organizationIds: null,
        expiresAt: null,
      });
    }
    await expect(
      createApiKey(app.db, {
        userId: user,
        name: "One too many",
        access: "read",
        organizationIds: null,
        expiresAt: null,
      }),
    ).rejects.toThrow(/Revoke one/);
  });
});

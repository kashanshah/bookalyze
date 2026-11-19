import { sql } from "drizzle-orm";
import { check, index, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * API keys: how scripts and AI agents (the public API at /api/v1 and the MCP server at /api/mcp)
 * act as a person without a browser. A key belongs to one person and never reaches further than
 * that person can: only companies they're a member of, with their role there, and narrowed by the
 * key itself (read-only or read and write; all their companies or chosen ones).
 *
 * Only a SHA-256 hash of the secret is stored; the secret is shown once, when it's made. Keys
 * aren't deleted, only revoked, so audit log rows that name one keep their meaning.
 *
 * Row-level security: a person sees only their own keys (`app.user_id`, set by `withUser()`).
 * Checking a key on a request goes through `api_key_lookup()` (SECURITY DEFINER), which finds one
 * key by its hash and nothing else.
 */

export const API_KEY_ACCESS = ["read", "write"] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS)[number];

const currentUserId = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The start of the secret ("bka_" and a few characters), to recognise it in a list. */
    prefix: text("prefix").notNull(),
    /** SHA-256 of the whole secret, hex. */
    keyHash: text("key_hash").notNull().unique("api_keys_key_hash_key"),
    access: text("access", { enum: API_KEY_ACCESS }).notNull().default("read"),
    /** Null: every company the person belongs to. Otherwise only these. */
    organizationIds: uuid("organization_ids").array(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_keys_user_idx").on(t.userId),
    check("api_keys_name_present", sql`length(trim(${t.name})) between 1 and 80`),
    pgPolicy("api_keys_own", {
      as: "permissive",
      for: "all",
      using: sql`${t.userId} = ${currentUserId}`,
      withCheck: sql`${t.userId} = ${currentUserId}`,
    }),
  ],
).enableRLS();

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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
 * Apps connected with OAuth (Claude Code's "sign in with Bookalyze") are keys too, with a
 * `client_id`: their access token is the key's secret, replaced every hour from the refresh token
 * (`token_expires_at`, `refresh_hash`), and the person revokes them in the same list.
 *
 * Row-level security: a person sees only their own keys (`app.user_id`, set by `withUser()`).
 * Checking a key on a request goes through `api_key_lookup()` (SECURITY DEFINER), which finds one
 * key by its hash and nothing else.
 */

export const API_KEY_ACCESS = ["read", "write"] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS)[number];

const currentUserId = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

/**
 * Apps that registered themselves for OAuth (RFC 7591 dynamic client registration), such as each
 * Claude Code install. Registering grants nothing: a person still approves each app on the consent
 * screen. Public clients only (no client secret); PKCE protects the code exchange.
 */
export const oauthClients = pgTable("oauth_clients", {
  /** The client_id: "bkc_" and 22 random characters. */
  id: text("id").primaryKey(),
  /** The name the app gave itself. Unverified: the consent screen says so. */
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  /**
   * SHA-256 of the client secret, for apps that registered as confidential clients
   * (client_secret_post / client_secret_basic, as some hosted assistants do). Null: a public
   * client, protected by PKCE alone.
   */
  secretHash: text("secret_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** When a person last approved it. Never approved and a day old: removed on the next sign-up. */
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

/**
 * Authorization codes: issued when a person approves an app, exchanged once for tokens within
 * five minutes. Only a SHA-256 hash is stored, with the PKCE challenge and what was approved.
 */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    access: text("access", { enum: API_KEY_ACCESS }).notNull(),
    organizationIds: uuid("organization_ids").array(),
    /** How long the connection lasts, in days; null for until revoked. */
    lifetimeDays: integer("lifetime_days"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_codes_expires_idx").on(t.expiresAt)],
);

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
    /** Set for an app connected with OAuth; null for a key made by hand. */
    clientId: text("client_id").references(() => oauthClients.id),
    /** OAuth only: SHA-256 of the current refresh token. Replaced on every refresh. */
    refreshHash: text("refresh_hash").unique("api_keys_refresh_hash_key"),
    /** OAuth only: when the current access token stops working (an hour after it's issued). */
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_keys_user_idx").on(t.userId),
    index("api_keys_client_idx").on(t.clientId),
    check("api_keys_name_present", sql`length(trim(${t.name})) between 1 and 80`),
    pgPolicy("api_keys_own", {
      as: "permissive",
      for: "all",
      using: sql`${t.userId} = ${currentUserId}`,
      withCheck: sql`${t.userId} = ${currentUserId}`,
    }),
  ],
).enableRLS();

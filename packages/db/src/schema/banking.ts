import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, journalEntries } from "./accounting";
import { organization, user } from "./auth";
import { tenantIsolationPolicy } from "./tenancy";

/** "csv": bank statements uploaded as files, one connection per account. */
export const CONNECTION_PROVIDERS = ["wise", "csv"] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

export const CONNECTION_STATUSES = ["active", "error", "disconnected"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * A link to an outside service (a bank, a payment provider, later marketplaces). Credentials
 * are stored encrypted (`secret`, see vault.ts) and never leave the server.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: CONNECTION_PROVIDERS }).notNull(),
    /** What people call it, e.g. "Wise (Kazomo Inc.)". */
    name: text("name").notNull(),
    status: text("status", { enum: CONNECTION_STATUSES }).notNull().default("active"),
    /** Encrypted credentials (vault format); null once disconnected. */
    secret: text("secret"),
    /** Provider settings that aren't secret, e.g. the Wise profile. */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** The last sync's problem, in words fit to show. Cleared by a good sync. */
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("connections_org_id_key").on(t.organizationId, t.id),
    check(
      "connections_provider_valid",
      sql`${t.provider} in (${sql.raw(CONNECTION_PROVIDERS.map((p) => `'${p}'`).join(", "))})`,
    ),
    check(
      "connections_status_valid",
      sql`${t.status} in (${sql.raw(CONNECTION_STATUSES.map((s) => `'${s}'`).join(", "))})`,
    ),
    tenantIsolationPolicy("connections", t.organizationId),
  ],
);

/**
 * One account at the other end of a connection (a Wise balance) feeding one money account in
 * the ledger. Synced transactions are posted as journal entries with source 'bank_import'.
 */
export const bankFeeds = pgTable(
  "bank_feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    /** The provider's ID for it, e.g. the Wise balance ID. */
    externalId: text("external_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    name: text("name").notNull(),
    accountId: uuid("account_id").notNull(),
    /** Transactions before this date are never imported (the books before it came another way). */
    syncFrom: date("sync_from").notNull(),
    /** Everything up to this moment has been fetched. */
    syncedThrough: timestamp("synced_through", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("bank_feeds_org_id_key").on(t.organizationId, t.id),
    unique("bank_feeds_connection_external_key").on(t.connectionId, t.externalId),
    foreignKey({
      name: "bank_feeds_connection_fk",
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bank_feeds_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    tenantIsolationPolicy("bank_feeds", t.organizationId),
  ],
);

export const BANK_LINE_STATUSES = ["pending", "posted"] as const;
export type BankLineStatus = (typeof BANK_LINE_STATUSES)[number];

/**
 * Every transaction a bank has sent (a connection's sync, later a statement file), stored once:
 * `external_id` is unique per organization, so syncing again or uploading the same file again
 * never adds it twice. Its status says what became of it:
 * - posted: it's in the books as `journal_entry_id`. Editing the transaction or merging it with
 *   a duplicate moves the link to the entry that stands for it now;
 * - pending: it couldn't be posted yet (`reason`, e.g. no exchange rate) and is tried again.
 */
export const bankLines = pgTable(
  "bank_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    feedId: uuid("feed_id").notNull(),
    externalId: text("external_id").notNull(),
    /** Links the two sides of a conversion between the company's own balances. */
    pairKey: text("pair_key"),
    date: date("date").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** Signed: positive = money in. Fees included. */
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    fee: numeric("fee", { precision: 20, scale: 4 }).notNull().default("0"),
    description: text("description").notNull(),
    counterparty: text("counterparty"),
    reference: text("reference"),
    kind: text("kind").notNull(),
    /** For a conversion: the other side, e.g. {"otherCurrency":"USD","otherAmount":"100.0000"}. */
    conversion: jsonb("conversion").$type<{ otherCurrency: string; otherAmount: string } | null>(),
    status: text("status", { enum: BANK_LINE_STATUSES }).notNull().default("pending"),
    journalEntryId: uuid("journal_entry_id"),
    /** Why it's still pending, in words fit to show. */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("bank_lines_org_id_key").on(t.organizationId, t.id),
    unique("bank_lines_org_external_key").on(t.organizationId, t.externalId),
    index("bank_lines_org_status_idx").on(t.organizationId, t.status),
    index("bank_lines_journal_entry_idx").on(t.journalEntryId),
    foreignKey({
      name: "bank_lines_feed_fk",
      columns: [t.organizationId, t.feedId],
      foreignColumns: [bankFeeds.organizationId, bankFeeds.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bank_lines_journal_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check(
      "bank_lines_status_valid",
      sql`${t.status} in (${sql.raw(BANK_LINE_STATUSES.map((s) => `'${s}'`).join(", "))})`,
    ),
    check(
      "bank_lines_status_links",
      sql`(${t.status} = 'posted') = (${t.journalEntryId} is not null)`,
    ),
    tenantIsolationPolicy("bank_lines", t.organizationId),
  ],
);

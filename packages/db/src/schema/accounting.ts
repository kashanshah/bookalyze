import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, SYSTEM_ACCOUNT_KEYS } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { currencies } from "./reference";
import { tenantIsolationPolicy } from "./tenancy";

/**
 * The ledger. Invariants enforced by the database (see migration 0004_ledger_invariants):
 * - every journal entry has at least two lines, and its lines sum to zero in both the entry
 *   currency and the base currency (checked at commit);
 * - posted entries and lines are immutable for the app: corrections are reversing entries;
 * - lines can only point at accounts and entries of the same organization (composite keys),
 *   because foreign key checks don't go through row-level security.
 */

const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", "));

export const JOURNAL_SOURCES = ["manual", "reversal", "bank_import", "wave_import"] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code"),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    subtype: text("subtype").notNull(),
    description: text("description"),
    /** Set for accounts that hold one currency (bank, card); null accepts any currency. */
    currency: char("currency", { length: 3 }).references(() => currencies.code),
    /** Accounts the system posts to (uncategorized, retained earnings, FX); can't be archived. */
    systemKey: text("system_key"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("accounts_org_id_key").on(t.organizationId, t.id),
    unique("accounts_org_code_key").on(t.organizationId, t.code),
    unique("accounts_org_system_key_key").on(t.organizationId, t.systemKey),
    check("accounts_type_valid", sql`${t.type} in (${inList(ACCOUNT_TYPES)})`),
    check(
      "accounts_subtype_valid",
      sql`${t.subtype} in (${inList(ACCOUNT_SUBTYPES.map((s) => s.key))})`,
    ),
    check(
      "accounts_system_key_valid",
      sql`${t.systemKey} is null or ${t.systemKey} in (${inList(SYSTEM_ACCOUNT_KEYS)})`,
    ),
    check("accounts_name_present", sql`length(trim(${t.name})) > 0`),
    tenantIsolationPolicy("accounts", t.organizationId),
  ],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Sequential per organization, shown as "JE-0001". */
    entryNumber: integer("entry_number").notNull(),
    date: date("date").notNull(),
    reference: text("reference"),
    memo: text("memo"),
    currency: char("currency", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    /** Base-currency units per unit of `currency` (1 when they're the same). */
    fxRate: numeric("fx_rate", { precision: 20, scale: 10 }).notNull().default("1"),
    source: text("source", { enum: JOURNAL_SOURCES }).notNull().default("manual"),
    /** Identifier in the source system (e.g. a Wave transaction id), for traceability. */
    sourceId: text("source_id"),
    reversesEntryId: uuid("reverses_entry_id"),
    /** The only column the app may update, once, when the entry is reversed. */
    reversedByEntryId: uuid("reversed_by_entry_id"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("journal_entries_org_id_key").on(t.organizationId, t.id),
    unique("journal_entries_org_number_key").on(t.organizationId, t.entryNumber),
    index("journal_entries_org_date_idx").on(t.organizationId, t.date),
    foreignKey({
      name: "journal_entries_reverses_fk",
      columns: [t.organizationId, t.reversesEntryId],
      foreignColumns: [t.organizationId, t.id],
    }),
    foreignKey({
      name: "journal_entries_reversed_by_fk",
      columns: [t.organizationId, t.reversedByEntryId],
      foreignColumns: [t.organizationId, t.id],
    }),
    check("journal_entries_fx_rate_positive", sql`${t.fxRate} > 0`),
    check("journal_entries_source_valid", sql`${t.source} in (${inList(JOURNAL_SOURCES)})`),
    tenantIsolationPolicy("journal_entries", t.organizationId),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    journalEntryId: uuid("journal_entry_id").notNull(),
    lineNo: smallint("line_no").notNull(),
    accountId: uuid("account_id").notNull(),
    description: text("description"),
    /** Signed, in the entry currency: debits positive, credits negative. */
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    /** Signed, in the organization's base currency. */
    baseAmount: numeric("base_amount", { precision: 20, scale: 4 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "journal_lines_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "journal_lines_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    unique("journal_lines_entry_line_key").on(t.journalEntryId, t.lineNo),
    index("journal_lines_org_account_idx").on(t.organizationId, t.accountId),
    check("journal_lines_amount_nonzero", sql`${t.amount} <> 0`),
    tenantIsolationPolicy("journal_lines", t.organizationId),
  ],
);

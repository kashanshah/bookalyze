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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { importBatches } from "./imports";
import { currencies } from "./reference";
import { taxRates } from "./tax";
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

/** "import": brought in from other accounting software (see import_batches). */
export const JOURNAL_SOURCES = [
  "manual",
  "reversal",
  "bank_import",
  "wave_import",
  "import",
  /** An Amazon settlement (commerce settlements). */
  "settlement",
  /** A month's cost of goods sold on one marketplace (inventory cogs_periods). */
  "cogs",
  /** Stock on hand before Bookalyze, valued as an opening lot (inventory_lots). */
  "opening_stock",
] as const;
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
    /** The import that created it, if any (removed again if that import is undone). */
    importBatchId: uuid("import_batch_id"),
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
    foreignKey({
      name: "accounts_import_batch_fk",
      columns: [t.organizationId, t.importBatchId],
      foreignColumns: [importBatches.organizationId, importBatches.id],
    }),
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

export const CONTACT_TYPES = ["customer", "vendor", "both"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

/** Customers and vendors. Archived contacts keep their history but leave the pickers. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type", { enum: CONTACT_TYPES }).notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** Their business or tax number (e.g. GST/HST or VAT number), as it appears on invoices. */
    taxNumber: text("tax_number"),
    address: text("address"),
    notes: text("notes"),
    isArchived: boolean("is_archived").notNull().default(false),
    /** The import that created it, if any (removed again if that import is undone). */
    importBatchId: uuid("import_batch_id"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("contacts_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("contacts_org_type_name_key").on(t.organizationId, t.type, sql`lower(${t.name})`),
    foreignKey({
      name: "contacts_import_batch_fk",
      columns: [t.organizationId, t.importBatchId],
      foreignColumns: [importBatches.organizationId, importBatches.id],
    }),
    check("contacts_type_valid", sql`${t.type} in (${inList(CONTACT_TYPES)})`),
    check("contacts_name_present", sql`length(trim(${t.name})) > 0`),
    tenantIsolationPolicy("contacts", t.organizationId),
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
    /** The customer or vendor this entry is with, if any. */
    contactId: uuid("contact_id"),
    /** The import it came from; `source_id` then holds its ID in the other program. */
    importBatchId: uuid("import_batch_id"),
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
      name: "journal_entries_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
    index("journal_entries_org_contact_idx").on(t.organizationId, t.contactId),
    foreignKey({
      name: "journal_entries_import_batch_fk",
      columns: [t.organizationId, t.importBatchId],
      foreignColumns: [importBatches.organizationId, importBatches.id],
    }),
    index("journal_entries_import_batch_idx").on(t.importBatchId),
    // An entry from another program is in the books once, however many times its file is
    // imported. A removed (reversed) one no longer counts, so importing again brings it back;
    // an edited one keeps the ID on its replacement.
    uniqueIndex("journal_entries_org_import_source_key")
      .on(t.organizationId, t.sourceId)
      .where(sql`${t.source} = 'import' and ${t.reversedByEntryId} is null`),
    // A bank transaction is in the books once. A removed (reversed) one no longer counts, so the
    // next sync or statement upload brings it back. An edit moves the bank line to its replacement.
    uniqueIndex("journal_entries_org_bank_source_key")
      .on(t.organizationId, t.sourceId)
      .where(sql`${t.source} = 'bank_import' and ${t.reversedByEntryId} is null`),
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
    /**
     * The line's currency: the entry currency, except for lines in another currency such as the
     * receiving side of a cross-currency transfer. Must match the account's currency if it has one.
     */
    currency: char("currency", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    /** Signed, in the line currency: debits positive, credits negative. */
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    /** Signed, in the organization's base currency. */
    baseAmount: numeric("base_amount", { precision: 20, scale: 4 }).notNull(),
    /**
     * Sales tax rate: set on a taxed line (the amount the tax was charged on) and on the tax line
     * itself, which is the line on the rate's account.
     */
    taxRateId: uuid("tax_rate_id"),
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
    foreignKey({
      name: "journal_lines_tax_rate_fk",
      columns: [t.organizationId, t.taxRateId],
      foreignColumns: [taxRates.organizationId, taxRates.id],
    }),
    index("journal_lines_org_tax_rate_idx").on(t.organizationId, t.taxRateId),
    unique("journal_lines_entry_line_key").on(t.journalEntryId, t.lineNo),
    unique("journal_lines_org_id_key").on(t.organizationId, t.id),
    index("journal_lines_org_account_idx").on(t.organizationId, t.accountId),
    check("journal_lines_amount_nonzero", sql`${t.amount} <> 0`),
    tenantIsolationPolicy("journal_lines", t.organizationId),
  ],
);

/**
 * Transactions someone has checked ("reviewed" on the Transactions screen). Kept apart from
 * journal_entries because posted entries are immutable while review status changes freely.
 */
export const transactionReviews = pgTable(
  "transaction_reviews",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    journalEntryId: uuid("journal_entry_id").primaryKey(),
    reviewedBy: uuid("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "transaction_reviews_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("transaction_reviews", t.organizationId),
  ],
);

export const DUPLICATE_STATUSES = ["open", "merged", "dismissed"] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

/**
 * "This transaction might be a copy of that one", found when a bank line is brought in. Both
 * stay in the books until someone decides: merging keeps `duplicate_of_entry_id` and reverses
 * `entry_id`; dismissing leaves both. A pair is only ever suggested once.
 */
export const duplicateSuggestions = pgTable(
  "duplicate_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The newer one, from the bank: removed if they're merged. */
    entryId: uuid("entry_id").notNull(),
    /** The one already in the books: kept if they're merged. */
    duplicateOfEntryId: uuid("duplicate_of_entry_id").notNull(),
    status: text("status", { enum: DUPLICATE_STATUSES }).notNull().default("open"),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("duplicate_suggestions_pair_key").on(t.organizationId, t.entryId, t.duplicateOfEntryId),
    index("duplicate_suggestions_org_status_idx").on(t.organizationId, t.status),
    index("duplicate_suggestions_entry_idx").on(t.entryId),
    index("duplicate_suggestions_duplicate_of_idx").on(t.duplicateOfEntryId),
    foreignKey({
      name: "duplicate_suggestions_entry_fk",
      columns: [t.organizationId, t.entryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "duplicate_suggestions_duplicate_of_fk",
      columns: [t.organizationId, t.duplicateOfEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check(
      "duplicate_suggestions_status_valid",
      sql`${t.status} in (${inList(DUPLICATE_STATUSES)})`,
    ),
    check("duplicate_suggestions_distinct", sql`${t.entryId} <> ${t.duplicateOfEntryId}`),
    tenantIsolationPolicy("duplicate_suggestions", t.organizationId),
  ],
);

export const TRANSFER_MATCH_STATUSES = ["matched", "dismissed", "unmatched"] as const;
export type TransferMatchStatus = (typeof TRANSFER_MATCH_STATUSES)[number];

/**
 * Two transactions, money out of one account and money into another, seen as one transfer:
 * - `matched`: both were reversed and `transfer_entry_id` stands for them (it follows edits);
 * - `dismissed`: someone said they aren't a transfer, so the pair isn't suggested again;
 * - `unmatched`: a match that was undone; the two sides were posted again (`out_entry_id` and
 *   `in_entry_id` then point at the new ones, so they aren't suggested again either).
 */
export const transferMatches = pgTable(
  "transfer_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    outEntryId: uuid("out_entry_id").notNull(),
    inEntryId: uuid("in_entry_id").notNull(),
    transferEntryId: uuid("transfer_entry_id"),
    status: text("status", { enum: TRANSFER_MATCH_STATUSES }).notNull(),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("transfer_matches_pair_key").on(t.organizationId, t.outEntryId, t.inEntryId),
    index("transfer_matches_out_idx").on(t.outEntryId),
    index("transfer_matches_in_idx").on(t.inEntryId),
    index("transfer_matches_transfer_idx").on(t.transferEntryId),
    foreignKey({
      name: "transfer_matches_out_fk",
      columns: [t.organizationId, t.outEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "transfer_matches_in_fk",
      columns: [t.organizationId, t.inEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "transfer_matches_transfer_fk",
      columns: [t.organizationId, t.transferEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check(
      "transfer_matches_status_valid",
      sql`${t.status} in (${inList(TRANSFER_MATCH_STATUSES)})`,
    ),
    check("transfer_matches_distinct", sql`${t.outEntryId} <> ${t.inEntryId}`),
    check(
      "transfer_matches_transfer_when_matched",
      sql`(${t.status} = 'matched') = (${t.transferEntryId} is not null)`,
    ),
    tenantIsolationPolicy("transfer_matches", t.organizationId),
  ],
);

import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { attachments } from "./files";
import { tenantIsolationPolicy } from "./tenancy";

/**
 * Entity & compliance: the company's legal details beyond its profile (organization_profiles
 * holds legal name, entity type and incorporation date), the people who run and own it, its
 * documents, and its compliance calendar. The calendar itself is worked out from these (see
 * `complianceCalendar` in core); only items added by hand, "done" ticks and sent reminders are
 * stored.
 */

export const COMPLIANCE_RECURRENCE_KEYS = ["once", "monthly", "quarterly", "yearly"] as const;

/** One row per company: where it's incorporated and its registered address. */
export const entityDetails = pgTable(
  "entity_details",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** A code from JURISDICTIONS in core, e.g. "CA-FED", "CA-ON", "AE-DU". */
    jurisdiction: text("jurisdiction"),
    registeredAddress: text("registered_address"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [tenantIsolationPolicy("entity_details", t.organizationId)],
);

/** Registration numbers (BN, corporation number, trade license…), some with an expiry date. */
export const entityIdentifiers = pgTable(
  "entity_identifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** A key from IDENTIFIER_KINDS in core. */
    kind: text("kind").notNull(),
    /** For kind "other": what it is. */
    label: text("label"),
    value: text("value").notNull(),
    expiresOn: date("expires_on"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entity_identifiers_org_idx").on(t.organizationId),
    check("entity_identifiers_value_present", sql`length(trim(${t.value})) > 0`),
    tenantIsolationPolicy("entity_identifiers", t.organizationId),
  ],
);

/** Directors, officers, owners and individuals with significant control. */
export const entityPeople = pgTable(
  "entity_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Keys from PERSON_ROLES in core. */
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
    title: text("title"),
    /** Share of ownership in percent, e.g. 50.0000. */
    ownershipPercent: numeric("ownership_percent", { precision: 7, scale: 4 }),
    email: text("email"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entity_people_org_idx").on(t.organizationId),
    check("entity_people_name_present", sql`length(trim(${t.name})) > 0`),
    check(
      "entity_people_ownership_range",
      sql`${t.ownershipPercent} is null or (${t.ownershipPercent} >= 0 and ${t.ownershipPercent} <= 100)`,
    ),
    tenantIsolationPolicy("entity_people", t.organizationId),
  ],
);

/**
 * Documents in the vault. The file is an attachment (linked as "entity_document", so it never
 * shows in the receipts inbox); this row adds what it is and when it expires.
 */
export const entityDocuments = pgTable(
  "entity_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id").notNull(),
    title: text("title").notNull(),
    /** A key from DOCUMENT_KINDS in core. */
    kind: text("kind").notNull().default("other"),
    expiresOn: date("expires_on"),
    uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entity_documents_org_idx").on(t.organizationId),
    foreignKey({
      name: "entity_documents_attachment_fk",
      columns: [t.organizationId, t.attachmentId],
      foreignColumns: [attachments.organizationId, attachments.id],
    }).onDelete("cascade"),
    check("entity_documents_title_present", sql`length(trim(${t.title})) > 0`),
    tenantIsolationPolicy("entity_documents", t.organizationId),
  ],
);

/** Obligations added by hand, once or repeating from `first_due`. */
export const complianceItems = pgTable(
  "compliance_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    firstDue: date("first_due").notNull(),
    recurrence: text("recurrence", { enum: COMPLIANCE_RECURRENCE_KEYS }).notNull().default("once"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("compliance_items_org_idx").on(t.organizationId),
    check("compliance_items_title_present", sql`length(trim(${t.title})) > 0`),
    check(
      "compliance_items_recurrence_valid",
      sql`${t.recurrence} in ('once', 'monthly', 'quarterly', 'yearly')`,
    ),
    tenantIsolationPolicy("compliance_items", t.organizationId),
  ],
);

/** "Done" ticks, one per occurrence (item key + due date). */
export const complianceCompletions = pgTable(
  "compliance_completions",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    dueDate: date("due_date").notNull(),
    completedBy: uuid("completed_by").references(() => user.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("compliance_completions_key").on(t.organizationId, t.itemKey, t.dueDate),
    tenantIsolationPolicy("compliance_completions", t.organizationId),
  ],
);

/** Reminder emails already sent, so each lead time goes out once per occurrence. */
export const complianceReminders = pgTable(
  "compliance_reminders",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    dueDate: date("due_date").notNull(),
    leadDays: smallint("lead_days").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("compliance_reminders_key").on(t.organizationId, t.itemKey, t.dueDate, t.leadDays),
    tenantIsolationPolicy("compliance_reminders", t.organizationId),
  ],
);

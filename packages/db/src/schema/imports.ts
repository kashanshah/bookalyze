import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { tenantIsolationPolicy } from "./tenancy";

export const IMPORT_STATUSES = ["in_progress", "completed", "undone"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * One import of history from other accounting software. Entries, accounts and contacts it
 * creates point back to it, so the whole import can be undone (see migration 0013).
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The program it came from, e.g. "wave" or "quickbooks" (see IMPORT_SOURCES in core). */
    source: text("source").notNull(),
    fileName: text("file_name").notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("in_progress"),
    entryCount: integer("entry_count").notNull().default(0),
    /** Entries in the file that were already imported before, and were left alone. */
    skippedCount: integer("skipped_count").notNull().default(0),
    accountCount: integer("account_count").notNull().default(0),
    contactCount: integer("contact_count").notNull().default(0),
    firstDate: date("first_date"),
    lastDate: date("last_date"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    unique("import_batches_org_id_key").on(t.organizationId, t.id),
    check(
      "import_batches_status_valid",
      sql`${t.status} in ('in_progress', 'completed', 'undone')`,
    ),
    tenantIsolationPolicy("import_batches", t.organizationId),
  ],
);

import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, journalLines } from "./accounting";
import { organization, user } from "./auth";
import { tenantIsolationPolicy } from "./tenancy";

export const RECONCILIATION_STATUSES = ["in_progress", "completed"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

/**
 * Matching an account against a bank or card statement. While in progress, lines are ticked
 * as they appear on the statement; once the cleared balance equals the statement's ending
 * balance it's completed, and its lines' entries can no longer be changed (migration 0014).
 */
export const reconciliations = pgTable(
  "reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    /** The statement's closing date. */
    statementDate: date("statement_date").notNull(),
    /** The statement's ending balance, in the account's currency, as the statement shows it. */
    statementBalance: numeric("statement_balance", { precision: 20, scale: 4 }).notNull(),
    status: text("status", { enum: RECONCILIATION_STATUSES }).notNull().default("in_progress"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    completedBy: uuid("completed_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("reconciliations_org_id_key").on(t.organizationId, t.id),
    foreignKey({
      name: "reconciliations_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    // One reconciliation in progress per account at a time.
    uniqueIndex("reconciliations_account_in_progress_key")
      .on(t.organizationId, t.accountId)
      .where(sql`${t.status} = 'in_progress'`),
    index("reconciliations_account_date_idx").on(t.organizationId, t.accountId, t.statementDate),
    check("reconciliations_status_valid", sql`${t.status} in ('in_progress', 'completed')`),
    tenantIsolationPolicy("reconciliations", t.organizationId),
  ],
);

/** The journal lines a reconciliation has ticked as on the statement. A line clears once. */
export const reconciliationLines = pgTable(
  "reconciliation_lines",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    journalLineId: uuid("journal_line_id").primaryKey(),
    reconciliationId: uuid("reconciliation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "reconciliation_lines_reconciliation_fk",
      columns: [t.organizationId, t.reconciliationId],
      foreignColumns: [reconciliations.organizationId, reconciliations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reconciliation_lines_line_fk",
      columns: [t.organizationId, t.journalLineId],
      foreignColumns: [journalLines.organizationId, journalLines.id],
    }).onDelete("cascade"),
    index("reconciliation_lines_reconciliation_idx").on(t.reconciliationId),
    tenantIsolationPolicy("reconciliation_lines", t.organizationId),
  ],
);

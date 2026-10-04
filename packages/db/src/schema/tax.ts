import { FILING_FREQUENCIES } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounting";
import { organization, user } from "./auth";
import { tenantIsolationPolicy } from "./tenancy";

/**
 * Sales tax setup per organization. Rates are what transactions are tagged with
 * (journal_lines.tax_rate_id); registrations record who the company files with and how often.
 */

/** A sales tax rate. The percentage and account are fixed once created; archive to retire one. */
export const taxRates = pgTable(
  "tax_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Percent, e.g. 13 or 9.975. */
    rate: numeric("rate", { precision: 7, scale: 4 }).notNull(),
    /** Liability account that holds tax collected and tax claimable at this rate. */
    accountId: uuid("account_id").notNull(),
    /** Whether tax paid on purchases at this rate can be claimed back. */
    isRecoverable: boolean("is_recoverable").notNull().default(true),
    isArchived: boolean("is_archived").notNull().default(false),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("tax_rates_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("tax_rates_org_name_key").on(t.organizationId, sql`lower(${t.name})`),
    foreignKey({
      name: "tax_rates_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    check("tax_rates_rate_range", sql`${t.rate} >= 0 and ${t.rate} <= 100`),
    check("tax_rates_name_present", sql`length(trim(${t.name})) > 0`),
    tenantIsolationPolicy("tax_rates", t.organizationId),
  ],
);

/** Where the company is registered to collect sales tax, and how often it files. */
export const taxRegistrations = pgTable(
  "tax_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Who the company files with, e.g. "Canada Revenue Agency (GST/HST)". */
    authority: text("authority").notNull(),
    /** As issued by the authority, e.g. a GST/HST or VAT number. */
    registrationNumber: text("registration_number"),
    filingFrequency: text("filing_frequency", { enum: FILING_FREQUENCIES })
      .notNull()
      .default("quarterly"),
    /** When the registration took effect (the first filing period starts here). */
    effectiveFrom: date("effective_from"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "tax_registrations_frequency_valid",
      sql`${t.filingFrequency} in ('monthly', 'quarterly', 'annual')`,
    ),
    check("tax_registrations_authority_present", sql`length(trim(${t.authority})) > 0`),
    tenantIsolationPolicy("tax_registrations", t.organizationId),
  ],
);

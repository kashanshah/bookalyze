import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { countries, currencies, subdivisions } from "./reference";
import { tenantIsolationPolicy } from "./tenancy";

export const ENTITY_TYPES = [
  "corporation",
  "sole_proprietorship",
  "partnership",
  "llc",
  "nonprofit",
  "other",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Policies below also enable row-level security on these tables. */

/** Localization, fiscal and legal settings for an organization (1:1 with `organization`). */
export const organizationProfiles = pgTable(
  "organization_profiles",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    tradeName: text("trade_name"),
    entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull().default("corporation"),
    countryCode: char("country_code", { length: 2 })
      .notNull()
      .references(() => countries.code),
    subdivisionCode: text("subdivision_code").references(() => subdivisions.code),
    baseCurrency: char("base_currency", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    timezone: text("timezone").notNull(),
    locale: text("locale").notNull(),
    fiscalYearEndMonth: smallint("fiscal_year_end_month").notNull().default(12),
    fiscalYearEndDay: smallint("fiscal_year_end_day").notNull().default(31),
    firstFiscalYearStart: date("first_fiscal_year_start"),
    incorporationDate: date("incorporation_date"),
    planKey: text("plan_key").notNull().default("internal_unlimited"),
    /**
     * Books are closed through this date: no journal entry may be dated on or before it
     * (enforced by a trigger, see migration 0006_period_locks). Null means nothing is closed.
     */
    booksLockedThrough: date("books_locked_through"),
    /** The home page hides "Get started with Bookalyze" when this is on. */
    gettingStartedHidden: boolean("getting_started_hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("fiscal_year_end_month_range", sql`${t.fiscalYearEndMonth} between 1 and 12`),
    check("fiscal_year_end_day_range", sql`${t.fiscalYearEndDay} between 1 and 31`),
    tenantIsolationPolicy("organization_profiles", t.organizationId),
  ],
);

/** Which modules an organization has switched on (see @bookalyze/core module registry). */
export const organizationModules = pgTable(
  "organization_modules",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.moduleKey] }),
    tenantIsolationPolicy("organization_modules", t.organizationId),
  ],
);

/** Append-only log of writes. The app role may insert and read, never update or delete. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    tenantIsolationPolicy("audit_logs", t.organizationId),
  ],
);

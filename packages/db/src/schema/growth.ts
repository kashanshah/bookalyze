import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Where each account came from (the first utm tags and referring site, kept in a cookie until
 * sign-up). Not a company's data, so no organization: the app may only add rows, and reads go
 * through `platform_signup_sources()`, which gives totals and never a person.
 */
export const signupSources = pgTable(
  "signup_sources",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source"),
    medium: text("medium"),
    campaign: text("campaign"),
    referrer: text("referrer"),
    landing: text("landing"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    pgPolicy("signup_sources_insert", { as: "permissive", for: "insert", withCheck: sql`true` }),
  ],
);

import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** ISO 4217 currencies. Global, read-only reference data. */
export const currencies = pgTable("currencies", {
  code: char("code", { length: 3 }).primaryKey(),
  name: text("name").notNull(),
  minorUnits: smallint("minor_units").notNull(),
});

/** ISO 3166-1 countries. Global, read-only reference data. */
export const countries = pgTable("countries", {
  code: char("code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
  currencyCode: char("currency_code", { length: 3 }).references(() => currencies.code),
});

/** ISO 3166-2 subdivisions (states, provinces, emirates…). Global, read-only reference data. */
export const subdivisions = pgTable("subdivisions", {
  code: text("code").primaryKey(),
  countryCode: char("country_code", { length: 2 })
    .notNull()
    .references(() => countries.code),
  name: text("name").notNull(),
});

/**
 * Daily exchange rates: one unit of `quote` is worth `rate` units of `base`. Global, not
 * per organization (public data). Bank of Canada rates are stored with base CAD; other pairs
 * are derived (see crossRate in core).
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    date: date("date").notNull(),
    base: char("base", { length: 3 }).notNull(),
    quote: char("quote", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.base, t.quote] }),
    check("fx_rates_rate_positive", sql`${t.rate} > 0`),
  ],
);

import { char, pgTable, smallint, text } from "drizzle-orm/pg-core";

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

import "./load-env";
import { countries, currencies, subdivisions } from "@bookalyze/core/reference-data";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { withVerifiedSsl } from "../src/client";
import * as schema from "../src/schema";

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) throw new Error("DATABASE_URL_MIGRATOR is not set");

const pool = new pg.Pool({ connectionString: withVerifiedSsl(url), max: 1 });
const db = drizzle(pool, { schema, casing: "snake_case" });

function chunks<T>(rows: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// Reference data is idempotent: upsert everything on every run.
await db.transaction(async (tx) => {
  for (const batch of chunks(currencies)) {
    await tx
      .insert(schema.currencies)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.currencies.code,
        set: { name: sql`excluded.name`, minorUnits: sql`excluded.minor_units` },
      });
  }
  for (const batch of chunks(countries)) {
    await tx
      .insert(schema.countries)
      .values(batch.map((c) => ({ code: c.code, name: c.name, currencyCode: c.currency })))
      .onConflictDoUpdate({
        target: schema.countries.code,
        set: { name: sql`excluded.name`, currencyCode: sql`excluded.currency_code` },
      });
  }
  for (const batch of chunks(subdivisions)) {
    await tx
      .insert(schema.subdivisions)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.subdivisions.code,
        set: { name: sql`excluded.name`, countryCode: sql`excluded.country_code` },
      });
  }
});

await pool.end();
console.info(
  `Seeded ${currencies.length} currencies, ${countries.length} countries, ${subdivisions.length} subdivisions`,
);

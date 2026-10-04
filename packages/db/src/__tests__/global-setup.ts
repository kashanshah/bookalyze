import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Resets the test database and applies all migrations as the owner role. */
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL_MIGRATOR ??
    "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  await pool.query(
    "drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;",
  );
  await migrate(drizzle(pool), {
    migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
  });
  await pool.end();
}

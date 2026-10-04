import "./load-env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { withVerifiedSsl } from "../src/client";
import { migratorUrl } from "./migrator-url";

const url = migratorUrl();
const pool = new pg.Pool({ connectionString: withVerifiedSsl(url), max: 1 });
await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });

// When the app logs in with its own role (local development and CI use bookalyze_app), make sure
// that role belongs to app_runtime so withOrg() can switch to it. The migrator created
// app_runtime, so it may grant membership. Skipped when the role doesn't exist.
const appUser = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).username : "";
if (appUser && appUser !== new URL(url).username) {
  const { rows } = await pool.query("select 1 from pg_roles where rolname = $1", [appUser]);
  if (rows.length) {
    await pool.query(`grant app_runtime to "${appUser.replaceAll('"', '""')}"`);
  } else {
    console.warn(`Role ${appUser} not found; DATABASE_URL can't log in`);
  }
}
await pool.end();
console.info("Migrations applied");

import "./load-env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) throw new Error("DATABASE_URL_MIGRATOR is not set");

const pool = new pg.Pool({ connectionString: url, max: 1 });
await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });

// Make sure the runtime login role (from DATABASE_URL) belongs to app_runtime. The migrator
// created app_runtime, so it may grant membership. Skipped when the role doesn't exist yet.
const appUser = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).username : "";
if (appUser && appUser !== new URL(url).username) {
  const { rows } = await pool.query("select 1 from pg_roles where rolname = $1", [appUser]);
  if (rows.length) {
    await pool.query(`grant app_runtime to "${appUser.replaceAll('"', '""')}"`);
  } else {
    console.warn(
      `Role ${appUser} not found; create it with packages/db/scripts/create-app-role.sql`,
    );
  }
}
await pool.end();
console.info("Migrations applied");

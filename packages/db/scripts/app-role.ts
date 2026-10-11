import type pg from "pg";

/**
 * When the app logs in with its own role (local development and CI use bookalyze_app), make sure
 * that role belongs to app_runtime so withOrg() can switch to it. The migrator created
 * app_runtime, so it may grant membership. Skipped when the role doesn't exist.
 */
export async function grantAppRole(db: pg.Pool | pg.PoolClient, migratorUrl: string) {
  const appUser = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).username : "";
  if (!appUser || appUser === new URL(migratorUrl).username) return;
  const { rows } = await db.query("select 1 from pg_roles where rolname = $1", [appUser]);
  if (rows.length) {
    await db.query(`grant app_runtime to "${appUser.replaceAll('"', '""')}"`);
  } else {
    console.warn(`Role ${appUser} not found; DATABASE_URL can't log in`);
  }
}

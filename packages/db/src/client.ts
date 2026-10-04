import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Asks for full certificate verification explicitly. Hosted URLs (Neon) use sslmode=require,
 * which node-postgres already treats as verify-full but warns will weaken to libpq's meaning in
 * its next major version. Spelling out verify-full keeps today's protection and the logs quiet.
 */
export function withVerifiedSsl(connectionString: string): string {
  return connectionString.replace(
    /([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/,
    (_, prefix: string) => `${prefix}verify-full`,
  );
}

export function createDb(connectionString: string, poolConfig: pg.PoolConfig = {}) {
  const pool = new pg.Pool({
    connectionString: withVerifiedSsl(connectionString),
    max: 10,
    ...poolConfig,
  });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}

const globalForDb = globalThis as unknown as { __bookalyzeDb?: ReturnType<typeof createDb> };

/**
 * The app's shared database handle, connected as the runtime role (DATABASE_URL), for which
 * row-level security is enforced. Cached on globalThis so dev hot reloads reuse the pool.
 */
export function getDb(): Database {
  if (!globalForDb.__bookalyzeDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__bookalyzeDb = createDb(url);
  }
  return globalForDb.__bookalyzeDb.db;
}

export type OrgContext = { orgId: string; userId?: string | null };

/**
 * Runs `fn` in a transaction scoped to one organization. Every tenant table's RLS policy
 * compares its organization_id with this setting, so queries inside cannot read or write
 * another organization's rows. Callers must check membership before calling this.
 */
export async function withOrg<T>(
  db: Database,
  ctx: OrgContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
    );
    return fn(tx);
  });
}

/** Throws if the connection's role would bypass row-level security. */
export async function assertRlsEnforced(db: Database): Promise<void> {
  const result = await db.execute<{ bypass: boolean; owns: boolean }>(sql`
    select (r.rolsuper or r.rolbypassrls) as bypass,
           exists (select 1 from pg_tables t
                   where t.schemaname = 'public' and t.tablename = 'organization_profiles'
                     and t.tableowner = current_user) as owns
    from pg_roles r where r.rolname = current_user`);
  const row = result.rows[0];
  if (!row || row.bypass || row.owns) {
    throw new Error(
      "DATABASE_URL must use the runtime role (member of app_runtime), not a superuser, BYPASSRLS or table-owner role",
    );
  }
}

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
 * The app's shared database handle (DATABASE_URL). It may log in as the tables' owner, as Vercel's
 * Neon integration does: withOrg() drops to app_runtime for tenant queries, so row-level security
 * applies either way. Cached on globalThis so dev hot reloads reuse the pool.
 */
export function getDb(): Database {
  if (!globalForDb.__bookalyzeDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must be set");
    globalForDb.__bookalyzeDb = createDb(url);
  }
  return globalForDb.__bookalyzeDb.db;
}

export type OrgContext = { orgId: string; userId?: string | null };

/**
 * Runs `fn` in a transaction scoped to one organization. The transaction switches to the
 * app_runtime role, which owns no tables and can't bypass row-level security, so every tenant
 * table's RLS policy applies whichever role the connection logged in as: queries inside cannot
 * read or write another organization's rows. Callers must check membership before calling this.
 * Query tenant data only through here.
 */
export async function withOrg<T>(
  db: Database,
  ctx: OrgContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    try {
      // set_config('role', …, true) is SET LOCAL ROLE: it ends with the transaction, so pooled
      // connections (Neon's PgBouncer) never carry it over.
      await tx.execute(
        sql`select set_config('role', 'app_runtime', true), set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
      );
    } catch (error) {
      throw new Error(
        "Can't switch to the app_runtime role for tenant queries. Run the database migrations (pnpm db:migrate), which let the database owner use it. See docs/SETUP.md.",
        { cause: error },
      );
    }
    return fn(tx);
  });
}

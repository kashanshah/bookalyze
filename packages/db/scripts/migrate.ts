import "./load-env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { withVerifiedSsl } from "../src/client";
import { grantAppRole } from "./app-role";
import { migratorUrl } from "./migrator-url";

const url = migratorUrl();
const pool = new pg.Pool({ connectionString: withVerifiedSsl(url), max: 1 });
await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
await grantAppRole(pool, url);
await pool.end();
console.info("Migrations applied");

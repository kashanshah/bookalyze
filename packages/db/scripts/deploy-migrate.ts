import "./load-env";
import { appendFileSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { withVerifiedSsl } from "../src/client";
import { type JournalEntry, migrationConcerns, pendingMigrations } from "../src/migration-safety";
import { grantAppRole } from "./app-role";
import { migratorUrl } from "./migrator-url";

/**
 * Production migrations after a merge (the Deploy workflow). Applies what's pending only when
 * every pending migration is safe to run unattended (`migrationConcerns`); otherwise it applies
 * nothing, names what needs a person, and fails, so the new version isn't deployed against the
 * old database. ALLOW_MIGRATIONS (tags, comma separated) lets named ones through once a person
 * has checked them. One run at a time (an advisory lock).
 */

const folder = new URL("../drizzle/", import.meta.url);
const journal: { entries: JournalEntry[] } = JSON.parse(
  readFileSync(new URL("meta/_journal.json", folder), "utf8"),
);
const allowed = new Set(
  (process.env.ALLOW_MIGRATIONS ?? "")
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean),
);
const inActions = process.env.GITHUB_ACTIONS === "true";
const summary = (line: string) => {
  console.info(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
};

const url = migratorUrl();
const pool = new pg.Pool({ connectionString: withVerifiedSsl(url), max: 1 });
const client = await pool.connect();
let failed = false;
try {
  await client.query("select pg_advisory_lock(hashtext('bookalyze.migrations'))");
  const last = await client
    .query<{ at: string | null }>(
      "select max(created_at)::text as at from drizzle.__drizzle_migrations",
    )
    .then((r) => (r.rows[0]?.at ? Number(r.rows[0].at) : null))
    .catch((error: { code?: string }) => {
      // A database never migrated has no table yet.
      if (error.code === "42P01" || error.code === "3F000") return null;
      throw error;
    });
  const pending = pendingMigrations(journal.entries, last);
  if (!pending.length) {
    summary("No migrations to apply: the database is up to date.");
  } else {
    const blocked = pending.flatMap((entry) => {
      if (allowed.has(entry.tag)) return [];
      const concerns = migrationConcerns(readFileSync(new URL(`${entry.tag}.sql`, folder), "utf8"));
      return concerns.length ? [{ tag: entry.tag, concerns }] : [];
    });
    if (blocked.length) {
      failed = true;
      summary("### Migrations not applied: a person needs to run these");
      for (const { tag, concerns } of blocked) {
        for (const c of concerns) {
          summary(`- \`${tag}\` ${c.reason}: \`${c.statement}\``);
          if (inActions)
            console.info(
              `::error title=Migration ${tag} needs a person::${c.reason}: ${c.statement}`,
            );
        }
      }
      summary(
        "\nCheck them, then run the Deploy workflow by hand with these tags in “Allow migrations”, or run `pnpm db:migrate` yourself and re-run Deploy.",
      );
    } else {
      await migrate(drizzle(client), {
        migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
      });
      await grantAppRole(client, url);
      summary(`### Migrations applied\n${pending.map((e) => `- \`${e.tag}\``).join("\n")}`);
    }
  }
} finally {
  await client.query("select pg_advisory_unlock(hashtext('bookalyze.migrations'))").catch(() => {});
  client.release();
  await pool.end();
}
if (failed) process.exit(1);

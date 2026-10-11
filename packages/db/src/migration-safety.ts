/**
 * Which migrations are safe to run on their own after a merge (phase 0, deploys). A migration
 * is safe when it only adds or widens: new tables, columns, indexes and constraints, backfills,
 * replaced checks. Anything that can lose data, or break the app version still running while
 * the new one deploys, is named so a person runs it on purpose.
 *
 * Function and trigger bodies (`$$ … $$`) are left out: what they do runs later, when called.
 */

type Rule = { pattern: RegExp; reason: string };

const RULES: Rule[] = [
  {
    pattern: /\bdrop\s+(table|schema|view|materialized\s+view|sequence|type|function|trigger)\b/i,
    reason: "drops a database object",
  },
  { pattern: /\balter\s+table\b[^;]*\bdrop\s+column\b/i, reason: "drops a column" },
  { pattern: /\btruncate\b/i, reason: "empties a table" },
  { pattern: /\bdelete\s+from\b/i, reason: "deletes rows" },
  {
    pattern: /\brename\s+(column\s+|constraint\s+)?\S+\s+to\b/i,
    reason: "renames something the running app uses",
  },
  { pattern: /\balter\s+table\b[^;]*\brename\s+to\b/i, reason: "renames a table" },
  {
    pattern: /\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/i,
    reason: "changes a column's type (values may not fit)",
  },
];

/** Drops comments and dollar-quoted bodies so only what runs now is checked. */
function executable(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
}

export type MigrationConcern = { statement: string; reason: string };

/** What in a migration's SQL needs a person to run it. Empty when it's safe to run unattended. */
export function migrationConcerns(sql: string): MigrationConcern[] {
  const concerns: MigrationConcern[] = [];
  for (const raw of executable(sql).split(/;|-->\s*statement-breakpoint/)) {
    const statement = raw.replace(/\s+/g, " ").trim();
    if (!statement) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(statement)) {
        concerns.push({ statement: statement.slice(0, 160), reason: rule.reason });
        break;
      }
    }
  }
  return concerns;
}

export type JournalEntry = { idx: number; when: number; tag: string };

/**
 * Migrations not applied yet: the journal's entries after the latest one the database recorded
 * (`drizzle.__drizzle_migrations.created_at` is the entry's `when`), as Drizzle decides.
 */
export function pendingMigrations(
  journal: readonly JournalEntry[],
  lastApplied: number | null,
): JournalEntry[] {
  return journal
    .filter((entry) => lastApplied === null || entry.when > lastApplied)
    .sort((a, b) => a.idx - b.idx);
}

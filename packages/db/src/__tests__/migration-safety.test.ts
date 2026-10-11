import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationConcerns, pendingMigrations } from "../migration-safety";

const folder = new URL("../../drizzle/", import.meta.url);
const journal: { entries: { idx: number; when: number; tag: string }[] } = JSON.parse(
  readFileSync(new URL("meta/_journal.json", folder), "utf8"),
);

describe("migrationConcerns", () => {
  it("lets additive changes through", () => {
    expect(
      migrationConcerns(`CREATE TABLE "a" ("id" uuid PRIMARY KEY);--> statement-breakpoint
ALTER TABLE "a" ADD COLUMN "b" text;--> statement-breakpoint
ALTER TABLE "a" DROP CONSTRAINT "a_kind_valid";--> statement-breakpoint
ALTER TABLE "a" ADD CONSTRAINT "a_kind_valid" CHECK (kind in ('x', 'y'));--> statement-breakpoint
ALTER TABLE "a" ALTER COLUMN "b" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "a_b_idx";--> statement-breakpoint
UPDATE "a" SET "b" = 'x' WHERE "b" IS NULL;`),
    ).toEqual([]);
  });

  it("names what can lose data or break the running app", () => {
    const reasons = (sql: string) => migrationConcerns(sql).map((c) => c.reason);
    expect(reasons(`DROP TABLE "old";`)).toEqual(["drops a database object"]);
    expect(reasons(`ALTER TABLE "a" DROP COLUMN "b";`)).toEqual(["drops a column"]);
    expect(reasons(`TRUNCATE "a";`)).toEqual(["empties a table"]);
    expect(reasons(`DELETE FROM "a" WHERE true;`)).toEqual(["deletes rows"]);
    expect(reasons(`ALTER TABLE "a" RENAME COLUMN "b" TO "c";`)).toEqual([
      "renames something the running app uses",
    ]);
    expect(reasons(`ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE integer;`)).toEqual([
      "changes a column's type (values may not fit)",
    ]);
  });

  it("ignores function bodies, comments and strings", () => {
    expect(
      migrationConcerns(`-- DROP TABLE "nothing";
CREATE FUNCTION undo_import(target uuid) RETURNS void AS $$
BEGIN
  DELETE FROM journal_entries WHERE import_batch_id = target;
END;
$$ LANGUAGE plpgsql;
COMMENT ON TABLE "a" IS 'Never DROP TABLE this';`),
    ).toEqual([]);
  });

  it("flags only the type change among every migration so far", () => {
    const flagged = journal.entries
      .filter(
        (entry) =>
          migrationConcerns(readFileSync(new URL(`${entry.tag}.sql`, folder), "utf8")).length,
      )
      .map((entry) => entry.tag);
    expect(flagged).toEqual(["0059_po_unit_cost_scale"]);
  });
});

describe("pendingMigrations", () => {
  const entries = [
    { idx: 0, when: 100, tag: "0000_a" },
    { idx: 1, when: 200, tag: "0001_b" },
    { idx: 2, when: 300, tag: "0002_c" },
  ];
  it("is everything after the last one applied", () => {
    expect(pendingMigrations(entries, null).map((e) => e.tag)).toEqual([
      "0000_a",
      "0001_b",
      "0002_c",
    ]);
    expect(pendingMigrations(entries, 200).map((e) => e.tag)).toEqual(["0002_c"]);
    expect(pendingMigrations(entries, 300)).toEqual([]);
  });
});

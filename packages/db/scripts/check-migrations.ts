import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { migrationConcerns } from "../src/migration-safety";

/**
 * For pull requests: names what in the migrations this branch adds can't run on its own after
 * merging (`migrationConcerns`), as warnings on the PR. It never fails the build: such a
 * migration may be intended, and Deploy waits for a person to run it.
 */

const base = process.env.BASE_REF || "origin/main";
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const added = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`, "--", "packages/db/drizzle/*.sql"],
  { encoding: "utf8", cwd: root },
)
  .split("\n")
  .filter(Boolean);
let found = 0;
for (const file of added) {
  for (const c of migrationConcerns(readFileSync(`${root}/${file}`, "utf8"))) {
    found++;
    const message = `${c.reason}: ${c.statement}. Deploy won't run it on its own: a person runs it after merging.`;
    if (process.env.GITHUB_ACTIONS === "true") {
      console.info(`::warning file=${file},title=Migration needs a person::${message}`);
    } else {
      console.warn(`${file}: ${message}`);
    }
  }
}
console.info(
  added.length
    ? `${added.length} migration(s) checked, ${found} statement(s) need a person.`
    : "No migrations in this change.",
);

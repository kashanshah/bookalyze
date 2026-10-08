import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The app may log in as the tables' owner (Vercel's Neon integration), which bypasses row-level
// security outside withOrg(). So tenant data must only be queried inside withOrg(). This guard
// lists every web file that uses the database handle directly; each was reviewed to touch only
// sign-in, membership and reference tables there. A new file using getDb() outside withOrg() fails
// this test: route its tenant queries through withOrg() (or withAccounting()), or, if it only reads
// non-tenant tables, add it below after review.
const REVIEWED_DIRECT_USE = [
  "app/accept-invitation/[id]/page.tsx", // invitation
  "app/o/[slug]/page.tsx", // member, invitation
  "app/o/[slug]/settings/members/page.tsx", // member, user, invitation
  "server/auth.ts", // Better Auth tables, invitation
  "server/amazon-orders.ts", // syncable_sales_channels() for the daily job; the rest in withOrg()
  "server/amazon-ledger.ts", // syncable_sales_channels() for the daily job; the rest in withOrg()
  "server/listing-watch.ts", // listing_watch_orgs() and the company name for the hourly job; watches are read in withOrg()
  "server/amazon-settlements.ts", // syncable_amazon_connections() for the daily job; the rest in withOrg()
  "server/amount-fix.ts", // fx_rates (reference data); the rest runs in withOrg()
  "server/banking.ts", // syncable_connections() for the daily job; the rest runs in withOrg()
  "server/compliance.ts", // organization, member, user for the daily reminders; the rest in withOrg()
  "server/fx.ts", // fx_rates (reference data)
  "server/org.ts", // member, organization
  "server/organizations.ts", // organization
  "server/settlement-posting.ts", // organization for the daily job; the rest in withOrg()
  "server/reviews.ts", // review_request_orgs() for the hourly job; the rest in withOrg()
];

const webSrc = fileURLToPath(new URL("../../../../apps/web/src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** getDb() calls that aren't the first argument of withOrg(). */
function directUses(source: string): number {
  return [...source.matchAll(/getDb\(\)/g)].filter(
    (m) => !/withOrg\(\s*$/.test(source.slice(0, m.index)),
  ).length;
}

describe("tenant data access", () => {
  it("uses the database handle outside withOrg() only in reviewed files", () => {
    const direct = sourceFiles(webSrc)
      .filter((file) => directUses(readFileSync(file, "utf8")) > 0)
      .map((file) => relative(webSrc, file).replaceAll("\\", "/"))
      .sort();
    expect(direct).toEqual([...REVIEWED_DIRECT_USE].sort());
  });
});

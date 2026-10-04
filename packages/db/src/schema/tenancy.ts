import { type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, pgPolicy } from "drizzle-orm/pg-core";

/**
 * The organization the current transaction is scoped to, set by `withOrg()` via
 * `set_config('app.org_id', …, true)`. NULL when unset, which matches no rows.
 */
export const currentOrgId = sql`nullif(current_setting('app.org_id', true), '')::uuid`;

/** Row-level security policy restricting a tenant table to the current organization. */
export function tenantIsolationPolicy(name: string, orgColumn: AnyPgColumn) {
  const predicate: SQL = sql`${orgColumn} = ${currentOrgId}`;
  return pgPolicy(`${name}_tenant_isolation`, {
    as: "permissive",
    for: "all",
    using: predicate,
    withCheck: predicate,
  });
}

import "server-only";
import { getDb, schema, withOrg } from "@bookalyze/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";

/**
 * The eBay users connected to Bookalyze, in Next.js' cache (shared by every instance on Vercel).
 *
 * eBay sends every app an account-deletion notice for every eBay user who closes their account,
 * thousands a day, almost none of them ours. Looking each one up in the database kept it busy
 * around the clock (Neon's free compute ran out in October 2026), so a notice is answered from
 * this list, and only a connected user's notice touches the database. The list is read again
 * once a day, and at once when an eBay account is connected, disconnected or forgotten.
 */
export const EBAY_USERS_TAG = "ebay-connected-users";

export const connectedEbayUsers = unstable_cache(
  async (): Promise<string[]> => {
    const db = getDb();
    const orgs = await db.select({ id: schema.organization.id }).from(schema.organization);
    const users = new Set<string>();
    for (const org of orgs) {
      const rows = await withOrg(db, { orgId: org.id, userId: null }, (tx) =>
        tx
          .select({ userId: sql<string | null>`${schema.connections.settings}->>'userId'` })
          .from(schema.connections)
          .where(
            and(
              eq(schema.connections.provider, "ebay"),
              sql`${schema.connections.settings} ? 'userId'`,
            ),
          ),
      );
      for (const r of rows) if (r.userId) users.add(r.userId);
    }
    return [...users];
  },
  [EBAY_USERS_TAG],
  { tags: [EBAY_USERS_TAG], revalidate: 86_400 },
);

/** After an eBay account is connected, disconnected or forgotten: read the list again. */
export function ebayUsersChanged() {
  revalidateTag(EBAY_USERS_TAG, { expire: 0 });
}

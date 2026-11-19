import "server-only";
import { schema, type Transaction } from "@bookalyze/db";
import { currentApiPrincipal } from "./api/principal";

/** Records a write in the organization's append-only audit log (inside a withOrg transaction). */
export async function audit(
  tx: Transaction,
  entry: {
    orgId: string;
    /** Null for the daily jobs. */
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.insert(schema.auditLogs).values({
    organizationId: entry.orgId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    // Changes made through the public API or MCP name the key that made them.
    apiKeyId: currentApiPrincipal()?.key.id ?? null,
  });
}

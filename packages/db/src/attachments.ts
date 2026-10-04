import { and, count, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { type AttachmentEntityType, attachmentLinks, attachments } from "./schema/files";

/**
 * Attachment metadata and links. The file bytes are handled by the app's storage layer; these
 * helpers only touch the database and run inside `withOrg()`.
 */

export type AttachmentRow = typeof attachments.$inferSelect;

export async function createAttachment(
  tx: Transaction,
  input: {
    id: string;
    orgId: string;
    userId?: string | null;
    storageKey: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<AttachmentRow> {
  const [row] = await tx
    .insert(attachments)
    .values({
      id: input.id,
      organizationId: input.orgId,
      storageKey: input.storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      uploadedBy: input.userId ?? null,
    })
    .returning();
  if (!row) throw new Error("Could not save the attachment");
  return row;
}

export async function getAttachment(tx: Transaction, id: string): Promise<AttachmentRow | null> {
  const [row] = await tx.select().from(attachments).where(eq(attachments.id, id));
  return row ?? null;
}

export async function markAttachmentReady(tx: Transaction, id: string) {
  await tx.update(attachments).set({ status: "ready" }).where(eq(attachments.id, id));
}

/** Links ready attachments to a record. Already-linked pairs are left as they are. */
export async function linkAttachments(
  tx: Transaction,
  input: {
    orgId: string;
    attachmentIds: string[];
    entityType: AttachmentEntityType;
    entityId: string;
    userId?: string | null;
  },
): Promise<number> {
  if (!input.attachmentIds.length) return 0;
  const ready = await tx
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(inArray(attachments.id, input.attachmentIds), eq(attachments.status, "ready")));
  if (!ready.length) return 0;
  await tx
    .insert(attachmentLinks)
    .values(
      ready.map((a) => ({
        organizationId: input.orgId,
        attachmentId: a.id,
        entityType: input.entityType,
        entityId: input.entityId,
        createdBy: input.userId ?? null,
      })),
    )
    .onConflictDoNothing();
  return ready.length;
}

export async function unlinkAttachment(
  tx: Transaction,
  input: { attachmentId: string; entityType: AttachmentEntityType; entityId: string },
) {
  await tx
    .delete(attachmentLinks)
    .where(
      and(
        eq(attachmentLinks.attachmentId, input.attachmentId),
        eq(attachmentLinks.entityType, input.entityType),
        eq(attachmentLinks.entityId, input.entityId),
      ),
    );
}

/** Ready attachments linked to a record, oldest first. */
export async function listAttachmentsFor(
  tx: Transaction,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<AttachmentRow[]> {
  return tx
    .select({ attachment: attachments })
    .from(attachmentLinks)
    .innerJoin(attachments, eq(attachments.id, attachmentLinks.attachmentId))
    .where(
      and(
        eq(attachmentLinks.entityType, entityType),
        eq(attachmentLinks.entityId, entityId),
        eq(attachments.status, "ready"),
      ),
    )
    .orderBy(attachments.createdAt)
    .then((rows) => rows.map((r) => r.attachment));
}

/** Number of ready attachments per record. */
export async function countAttachments(
  tx: Transaction,
  entityType: AttachmentEntityType,
  entityIds: string[],
): Promise<Map<string, number>> {
  if (!entityIds.length) return new Map();
  const rows = await tx
    .select({ entityId: attachmentLinks.entityId, n: count() })
    .from(attachmentLinks)
    .innerJoin(attachments, eq(attachments.id, attachmentLinks.attachmentId))
    .where(
      and(
        eq(attachmentLinks.entityType, entityType),
        inArray(attachmentLinks.entityId, entityIds),
        eq(attachments.status, "ready"),
      ),
    )
    .groupBy(attachmentLinks.entityId);
  return new Map(rows.map((r) => [r.entityId, r.n]));
}

/** The receipts inbox: ready attachments that aren't linked to anything yet, newest first. */
export async function listUnlinkedAttachments(tx: Transaction): Promise<AttachmentRow[]> {
  return tx
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.status, "ready"),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(attachmentLinks)
            .where(eq(attachmentLinks.attachmentId, attachments.id)),
        ),
      ),
    )
    .orderBy(desc(attachments.createdAt));
}

/** Copies every link from one record to another (used when an entry is replaced). */
export async function copyAttachmentLinks(
  tx: Transaction,
  input: {
    orgId: string;
    entityType: AttachmentEntityType;
    fromEntityId: string;
    toEntityId: string;
    userId?: string | null;
  },
) {
  const links = await tx
    .select({ attachmentId: attachmentLinks.attachmentId })
    .from(attachmentLinks)
    .where(
      and(
        eq(attachmentLinks.entityType, input.entityType),
        eq(attachmentLinks.entityId, input.fromEntityId),
      ),
    );
  if (!links.length) return;
  await tx
    .insert(attachmentLinks)
    .values(
      links.map((l) => ({
        organizationId: input.orgId,
        attachmentId: l.attachmentId,
        entityType: input.entityType,
        entityId: input.toEntityId,
        createdBy: input.userId ?? null,
      })),
    )
    .onConflictDoNothing();
}

/** Deletes an attachment row (and its links). Returns its storage key so the file can go too. */
export async function deleteAttachment(tx: Transaction, id: string): Promise<string | null> {
  const [row] = await tx
    .delete(attachments)
    .where(eq(attachments.id, id))
    .returning({ storageKey: attachments.storageKey });
  return row?.storageKey ?? null;
}

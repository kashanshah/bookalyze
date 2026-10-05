"use server";

import {
  createAttachment,
  deleteAttachment,
  formatEntryNumber,
  getAttachment,
  linkAttachments,
  listTransactions,
  markAttachmentReady,
  schema,
  unlinkAttachment,
} from "@bookalyze/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ALLOWED_ATTACHMENT_TYPES,
  type AttachmentSummary,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachments";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import {
  attachmentKey,
  createUploadTarget,
  deleteStoredFile,
  storageDriver,
  storedSize,
} from "@/server/storage";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

function summary(
  slug: string,
  a: { id: string; fileName: string; contentType: string; sizeBytes: number; createdAt: Date },
): AttachmentSummary {
  return {
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
    url: `/api/o/${slug}/attachments/${a.id}`,
  };
}

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/accounting`, "layout");
}

/** Step 1 of an upload: checks the file and returns where the browser should send it. */
export async function requestUploadAction(
  slug: string,
  input: z.input<typeof uploadSchema>,
): Promise<Result<{ id: string; url: string; headers: Record<string, string> }>> {
  const ctx = await getAccountingContext(slug);
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "This file can't be uploaded." };
  const { fileName, contentType, size } = parsed.data;
  if (!ALLOWED_ATTACHMENT_TYPES[contentType]) {
    return {
      ok: false,
      message: `${fileName}: only PDFs and photos (JPEG, PNG, HEIC, WebP) can be attached.`,
    };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      message: `${fileName} is ${formatBytes(size)}. Files can be up to ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
    };
  }
  if (storageDriver() === "none") {
    return {
      ok: false,
      message: "File storage isn't set up yet. Ask an admin to connect S3 (see docs/SETUP.md).",
    };
  }
  const id = crypto.randomUUID();
  const key = attachmentKey(ctx.org.id, id, fileName);
  await inOrg(ctx, (tx) =>
    createAttachment(tx, {
      id,
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      storageKey: key,
      fileName,
      contentType,
      sizeBytes: size,
    }),
  );
  const target = await createUploadTarget({ key, contentType, size });
  return { ok: true, data: { id, ...target } };
}

/** Step 2: confirms the file arrived intact and makes it available. */
export async function completeUploadAction(
  slug: string,
  id: string,
): Promise<Result<AttachmentSummary>> {
  const ctx = await getAccountingContext(slug);
  const attachment = await inOrg(ctx, (tx) => getAttachment(tx, id));
  if (!attachment) return { ok: false, message: "This upload no longer exists." };
  const size = await storedSize(attachment.storageKey);
  if (size === null || size !== attachment.sizeBytes) {
    await deleteStoredFile(attachment.storageKey).catch(() => {});
    await inOrg(ctx, (tx) => deleteAttachment(tx, id));
    return { ok: false, message: `${attachment.fileName} didn't upload completely. Try again.` };
  }
  await inOrg(ctx, async (tx) => {
    await markAttachmentReady(tx, id);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "attachment.uploaded",
      entityType: "attachment",
      entityId: id,
      after: { fileName: attachment.fileName, sizeBytes: attachment.sizeBytes },
    });
  });
  revalidate(slug);
  return { ok: true, data: summary(slug, attachment) };
}

/** Attaches files to a journal entry (or transaction). */
export async function attachToEntryAction(
  slug: string,
  entryId: string,
  attachmentIds: string[],
): Promise<Result<{ linked: number }>> {
  const ctx = await getAccountingContext(slug);
  const ids = z.array(z.uuid()).max(50).safeParse(attachmentIds);
  if (!ids.success || !z.uuid().safeParse(entryId).success)
    return { ok: false, message: "Something went wrong." };
  const linked = await inOrg(ctx, async (tx) => {
    const [entry] = await tx
      .select({ id: schema.journalEntries.id })
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.id, entryId));
    if (!entry) return null;
    const n = await linkAttachments(tx, {
      orgId: ctx.org.id,
      attachmentIds: ids.data,
      entityType: "journal_entry",
      entityId: entryId,
      userId: ctx.session.user.id,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "attachment.linked",
      entityType: "journal_entry",
      entityId: entryId,
      after: { attachmentIds: ids.data },
    });
    return n;
  });
  if (linked === null) return { ok: false, message: "This transaction no longer exists." };
  revalidate(slug);
  return { ok: true, data: { linked } };
}

/** Detaches a file from an entry. If nothing else uses it, it goes back to the receipts inbox. */
export async function detachFromEntryAction(
  slug: string,
  entryId: string,
  attachmentId: string,
): Promise<Result<null>> {
  const ctx = await getAccountingContext(slug);
  if (!z.uuid().safeParse(entryId).success || !z.uuid().safeParse(attachmentId).success) {
    return { ok: false, message: "Something went wrong." };
  }
  await inOrg(ctx, async (tx) => {
    await unlinkAttachment(tx, { attachmentId, entityType: "journal_entry", entityId: entryId });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "attachment.unlinked",
      entityType: "journal_entry",
      entityId: entryId,
      after: { attachmentId },
    });
  });
  revalidate(slug);
  return { ok: true, data: null };
}

/** Deletes a file that isn't attached to anything (from the receipts inbox). */
export async function deleteAttachmentAction(
  slug: string,
  attachmentId: string,
): Promise<Result<null>> {
  const ctx = await getAccountingContext(slug);
  if (!z.uuid().safeParse(attachmentId).success)
    return { ok: false, message: "Something went wrong." };
  const result = await inOrg(ctx, async (tx) => {
    const [link] = await tx
      .select({ id: schema.attachmentLinks.attachmentId })
      .from(schema.attachmentLinks)
      .where(eq(schema.attachmentLinks.attachmentId, attachmentId))
      .limit(1);
    if (link)
      return { error: "This file is attached to a transaction. Remove it from there first." };
    const attachment = await getAttachment(tx, attachmentId);
    const key = await deleteAttachment(tx, attachmentId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "attachment.deleted",
      entityType: "attachment",
      entityId: attachmentId,
      before: attachment ? { fileName: attachment.fileName } : null,
    });
    return { key };
  });
  if ("error" in result) return { ok: false, message: result.error ?? "Can't delete this file." };
  if (result.key) await deleteStoredFile(result.key).catch(() => {});
  revalidate(slug);
  return { ok: true, data: null };
}

/**
 * Deletes several inbox files at once. Files attached to a transaction are left alone (remove them
 * from the transaction first) and counted in `kept`.
 */
export async function deleteAttachmentsAction(
  slug: string,
  attachmentIds: string[],
): Promise<Result<{ deleted: number; kept: number }>> {
  const ctx = await getAccountingContext(slug);
  const parsed = z.array(z.uuid()).min(1).max(500).safeParse(attachmentIds);
  if (!parsed.success) return { ok: false, message: "Something went wrong." };
  const ids = [...new Set(parsed.data)];
  const { keys, deleted, kept } = await inOrg(ctx, async (tx) => {
    const linked = new Set(
      (
        await tx
          .select({ id: schema.attachmentLinks.attachmentId })
          .from(schema.attachmentLinks)
          .where(inArray(schema.attachmentLinks.attachmentId, ids))
      ).map((l) => l.id),
    );
    const keys: string[] = [];
    let deleted = 0;
    for (const id of ids) {
      if (linked.has(id)) continue;
      const attachment = await getAttachment(tx, id);
      if (!attachment) continue;
      const key = await deleteAttachment(tx, id);
      if (key) keys.push(key);
      deleted++;
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "attachment.deleted",
        entityType: "attachment",
        entityId: id,
        before: { fileName: attachment.fileName },
      });
    }
    return { keys, deleted, kept: linked.size };
  });
  await Promise.all(keys.map((key) => deleteStoredFile(key).catch(() => {})));
  revalidate(slug);
  return { ok: true, data: { deleted, kept } };
}

export type MatchCandidate = {
  id: string;
  number: string;
  date: string;
  memo: string | null;
  amount: string;
  currency: string;
  kind: string;
  attachments: number;
};

/** Recent transactions to attach a receipt to, optionally filtered by a search. */
export async function findTransactionsAction(
  slug: string,
  search: string,
): Promise<MatchCandidate[]> {
  const ctx = await getAccountingContext(slug);
  const { rows } = await inOrg(ctx, (tx) =>
    listTransactions(tx, { search: search.slice(0, 100) || null, limit: 30, offset: 0 }),
  );
  return rows.map((r) => ({
    id: r.id,
    number: formatEntryNumber(r.entryNumber),
    date: r.date,
    memo: r.memo,
    amount: r.view.amount,
    currency: r.currency,
    kind: r.view.kind,
    attachments: r.attachments,
  }));
}

/** Files attached to an entry. */
export async function entryAttachmentsAction(
  slug: string,
  entryId: string,
): Promise<AttachmentSummary[]> {
  const ctx = await getAccountingContext(slug);
  if (!z.uuid().safeParse(entryId).success) return [];
  const rows = await inOrg(ctx, (tx) =>
    tx
      .select({ attachment: schema.attachments })
      .from(schema.attachmentLinks)
      .innerJoin(schema.attachments, eq(schema.attachments.id, schema.attachmentLinks.attachmentId))
      .where(
        and(
          eq(schema.attachmentLinks.entityType, "journal_entry"),
          eq(schema.attachmentLinks.entityId, entryId),
          eq(schema.attachments.status, "ready"),
        ),
      )
      .orderBy(schema.attachments.createdAt),
  );
  return rows.map((r) => summary(slug, r.attachment));
}

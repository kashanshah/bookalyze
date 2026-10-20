import { type BrandSettings, EMPTY_BRAND, type LetterheadPages } from "@bookalyze/core";
import { and, eq } from "drizzle-orm";
import type { Transaction } from "./client";
import { organizationBranding } from "./schema/entity";
import { attachmentLinks, attachments } from "./schema/files";

export class BrandError extends Error {}

export type BrandAsset = {
  id: string;
  fileName: string;
  contentType: string;
  storageKey: string;
  sizeBytes: number;
};

export type BrandRecord = BrandSettings & {
  logo: BrandAsset | null;
  letterhead: BrandAsset | null;
  saved: boolean;
};

async function assetOf(tx: Transaction, id: string | null): Promise<BrandAsset | null> {
  if (!id) return null;
  const [row] = await tx
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
      storageKey: attachments.storageKey,
      sizeBytes: attachments.sizeBytes,
    })
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.status, "ready")));
  return row ?? null;
}

/** The company's brand, or the neutral defaults when it hasn't set one. */
export async function getBranding(tx: Transaction): Promise<BrandRecord> {
  const [row] = await tx.select().from(organizationBranding).limit(1);
  if (!row) return { ...EMPTY_BRAND, logo: null, letterhead: null, saved: false };
  const settings: BrandSettings = {
    accentColor: row.accentColor,
    footer: row.footer,
    nameArabic: row.nameArabic,
    logoAttachmentId: row.logoAttachmentId,
    letterheadAttachmentId: row.letterheadAttachmentId,
    letterheadTop: row.letterheadTop,
    letterheadBottom: row.letterheadBottom,
    letterheadLeft: row.letterheadLeft,
    letterheadRight: row.letterheadRight,
    logoHeight: row.logoHeight,
    letterheadPages: row.letterheadPages as LetterheadPages,
  };
  return {
    ...settings,
    logo: await assetOf(tx, row.logoAttachmentId),
    letterhead: await assetOf(tx, row.letterheadAttachmentId),
    saved: true,
  };
}

/**
 * Saves the brand. A new logo or letterhead must be an uploaded, unlinked attachment: it's
 * linked as a brand asset (so it leaves the receipts inbox). Returns the attachments it
 * replaced or removed, for the caller to delete from storage.
 */
export async function saveBranding(
  tx: Transaction,
  input: { orgId: string; userId: string | null; settings: BrandSettings },
): Promise<{ replaced: BrandAsset[] }> {
  const before = await getBranding(tx);
  const next = input.settings;
  const replaced: BrandAsset[] = [];

  for (const [previous, id] of [
    [before.logo, next.logoAttachmentId],
    [before.letterhead, next.letterheadAttachmentId],
  ] as const) {
    if (id && id !== previous?.id) {
      const [file] = await tx.select().from(attachments).where(eq(attachments.id, id));
      if (file?.status !== "ready")
        throw new BrandError("The file didn't finish uploading. Try again.");
      const [linked] = await tx
        .select({ type: attachmentLinks.entityType })
        .from(attachmentLinks)
        .where(eq(attachmentLinks.attachmentId, id))
        .limit(1);
      if (linked) throw new BrandError("This file is already used somewhere else.");
      await tx.insert(attachmentLinks).values({
        organizationId: input.orgId,
        attachmentId: id,
        entityType: "brand_asset",
        entityId: input.orgId,
        createdBy: input.userId,
      });
    }
    if (previous && previous.id !== id) replaced.push(previous);
  }

  const values = {
    accentColor: next.accentColor,
    footer: next.footer,
    nameArabic: next.nameArabic,
    logoAttachmentId: next.logoAttachmentId,
    letterheadAttachmentId: next.letterheadAttachmentId,
    letterheadTop: next.letterheadTop,
    letterheadBottom: next.letterheadBottom,
    letterheadLeft: next.letterheadLeft,
    letterheadRight: next.letterheadRight,
    logoHeight: next.logoHeight,
    letterheadPages: next.letterheadPages,
    updatedBy: input.userId,
    updatedAt: new Date(),
  };
  await tx
    .insert(organizationBranding)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: organizationBranding.organizationId, set: values });

  // Files no longer used: drop their rows (the caller removes the bytes from storage).
  for (const file of replaced) {
    await tx.delete(attachments).where(eq(attachments.id, file.id));
  }
  return { replaced };
}

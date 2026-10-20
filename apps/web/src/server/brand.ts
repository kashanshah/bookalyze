import "server-only";
import type { BrandSettings } from "@bookalyze/core";
import { type BrandRecord, getBranding, type Transaction } from "@bookalyze/db";
import { logWarn } from "@/server/log";
import { readStoredFile } from "@/server/storage";

/** A brand file's bytes, ready to embed in a PDF. */
export type BrandFile = { bytes: Uint8Array; contentType: string };

/** What a document renderer needs from the company's brand. */
export type DocumentBrand = Pick<
  BrandSettings,
  | "accentColor"
  | "footer"
  | "nameArabic"
  | "logoHeight"
  | "letterheadTop"
  | "letterheadBottom"
  | "letterheadLeft"
  | "letterheadRight"
  | "letterheadPages"
> & {
  logo: BrandFile | null;
  letterhead: BrandFile | null;
};

async function fileOf(asset: BrandRecord["logo"]): Promise<BrandFile | null> {
  if (!asset) return null;
  try {
    return { bytes: await readStoredFile(asset.storageKey), contentType: asset.contentType };
  } catch (error) {
    // A missing logo shouldn't stop an invoice: it's issued without it, and the gap is logged.
    logWarn("brand.file_unreadable", { attachmentId: asset.id }, error);
    return null;
  }
}

export async function documentBrandFrom(record: BrandRecord): Promise<DocumentBrand> {
  const [logo, letterhead] = await Promise.all([fileOf(record.logo), fileOf(record.letterhead)]);
  return {
    accentColor: record.accentColor,
    footer: record.footer,
    nameArabic: record.nameArabic,
    logoHeight: record.logoHeight,
    letterheadTop: record.letterheadTop,
    letterheadBottom: record.letterheadBottom,
    letterheadLeft: record.letterheadLeft,
    letterheadRight: record.letterheadRight,
    letterheadPages: record.letterheadPages,
    logo,
    letterhead,
  };
}

/** The company's brand for a document, read inside its tenant transaction. */
export async function loadDocumentBrand(tx: Transaction): Promise<DocumentBrand> {
  return documentBrandFrom(await getBranding(tx));
}

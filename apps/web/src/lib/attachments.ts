/** Rules and helpers for uploaded files. Safe on server and client. */

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/gif": "GIF",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
};

/** What the file picker offers (photos from the phone camera roll included). */
export const ATTACHMENT_ACCEPT = Object.keys(ALLOWED_ATTACHMENT_TYPES).join(",");

/** Whether browsers can show the file as an image thumbnail (HEIC only works in Safari). */
export function isPreviewableImage(contentType: string): boolean {
  return contentType.startsWith("image/") && !contentType.includes("hei");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachmentSummary = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  /** App URL that shows the file (checks access, then serves or redirects). */
  url: string;
};

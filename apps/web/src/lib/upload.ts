"use client";

import {
  completeUploadAction,
  requestUploadAction,
} from "@/app/o/[slug]/accounting/receipts/actions";
import type { AttachmentSummary } from "@/lib/attachments";

/** Browsers sometimes report HEIC photos with no type; fall back on the extension. */
function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "heic"
    ? "image/heic"
    : ext === "heif"
      ? "image/heif"
      : ext === "pdf"
        ? "application/pdf"
        : "";
}

/**
 * Uploads one file: asks the server for a target, sends the bytes straight to storage with
 * progress, then confirms. Throws an Error with a user-friendly message on failure.
 */
export async function uploadAttachment(
  slug: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<AttachmentSummary> {
  const contentType = contentTypeOf(file);
  const target = await requestUploadAction(slug, {
    fileName: file.name,
    contentType,
    size: file.size,
  });
  if (!target.ok) throw new Error(target.message);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.data.url);
    for (const [name, value] of Object.entries(target.data.headers))
      xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`${file.name} couldn't be uploaded. Try again.`));
    xhr.onerror = () =>
      reject(new Error(`${file.name} couldn't be uploaded. Check your connection.`));
    xhr.send(file);
  });

  const done = await completeUploadAction(slug, target.data.id);
  if (!done.ok) throw new Error(done.message);
  return done.data;
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { logWarn } from "./log";

/**
 * File storage for receipts and documents. Production uses a private S3 bucket: browsers upload
 * straight to S3 with short-lived presigned URLs, and downloads redirect to presigned URLs, so
 * files never pass through (or are limited by) the app's functions. Development and CI can use
 * the "local" driver, which keeps files in apps/web/.uploads.
 */

export type StorageDriver = "s3" | "local" | "none";

export function storageDriver(): StorageDriver {
  const e = env();
  if (e.STORAGE_DRIVER === "local") return "local";
  if (e.AWS_S3_BUCKET && e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY) return "s3";
  if (e.STORAGE_DRIVER === "s3") return "none";
  return e.NODE_ENV === "production" ? "none" : "local";
}

let client: S3Client | undefined;
function s3() {
  const e = env();
  client ??= new S3Client({
    region: e.AWS_REGION,
    // Recent SDKs add a checksum to presigned uploads by default, computed over an empty body,
    // so S3 rejects the real file with 403. Browsers upload with a plain PUT: only checksum
    // when an operation requires it.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: e.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: e.AWS_SECRET_ACCESS_KEY ?? "",
    },
  });
  return client;
}

const LOCAL_ROOT = resolve(process.cwd(), ".uploads");

function localPath(key: string): string {
  const path = resolve(LOCAL_ROOT, key);
  if (!path.startsWith(`${LOCAL_ROOT}/`)) throw new Error("Invalid storage key");
  return path;
}

function sign(payload: string): string {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(payload).digest("base64url");
}

/** A signed, expiring token for the local upload route. */
function localUploadToken(key: string, contentType: string, size: number): string {
  const payload = Buffer.from(
    JSON.stringify({ key, contentType, size, exp: Date.now() + 10 * 60_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyLocalUploadToken(
  token: string,
): { key: string; contentType: string; size: number } | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    key: string;
    contentType: string;
    size: number;
    exp: number;
  };
  return data.exp > Date.now() ? data : null;
}

/** Where and how the browser should upload a file. */
export async function createUploadTarget(input: {
  key: string;
  contentType: string;
  size: number;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const driver = storageDriver();
  if (driver === "s3") {
    const url = await getSignedUrl(
      s3(),
      new PutObjectCommand({
        Bucket: env().AWS_S3_BUCKET,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: 600 },
    );
    return { url, headers: { "Content-Type": input.contentType } };
  }
  if (driver === "local") {
    const token = localUploadToken(input.key, input.contentType, input.size);
    return {
      url: `/api/storage/upload?token=${encodeURIComponent(token)}`,
      headers: { "Content-Type": input.contentType },
    };
  }
  throw new Error("File storage isn't configured");
}

/** Saves a file the server created (an invoice PDF). Browsers still upload through a presigned URL. */
export async function putStoredFile(input: {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}) {
  const driver = storageDriver();
  if (driver === "s3") {
    await s3().send(
      new PutObjectCommand({
        Bucket: env().AWS_S3_BUCKET,
        Key: input.key,
        Body: input.bytes,
        ContentType: input.contentType,
      }),
    );
    return;
  }
  if (driver === "local") {
    await writeLocalFile(input.key, input.bytes);
    return;
  }
  throw new Error("File storage isn't configured");
}

/** Saves an uploaded file with the local driver. */
export async function writeLocalFile(key: string, bytes: Uint8Array) {
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/** The stored file's size in bytes, or null if it isn't there. */
export async function storedSize(key: string): Promise<number | null> {
  if (storageDriver() === "s3") {
    try {
      const head = await s3().send(
        new HeadObjectCommand({ Bucket: env().AWS_S3_BUCKET, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (error) {
      // Not found is the expected answer for an upload that never arrived; log anything else.
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 404) logWarn("storage.head_failed", { key, status }, error);
      return null;
    }
  }
  try {
    return (await stat(localPath(key))).size;
  } catch {
    return null;
  }
}

/** A short-lived URL to view or download a file (S3), or null for the local driver. */
export async function downloadUrl(input: {
  key: string;
  fileName: string;
  contentType: string;
  download: boolean;
}): Promise<string | null> {
  if (storageDriver() !== "s3") return null;
  const disposition = `${input.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(input.fileName)}`;
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env().AWS_S3_BUCKET,
      Key: input.key,
      ResponseContentDisposition: disposition,
      ResponseContentType: input.contentType,
    }),
    { expiresIn: 300 },
  );
}

export async function readLocalFile(key: string): Promise<Buffer> {
  return readFile(localPath(key));
}

/**
 * Deletes a file when losing it isn't worth failing over (a replaced invoice PDF, a discarded
 * receipt): a failure is logged, so orphaned files can be found, and never thrown.
 */
export async function removeStoredFile(key: string) {
  await deleteStoredFile(key).catch((error) => logWarn("storage.delete_failed", { key }, error));
}

export async function deleteStoredFile(key: string) {
  if (storageDriver() === "s3") {
    await s3().send(new DeleteObjectCommand({ Bucket: env().AWS_S3_BUCKET, Key: key }));
    return;
  }
  await rm(localPath(key), { force: true });
}

function safeFileName(fileName: string): string {
  return (
    fileName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(-100) || "file"
  );
}

/** e.g. "org/<org>/invoices/2026/10/<id>/INV-0001.pdf" */
export function invoiceKey(orgId: string, id: string, fileName: string, now = new Date()) {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return [
    "org",
    orgId,
    "invoices",
    String(now.getUTCFullYear()),
    month,
    id,
    safeFileName(fileName),
  ].join("/");
}

/** e.g. "org/<org>/attachments/2026/10/<id>/receipt-march.pdf" */
export function attachmentKey(orgId: string, id: string, fileName: string, now = new Date()) {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return join(
    "org",
    orgId,
    "attachments",
    String(now.getUTCFullYear()),
    month,
    id,
    safeFileName(fileName),
  );
}

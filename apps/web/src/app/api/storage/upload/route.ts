import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { storageDriver, verifyLocalUploadToken, writeLocalFile } from "@/server/storage";

/**
 * Receives uploads for the local storage driver (development and CI). The signed token was issued
 * by requestUploadAction after checking membership, and fixes the key, type and size.
 */
export async function PUT(request: Request) {
  if (storageDriver() !== "local") return new Response("Not found", { status: 404 });
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const target = verifyLocalUploadToken(token);
  if (!target) return new Response("This upload link has expired. Try again.", { status: 403 });
  if (request.headers.get("content-type") !== target.contentType) {
    return new Response("Unexpected file type", { status: 400 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > Math.min(target.size, MAX_ATTACHMENT_BYTES)) {
    return new Response("File is larger than expected", { status: 413 });
  }
  await writeLocalFile(target.key, bytes);
  return new Response(null, { status: 204 });
}

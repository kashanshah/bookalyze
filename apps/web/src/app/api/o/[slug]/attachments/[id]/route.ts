import { getAttachment } from "@bookalyze/db";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { downloadUrl, readLocalFile, storageDriver } from "@/server/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shows an attachment to members of its organization: redirects to a short-lived S3 URL, or
 * serves the file with the local driver. `?download=1` saves it instead of opening it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const ctx = await getAccountingContext(slug);
  const attachment = await inOrg(ctx, (tx) => getAttachment(tx, id));
  if (attachment?.status !== "ready") {
    return new Response("Not found", { status: 404 });
  }
  const download = new URL(request.url).searchParams.get("download") === "1";

  if (storageDriver() === "s3") {
    const url = await downloadUrl({
      key: attachment.storageKey,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      download,
    });
    if (!url) return new Response("Not found", { status: 404 });
    return Response.redirect(url, 302);
  }

  try {
    const bytes = await readLocalFile(attachment.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

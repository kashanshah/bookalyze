import { getInvoiceById } from "@bookalyze/db";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { downloadUrl, readLocalFile, storageDriver } from "@/server/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Downloads a customer invoice for a member of its company. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const ctx = await getCommerceContext(slug);
  const invoice = await inOrg(ctx, (tx) => getInvoiceById(tx, id));
  if (!invoice) return new Response("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";

  if (storageDriver() === "s3") {
    const url = await downloadUrl({
      key: invoice.storageKey,
      fileName: invoice.fileName,
      contentType: "application/pdf",
      download,
    });
    if (!url) return new Response("Not found", { status: 404 });
    return Response.redirect(url, 302);
  }

  try {
    const bytes = await readLocalFile(invoice.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(invoice.fileName)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

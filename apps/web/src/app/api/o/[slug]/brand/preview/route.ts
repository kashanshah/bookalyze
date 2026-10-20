import { BRAND_IMAGE_TYPES, LETTERHEAD_TYPES } from "@bookalyze/core";
import { getAttachment, type Transaction } from "@bookalyze/db";
import { brandSchema } from "@/lib/validation/brand";
import { inOrg } from "@/server/accounting";
import { documentBrandFrom } from "@/server/brand";
import { getEntityContext } from "@/server/compliance";
import { renderOrderInvoicePdf } from "@/server/invoice-pdf";
import { sampleInvoice } from "@/server/order-invoices";

/** A brand file for the preview, if it's this company's and of a usable type. */
async function assetOf(tx: Transaction, id: string | null, types: readonly string[]) {
  if (!id) return null;
  const file = await getAttachment(tx, id);
  if (!file || !types.includes(file.contentType)) return null;
  return {
    id: file.id,
    fileName: file.fileName,
    contentType: file.contentType,
    storageKey: file.storageKey,
    sizeBytes: file.sizeBytes,
  };
}

/** Draws a sample invoice with unsaved brand settings, for Company → Brand. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getEntityContext(slug);
  const parsed = brandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid settings", { status: 400 });
  const settings = parsed.data;

  const { invoice, brand } = await inOrg(ctx, async (tx) => {
    const [logo, letterhead] = await Promise.all([
      assetOf(tx, settings.logoAttachmentId, BRAND_IMAGE_TYPES),
      assetOf(tx, settings.letterheadAttachmentId, LETTERHEAD_TYPES),
    ]);
    return {
      invoice: await sampleInvoice(tx, ctx.profile, {
        prefix: settings.invoicePrefix,
        suffix: settings.invoiceSuffix,
      }),
      brand: await documentBrandFrom({ ...settings, logo, letterhead, saved: false }),
    };
  });
  const bytes = await renderOrderInvoicePdf(invoice, brand);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=preview.pdf",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

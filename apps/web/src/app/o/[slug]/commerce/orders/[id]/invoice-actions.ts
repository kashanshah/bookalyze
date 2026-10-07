"use server";

import type { InvoiceBuyer } from "@bookalyze/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { InvoiceDraft } from "@/lib/invoice-draft";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { issueOrderInvoice, loadOrderInvoiceDraft } from "@/server/order-invoices";
import { isOrgAdmin } from "@/server/org";

const DENIED = { ok: false as const, message: "Only owners and admins can create invoices." };

const buyerSchema = z.object({
  name: z.string().trim().max(200),
  company: z.string().trim().max(200),
  taxNumber: z.string().trim().max(50),
  address: z.string().trim().max(500),
});

function buyerOf(input: z.infer<typeof buyerSchema>): InvoiceBuyer {
  const blank = (value: string) => value || null;
  return {
    name: blank(input.name),
    company: blank(input.company),
    taxNumber: blank(input.taxNumber),
    address: blank(input.address),
  };
}

async function admin(slug: string) {
  const ctx = await getCommerceContext(slug);
  return { ctx, denied: isOrgAdmin(ctx) ? null : DENIED };
}

/** Opens the invoice dialog: order lines, the company, and Amazon's name and tax number when it has them. */
export async function loadInvoiceDraftAction(
  slug: string,
  orderId: string,
): Promise<{ ok: true; draft: InvoiceDraft } | { ok: false; message: string }> {
  const { ctx, denied } = await admin(slug);
  if (denied) return denied;
  if (!z.uuid().safeParse(orderId).success) {
    return { ok: false, message: "This order is no longer here." };
  }
  return loadOrderInvoiceDraft(ctx, orderId);
}

/** Saves the invoice PDF. The first save assigns INV-0001; correcting it keeps that number. */
export async function saveOrderInvoiceAction(
  slug: string,
  orderId: string,
  input: z.infer<typeof buyerSchema>,
): Promise<{ ok: true; id: string; number: string } | { ok: false; message: string }> {
  const { ctx, denied } = await admin(slug);
  if (denied) return denied;
  if (!z.uuid().safeParse(orderId).success) {
    return { ok: false, message: "This order is no longer here." };
  }
  const parsed = buyerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the buyer's details and try again." };
  }
  const buyer = buyerOf(parsed.data);
  const result = await issueOrderInvoice(ctx, orderId, buyer);
  if (!result.ok) return result;
  await inOrg(ctx, (tx) =>
    audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: result.created ? "order_invoice.created" : "order_invoice.corrected",
      entityType: "order_invoice",
      entityId: result.id,
      before: result.before,
      after: { number: result.number, buyer },
    }),
  );
  revalidatePath(`/o/${slug}/commerce/orders`, "layout");
  return { ok: true, id: result.id, number: result.number };
}

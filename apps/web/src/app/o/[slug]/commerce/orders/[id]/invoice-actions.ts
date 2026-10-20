"use server";

import type { InvoiceBuyer } from "@bookalyze/core";
import { setInvoiceRequestStatus } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { InvoiceDraft } from "@/lib/invoice-draft";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { sendOrderInvoiceToAmazon } from "@/server/invoice-requests";
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
      // Which buyer details changed, not the details: audit rows can never be erased.
      after: {
        number: result.number,
        changed: (Object.keys(buyer) as (keyof typeof buyer)[]).filter(
          (k) => (result.before?.[k] ?? null) !== (buyer[k] ?? null),
        ),
      },
    }),
  );
  revalidatePath(`/o/${slug}/commerce/orders`, "layout");
  return { ok: true, id: result.id, number: result.number };
}

/** Sends the saved invoice to the buyer through Amazon's invoice message. */
export async function sendInvoiceToAmazonAction(
  slug: string,
  orderId: string,
): Promise<{ ok: true; number: string; sentAt: string } | { ok: false; message: string }> {
  const { ctx, denied } = await admin(slug);
  if (denied) return { ok: false, message: "Only owners and admins can send invoices." };
  if (!z.uuid().safeParse(orderId).success) {
    return { ok: false, message: "This order is no longer here." };
  }
  const result = await sendOrderInvoiceToAmazon(ctx, orderId);
  if (!result.ok) return result;
  await inOrg(ctx, (tx) =>
    audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "order_invoice.sent",
      entityType: "order",
      entityId: orderId,
      after: { number: result.number, via: "amazon_messaging" },
    }),
  );
  revalidatePath(`/o/${slug}/commerce`, "layout");
  revalidatePath(`/o/${slug}`);
  return result;
}

/** Marks a buyer's invoice request handled (or open again), e.g. when it was answered elsewhere. */
export async function setInvoiceRequestStatusAction(
  slug: string,
  requestId: string,
  status: "open" | "done" | "dismissed",
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { ctx, denied } = await admin(slug);
  if (denied) return { ok: false, message: "Only owners and admins can change this." };
  if (!z.uuid().safeParse(requestId).success || !["open", "done", "dismissed"].includes(status)) {
    return { ok: false, message: "This request is no longer here." };
  }
  const changed = await inOrg(ctx, (tx) =>
    setInvoiceRequestStatus(tx, { ids: [requestId], status, userId: ctx.session.user.id }),
  );
  if (!changed) return { ok: false, message: "This request is no longer here." };
  revalidatePath(`/o/${slug}/commerce`, "layout");
  revalidatePath(`/o/${slug}`);
  return { ok: true };
}

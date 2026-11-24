"use server";

import type { InvoiceBuyer } from "@bookalyze/core";
import { findOrderIdsByExternalId, setInvoiceRequestStatus } from "@bookalyze/db";
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

const GONE = { ok: false as const, message: "This order is no longer here." };

/**
 * The order's id from either its id or its marketplace order number (e.g. Amazon's
 * 402-1234567-1234567), so the API and AI agents can name an order the way the seller does.
 */
async function resolveOrder(
  ctx: Awaited<ReturnType<typeof getCommerceContext>>,
  ref: unknown,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (typeof ref !== "string") return GONE;
  const value = ref.trim();
  if (z.uuid().safeParse(value).success) return { ok: true, id: value };
  if (!value || value.length > 100) return GONE;
  const ids = await inOrg(ctx, (tx) => findOrderIdsByExternalId(tx, value));
  if (ids.length === 1) return { ok: true, id: ids[0] as string };
  if (ids.length > 1) {
    return {
      ok: false,
      message: `More than one order is numbered ${value}. Open it from Orders to choose which one.`,
    };
  }
  return {
    ok: false,
    message: `No order numbered ${value} in this company. Sync orders, or check it belongs to another company.`,
  };
}

/** Opens the invoice dialog: order lines, the company, and Amazon's name and tax number when it has them. `orderId` is the order's id or its marketplace order number (e.g. 402-1234567-1234567). */
export async function loadInvoiceDraftAction(
  slug: string,
  orderId: string,
): Promise<{ ok: true; draft: InvoiceDraft } | { ok: false; message: string }> {
  const { ctx, denied } = await admin(slug);
  if (denied) return denied;
  const order = await resolveOrder(ctx, orderId);
  if (!order.ok) return order;
  return loadOrderInvoiceDraft(ctx, order.id);
}

/** Saves the invoice PDF. The first save assigns INV-0001; correcting it keeps that number. `orderId` is the order's id or its marketplace order number; `input` is { name, company, taxNumber, address } (empty strings for blanks), as loadInvoiceDraftAction suggests. */
export async function saveOrderInvoiceAction(
  slug: string,
  orderId: string,
  input: z.infer<typeof buyerSchema>,
): Promise<{ ok: true; id: string; number: string } | { ok: false; message: string }> {
  const { ctx, denied } = await admin(slug);
  if (denied) return denied;
  const order = await resolveOrder(ctx, orderId);
  if (!order.ok) return order;
  const parsed = buyerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the buyer's details and try again." };
  }
  const buyer = buyerOf(parsed.data);
  const result = await issueOrderInvoice(ctx, order.id, buyer);
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

/** Sends the saved invoice to the buyer through Amazon's invoice message. `orderId` is the order's id or its marketplace order number. */
export async function sendInvoiceToAmazonAction(
  slug: string,
  orderId: string,
): Promise<{ ok: true; number: string; sentAt: string } | { ok: false; message: string }> {
  const { ctx, denied } = await admin(slug);
  if (denied) return { ok: false, message: "Only owners and admins can send invoices." };
  const order = await resolveOrder(ctx, orderId);
  if (!order.ok) return order;
  const result = await sendOrderInvoiceToAmazon(ctx, order.id);
  if (!result.ok) return result;
  await inOrg(ctx, (tx) =>
    audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "order_invoice.sent",
      entityType: "order",
      entityId: order.id,
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

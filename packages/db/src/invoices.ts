import type { OrderInvoice } from "@bookalyze/core";
import { eq, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { orderInvoices } from "./schema/commerce";

/** Customer invoices for marketplace orders. Run inside `withOrg()`. Nothing here posts to the books. */

export async function nextInvoiceNumber(tx: Transaction, orgId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${orgId}`}))`);
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(${orderInvoices.invoiceNumber}), 0) + 1` })
    .from(orderInvoices);
  return Number(row?.n ?? 1);
}

export async function getOrderInvoice(tx: Transaction, orderId: string) {
  const [row] = await tx.select().from(orderInvoices).where(eq(orderInvoices.orderId, orderId));
  return row ?? null;
}

export async function getInvoiceById(tx: Transaction, id: string) {
  const [row] = await tx.select().from(orderInvoices).where(eq(orderInvoices.id, id));
  return row ?? null;
}

export async function insertOrderInvoice(
  tx: Transaction,
  input: {
    id: string;
    orgId: string;
    orderId: string;
    invoiceNumber: number;
    snapshot: OrderInvoice;
    storageKey: string;
    fileName: string;
    userId: string | null;
  },
) {
  await tx.insert(orderInvoices).values({
    id: input.id,
    organizationId: input.orgId,
    orderId: input.orderId,
    invoiceNumber: input.invoiceNumber,
    title: input.snapshot.title,
    currency: input.snapshot.currency,
    snapshot: input.snapshot,
    storageKey: input.storageKey,
    fileName: input.fileName,
    createdBy: input.userId,
    updatedBy: input.userId,
  });
}

export async function updateOrderInvoice(
  tx: Transaction,
  input: {
    id: string;
    snapshot: OrderInvoice;
    storageKey: string;
    fileName: string;
    userId: string | null;
  },
) {
  const [row] = await tx
    .update(orderInvoices)
    .set({
      title: input.snapshot.title,
      currency: input.snapshot.currency,
      snapshot: input.snapshot,
      storageKey: input.storageKey,
      fileName: input.fileName,
      updatedBy: input.userId,
    })
    .where(eq(orderInvoices.id, input.id))
    .returning({ id: orderInvoices.id });
  if (!row) throw new Error("This invoice is no longer here.");
}

/** Removes an invoice whose file never landed, so the number can be used again. */
export async function deleteOrderInvoice(tx: Transaction, id: string) {
  await tx.delete(orderInvoices).where(eq(orderInvoices.id, id));
}

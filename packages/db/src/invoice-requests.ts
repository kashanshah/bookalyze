import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "./client";
import { invoiceInboxes, invoiceRequests, orderInvoices, orders } from "./schema/commerce";

/** Invoice requests and the forwarding inbox they arrive by. Run inside `withOrg()` unless noted. */

export type InvoiceRequestStatus = "open" | "done" | "dismissed";

export async function getInvoiceInbox(tx: Transaction) {
  const [row] = await tx.select().from(invoiceInboxes).limit(1);
  return row ?? null;
}

/** The company's inbox, made with `token` the first time. */
export async function ensureInvoiceInbox(tx: Transaction, input: { orgId: string; token: string }) {
  await tx
    .insert(invoiceInboxes)
    .values({ organizationId: input.orgId, token: input.token })
    .onConflictDoNothing();
  const row = await getInvoiceInbox(tx);
  if (!row) throw new Error("The invoice inbox wasn't saved.");
  return row;
}

/**
 * The company an inbox token belongs to, or null. Outside any tenant: the inbound webhook has
 * only the address. Goes through the `invoice_inbox_org` function, which reads that one column.
 */
export async function invoiceInboxOrg(db: Database, token: string): Promise<string | null> {
  const result = await db.execute<{ org: string | null }>(
    sql`select invoice_inbox_org(${token}) as org`,
  );
  return result.rows[0]?.org ?? null;
}

/** Keeps the latest email that wasn't an invoice request, e.g. a forwarding confirmation. */
export async function noteInboxEmail(
  tx: Transaction,
  input: { subject: string | null; from: string | null; at: Date },
) {
  await tx.update(invoiceInboxes).set({
    lastOtherSubject: input.subject?.slice(0, 300) ?? null,
    lastOtherFrom: input.from?.slice(0, 300) ?? null,
    lastOtherAt: input.at,
  });
}

/**
 * Records a buyer's request, matched to the order when it has synced. A request for an order
 * already handled opens it again only when it is newer than when it was handled, so the same
 * email forwarded twice changes nothing (null is returned then).
 */
export async function recordInvoiceRequest(
  tx: Transaction,
  input: {
    orgId: string;
    externalOrderId: string;
    buyerName: string | null;
    requestedAt: Date;
    source?: "email" | "manual";
  },
): Promise<{ id: string } | null> {
  const [order] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.externalId, input.externalOrderId))
    .limit(1);
  const rows = await tx
    .insert(invoiceRequests)
    .values({
      organizationId: input.orgId,
      externalOrderId: input.externalOrderId,
      orderId: order?.id ?? null,
      buyerName: input.buyerName,
      source: input.source ?? "email",
      requestedAt: input.requestedAt,
    })
    .onConflictDoUpdate({
      target: [invoiceRequests.organizationId, invoiceRequests.externalOrderId],
      set: {
        status: "open",
        requestedAt: sql`excluded.requested_at`,
        buyerName: sql`coalesce(excluded.buyer_name, ${invoiceRequests.buyerName})`,
        orderId: sql`coalesce(excluded.order_id, ${invoiceRequests.orderId})`,
        resolvedAt: null,
        resolvedBy: null,
      },
      setWhere: sql`${invoiceRequests.resolvedAt} is null or excluded.requested_at > ${invoiceRequests.resolvedAt}`,
    })
    .returning({ id: invoiceRequests.id });
  await tx.update(invoiceInboxes).set({ lastRequestAt: input.requestedAt });
  // No row: the same request again, already handled.
  return rows[0] ?? null;
}

/** Links requests that arrived before their order synced. */
async function linkRequests(tx: Transaction) {
  await tx.execute(sql`
    update ${invoiceRequests} r set order_id = o.id
    from ${orders} o
    where r.order_id is null and o.external_id = r.external_order_id
  `);
}

export type InvoiceRequestRow = {
  id: string;
  externalOrderId: string;
  orderId: string | null;
  buyerName: string | null;
  source: string;
  status: InvoiceRequestStatus;
  requestedAt: Date;
  resolvedAt: Date | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  sentAt: Date | null;
};

/** Requests, newest first: open ones, or the latest of every status. */
export async function listInvoiceRequests(
  tx: Transaction,
  filters: { status?: InvoiceRequestStatus; limit?: number } = {},
): Promise<InvoiceRequestRow[]> {
  await linkRequests(tx);
  const rows = await tx
    .select({
      id: invoiceRequests.id,
      externalOrderId: invoiceRequests.externalOrderId,
      orderId: invoiceRequests.orderId,
      buyerName: invoiceRequests.buyerName,
      source: invoiceRequests.source,
      status: invoiceRequests.status,
      requestedAt: invoiceRequests.requestedAt,
      resolvedAt: invoiceRequests.resolvedAt,
      invoiceId: orderInvoices.id,
      invoiceNumber: sql<string | null>`${orderInvoices.snapshot}->>'number'`,
      sentAt: orderInvoices.sentAt,
    })
    .from(invoiceRequests)
    .leftJoin(orderInvoices, eq(orderInvoices.orderId, invoiceRequests.orderId))
    .where(filters.status ? eq(invoiceRequests.status, filters.status) : undefined)
    .orderBy(desc(invoiceRequests.requestedAt))
    .limit(filters.limit ?? 100);
  return rows.map((row) => ({ ...row, status: row.status as InvoiceRequestStatus }));
}

/** Open requests: how many, and the order of the newest (for a link straight to it). */
export async function openInvoiceRequests(
  tx: Transaction,
): Promise<{ count: number; orderId: string | null }> {
  await linkRequests(tx);
  const [row] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      orderId: sql<
        string | null
      >`(array_agg(${invoiceRequests.orderId} order by ${invoiceRequests.requestedAt} desc))[1]`,
    })
    .from(invoiceRequests)
    .where(eq(invoiceRequests.status, "open"));
  return { count: row?.count ?? 0, orderId: row?.orderId ?? null };
}

/** The order's request, if a buyer asked. */
export async function invoiceRequestForOrder(
  tx: Transaction,
  input: { orderId: string; externalId: string },
) {
  const [row] = await tx
    .select()
    .from(invoiceRequests)
    .where(
      sql`${invoiceRequests.orderId} = ${input.orderId} or ${invoiceRequests.externalOrderId} = ${input.externalId}`,
    )
    .limit(1);
  return row ?? null;
}

/** Marks requests handled: sent ("done"), or set aside ("dismissed"), or open again. */
export async function setInvoiceRequestStatus(
  tx: Transaction,
  input: { ids?: string[]; orderId?: string; status: InvoiceRequestStatus; userId: string | null },
) {
  const where = input.ids
    ? inArray(invoiceRequests.id, input.ids)
    : input.orderId
      ? eq(invoiceRequests.orderId, input.orderId)
      : undefined;
  if (!where) return 0;
  const open = input.status === "open";
  const rows = await tx
    .update(invoiceRequests)
    .set({
      status: input.status,
      resolvedAt: open ? null : new Date(),
      resolvedBy: open ? null : input.userId,
    })
    .where(
      input.status === "done" && input.orderId
        ? and(where, eq(invoiceRequests.status, "open"))
        : where,
    )
    .returning({ id: invoiceRequests.id });
  return rows.length;
}

/** Records that the invoice went to the buyer through the marketplace. */
export async function markOrderInvoiceSent(
  tx: Transaction,
  input: { id: string; userId: string | null; at?: Date },
) {
  await tx
    .update(orderInvoices)
    .set({ sentAt: input.at ?? new Date(), sentBy: input.userId })
    .where(eq(orderInvoices.id, input.id));
}

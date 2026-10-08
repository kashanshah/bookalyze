import {
  purchaseLineTotal,
  purchaseOrderTotal,
  receiptProblems,
  receivingStatus,
} from "@bookalyze/core";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { buildLots } from "./landed-costs";
import { contacts } from "./schema/accounting";
import {
  products,
  purchaseOrderLines,
  purchaseOrders,
  purchaseReceiptLines,
  purchaseReceipts,
} from "./schema/inventory";

/**
 * Purchase orders and deliveries (phase 5, slice 2). Run inside `withOrg()`. A PO is edited
 * only while it's a draft; once ordered, deliveries are recorded against its lines and its
 * status follows what has arrived. Nothing here posts to the books.
 */

export class PurchasingError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "state" | "invalid" = "invalid",
    readonly lineErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type PurchaseOrderStatus = (typeof purchaseOrders.$inferSelect)["status"];

export type PurchaseLineInput = { productId: string; quantity: number; unitCost: string };

export type PurchaseOrderInput = {
  supplierId: string;
  currency: string;
  orderDate: string;
  expectedDate: string | null;
  reference: string | null;
  notes: string | null;
  lines: PurchaseLineInput[];
};

export type PurchaseOrderListRow = {
  id: string;
  number: number;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  currency: string;
  orderDate: string;
  expectedDate: string | null;
  reference: string | null;
  total: string;
  units: number;
  received: number;
};

export type PurchaseOrderLine = {
  id: string;
  lineNo: number;
  productId: string;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitCost: string;
  total: string;
  received: number;
};

export type PurchaseReceipt = {
  id: string;
  receivedOn: string;
  notes: string | null;
  createdAt: Date;
  lines: { purchaseOrderLineId: string; quantity: number }[];
};

export type PurchaseOrderDetail = Omit<PurchaseOrderListRow, "units" | "received"> & {
  notes: string | null;
  createdAt: Date;
  lines: PurchaseOrderLine[];
  receipts: PurchaseReceipt[];
};

function like(search: string) {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Received quantity per PO line. */
async function receivedByLine(tx: Transaction, lineIds: string[]): Promise<Map<string, number>> {
  if (!lineIds.length) return new Map();
  const rows = await tx
    .select({
      lineId: purchaseReceiptLines.purchaseOrderLineId,
      received: sql<number>`coalesce(sum(${purchaseReceiptLines.quantity}), 0)::int`,
    })
    .from(purchaseReceiptLines)
    .where(inArray(purchaseReceiptLines.purchaseOrderLineId, lineIds))
    .groupBy(purchaseReceiptLines.purchaseOrderLineId);
  return new Map(rows.map((row) => [row.lineId, Number(row.received)]));
}

const PO_COLUMNS = {
  id: purchaseOrders.id,
  number: purchaseOrders.number,
  status: purchaseOrders.status,
  supplierId: purchaseOrders.supplierId,
  supplierName: contacts.name,
  currency: purchaseOrders.currency,
  orderDate: purchaseOrders.orderDate,
  expectedDate: purchaseOrders.expectedDate,
  reference: purchaseOrders.reference,
};

/** Newest first. `search` matches the supplier, the supplier's reference, or "PO-12". */
export async function listPurchaseOrders(
  tx: Transaction,
  options: { status?: PurchaseOrderStatus | "open"; search?: string } = {},
): Promise<PurchaseOrderListRow[]> {
  const conditions = [];
  if (options.status === "open") {
    conditions.push(inArray(purchaseOrders.status, ["draft", "ordered", "partial"]));
  } else if (options.status) {
    conditions.push(eq(purchaseOrders.status, options.status));
  }
  const search = options.search?.trim();
  if (search) {
    const number = Number(search.replace(/^po-?/i, ""));
    conditions.push(
      or(
        ilike(contacts.name, like(search)),
        ilike(purchaseOrders.reference, like(search)),
        ...(Number.isInteger(number) && number > 0 ? [eq(purchaseOrders.number, number)] : []),
      ),
    );
  }
  const rows = await tx
    .select(PO_COLUMNS)
    .from(purchaseOrders)
    .innerJoin(contacts, eq(contacts.id, purchaseOrders.supplierId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(purchaseOrders.number))
    .limit(200);
  if (!rows.length) return [];
  const lines = await tx
    .select({
      id: purchaseOrderLines.id,
      purchaseOrderId: purchaseOrderLines.purchaseOrderId,
      quantity: purchaseOrderLines.quantity,
      unitCost: purchaseOrderLines.unitCost,
    })
    .from(purchaseOrderLines)
    .where(
      inArray(
        purchaseOrderLines.purchaseOrderId,
        rows.map((row) => row.id),
      ),
    );
  const received = await receivedByLine(
    tx,
    lines.map((line) => line.id),
  );
  return rows.map((row) => {
    const own = lines.filter((line) => line.purchaseOrderId === row.id);
    return {
      ...row,
      total: purchaseOrderTotal(own, row.currency),
      units: own.reduce((sum, line) => sum + line.quantity, 0),
      received: own.reduce((sum, line) => sum + (received.get(line.id) ?? 0), 0),
    };
  });
}

export async function getPurchaseOrder(
  tx: Transaction,
  id: string,
): Promise<PurchaseOrderDetail | null> {
  const [po] = await tx
    .select({ ...PO_COLUMNS, notes: purchaseOrders.notes, createdAt: purchaseOrders.createdAt })
    .from(purchaseOrders)
    .innerJoin(contacts, eq(contacts.id, purchaseOrders.supplierId))
    .where(eq(purchaseOrders.id, id));
  if (!po) return null;
  const lineRows = await tx
    .select({
      id: purchaseOrderLines.id,
      lineNo: purchaseOrderLines.lineNo,
      productId: purchaseOrderLines.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: purchaseOrderLines.quantity,
      unitCost: purchaseOrderLines.unitCost,
    })
    .from(purchaseOrderLines)
    .innerJoin(products, eq(products.id, purchaseOrderLines.productId))
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderLines.lineNo));
  const received = await receivedByLine(
    tx,
    lineRows.map((line) => line.id),
  );
  const lines = lineRows.map((line) => ({
    ...line,
    total: purchaseLineTotal(line.quantity, line.unitCost, po.currency),
    received: received.get(line.id) ?? 0,
  }));
  const receiptRows = await tx
    .select()
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.purchaseOrderId, id))
    .orderBy(desc(purchaseReceipts.receivedOn), desc(purchaseReceipts.createdAt));
  const receiptLines = receiptRows.length
    ? await tx
        .select({
          receiptId: purchaseReceiptLines.receiptId,
          purchaseOrderLineId: purchaseReceiptLines.purchaseOrderLineId,
          quantity: purchaseReceiptLines.quantity,
        })
        .from(purchaseReceiptLines)
        .where(
          inArray(
            purchaseReceiptLines.receiptId,
            receiptRows.map((receipt) => receipt.id),
          ),
        )
    : [];
  return {
    ...po,
    total: purchaseOrderTotal(lines, po.currency),
    lines,
    receipts: receiptRows.map((receipt) => ({
      id: receipt.id,
      receivedOn: receipt.receivedOn,
      notes: receipt.notes,
      createdAt: receipt.createdAt,
      lines: receiptLines
        .filter((line) => line.receiptId === receipt.id)
        .map(({ purchaseOrderLineId, quantity }) => ({ purchaseOrderLineId, quantity })),
    })),
  };
}

/** The supplier must be a vendor contact that isn't archived; every product must exist. */
async function checkParties(tx: Transaction, input: PurchaseOrderInput) {
  const [supplier] = await tx
    .select({ type: contacts.type, isArchived: contacts.isArchived })
    .from(contacts)
    .where(eq(contacts.id, input.supplierId));
  if (!supplier || supplier.isArchived || supplier.type === "customer") {
    throw new PurchasingError("Choose a supplier from your vendors.");
  }
  if (!input.lines.length) throw new PurchasingError("Add at least one product.");
  const ids = [...new Set(input.lines.map((line) => line.productId))];
  const found = await tx
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, ids));
  if (found.length !== ids.length) {
    throw new PurchasingError("One of the products no longer exists.");
  }
}

async function writeLines(
  tx: Transaction,
  orgId: string,
  purchaseOrderId: string,
  lines: PurchaseLineInput[],
) {
  await tx.insert(purchaseOrderLines).values(
    lines.map((line, index) => ({
      organizationId: orgId,
      purchaseOrderId,
      lineNo: index + 1,
      productId: line.productId,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })),
  );
}

/** A new draft, numbered after the company's last PO. */
export async function createPurchaseOrder(
  tx: Transaction,
  input: PurchaseOrderInput & { orgId: string; userId?: string | null },
): Promise<{ id: string; number: number }> {
  await checkParties(tx, input);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`purchase_order:${input.orgId}`}))`);
  const [last] = await tx
    .select({ number: sql<number>`coalesce(max(${purchaseOrders.number}), 0)::int` })
    .from(purchaseOrders);
  const number = Number(last?.number ?? 0) + 1;
  const [row] = await tx
    .insert(purchaseOrders)
    .values({
      organizationId: input.orgId,
      number,
      supplierId: input.supplierId,
      currency: input.currency,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate,
      reference: input.reference,
      notes: input.notes,
      createdBy: input.userId ?? null,
    })
    .returning({ id: purchaseOrders.id, number: purchaseOrders.number });
  if (!row) throw new PurchasingError("The purchase order couldn't be saved.");
  await writeLines(tx, input.orgId, row.id, input.lines);
  return row;
}

async function lockedOrder(tx: Transaction, id: string) {
  const [po] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .for("update");
  if (!po) throw new PurchasingError("This purchase order no longer exists.", "not_found");
  return po;
}

/** Changes a draft (its lines are replaced). */
export async function updatePurchaseOrder(
  tx: Transaction,
  input: PurchaseOrderInput & { id: string; orgId: string },
): Promise<void> {
  const po = await lockedOrder(tx, input.id);
  if (po.status !== "draft") {
    throw new PurchasingError(
      "Only a draft can be changed. This one has been sent to the supplier.",
      "state",
    );
  }
  await checkParties(tx, input);
  await tx
    .update(purchaseOrders)
    .set({
      supplierId: input.supplierId,
      currency: input.currency,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate,
      reference: input.reference,
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, input.id));
  await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, input.id));
  await writeLines(tx, input.orgId, input.id, input.lines);
}

/** Draft → ordered: sent to the supplier, so deliveries can be recorded. */
export async function markPurchaseOrderOrdered(tx: Transaction, id: string): Promise<void> {
  const po = await lockedOrder(tx, id);
  if (po.status !== "draft") throw new PurchasingError("This order was already sent.", "state");
  const [line] = await tx
    .select({ id: purchaseOrderLines.id })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .limit(1);
  if (!line) throw new PurchasingError("Add at least one product first.", "state");
  await tx
    .update(purchaseOrders)
    .set({ status: "ordered", updatedAt: new Date() })
    .where(eq(purchaseOrders.id, id));
}

/** Cancels a PO nothing has arrived for yet. */
export async function cancelPurchaseOrder(tx: Transaction, id: string): Promise<void> {
  const po = await lockedOrder(tx, id);
  if (po.status !== "draft" && po.status !== "ordered") {
    throw new PurchasingError(
      po.status === "cancelled"
        ? "This order is already cancelled."
        : "Something has arrived for this order, so it can't be cancelled.",
      "state",
    );
  }
  await tx
    .update(purchaseOrders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(purchaseOrders.id, id));
}

/** Deletes a draft (a sent order is cancelled instead, so its number stays accounted for). */
export async function deletePurchaseOrder(tx: Transaction, id: string): Promise<void> {
  const po = await lockedOrder(tx, id);
  if (po.status !== "draft") {
    throw new PurchasingError("Only a draft can be deleted. Cancel a sent order instead.", "state");
  }
  await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
}

/** Records a delivery and moves the PO to partly received or received. */
export async function receivePurchaseOrder(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    id: string;
    receivedOn: string;
    notes: string | null;
    quantities: Record<string, number>;
    /** The company's main currency, which lots are costed in. */
    baseCurrency: string;
    /** Main-currency value of one unit of the PO's currency. Needed when they differ. */
    exchangeRate?: string | null;
  },
): Promise<{ receiptId: string; status: "ordered" | "partial" | "received" }> {
  const po = await lockedOrder(tx, input.id);
  if (po.status !== "ordered" && po.status !== "partial") {
    throw new PurchasingError(
      po.status === "draft"
        ? "Mark the order as sent first."
        : po.status === "received"
          ? "Everything on this order has arrived."
          : "This order is cancelled.",
      "state",
    );
  }
  if (input.receivedOn < po.orderDate) {
    throw new PurchasingError("A delivery can't arrive before the order date.");
  }
  const foreign = po.currency !== input.baseCurrency;
  if (foreign && !input.exchangeRate) {
    throw new PurchasingError(
      `Add the ${po.currency} to ${input.baseCurrency} exchange rate, so the stock is costed.`,
    );
  }
  const lines = await tx
    .select({ id: purchaseOrderLines.id, quantity: purchaseOrderLines.quantity })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, input.id));
  const received = await receivedByLine(
    tx,
    lines.map((line) => line.id),
  );
  const withReceived = lines.map((line) => ({ ...line, received: received.get(line.id) ?? 0 }));
  const problems = receiptProblems(withReceived, input.quantities);
  if (problems.form || Object.keys(problems.lines).length) {
    throw new PurchasingError(problems.form ?? "Check the quantities.", "invalid", problems.lines);
  }
  const [receipt] = await tx
    .insert(purchaseReceipts)
    .values({
      organizationId: input.orgId,
      purchaseOrderId: input.id,
      receivedOn: input.receivedOn,
      notes: input.notes,
      exchangeRate: foreign ? (input.exchangeRate ?? null) : null,
      createdBy: input.userId ?? null,
    })
    .returning({ id: purchaseReceipts.id });
  if (!receipt) throw new PurchasingError("The delivery couldn't be saved.");
  const arriving = Object.entries(input.quantities).filter(([, quantity]) => quantity > 0);
  await tx.insert(purchaseReceiptLines).values(
    arriving.map(([purchaseOrderLineId, quantity]) => ({
      organizationId: input.orgId,
      receiptId: receipt.id,
      purchaseOrderLineId,
      quantity,
    })),
  );
  const status = receivingStatus(
    withReceived.map((line) => ({
      quantity: line.quantity,
      received: line.received + (input.quantities[line.id] ?? 0),
    })),
  );
  await tx
    .update(purchaseOrders)
    .set({ status, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, input.id));
  // One FIFO lot per line that arrived, at the PO cost; extra costs are added on the delivery.
  const costing = await buildLots(tx, {
    orgId: input.orgId,
    receiptId: receipt.id,
    baseCurrency: input.baseCurrency,
  });
  if (!costing.ok) throw new PurchasingError(costing.problem);
  return { receiptId: receipt.id, status };
}

/** Vendors that can be picked as a supplier. */
export async function supplierOptions(tx: Transaction) {
  return tx
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(and(inArray(contacts.type, ["vendor", "both"]), eq(contacts.isArchived, false)))
    .orderBy(asc(contacts.name));
}

/** Units on order (sent, not yet arrived) per product, for the Products list. */
export async function unitsOnOrder(tx: Transaction): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      productId: purchaseOrderLines.productId,
      ordered: sql<number>`sum(${purchaseOrderLines.quantity})::int`,
      received: sql<number>`coalesce(sum((select sum(r.quantity) from purchase_receipt_lines r where r.purchase_order_line_id = ${purchaseOrderLines.id})), 0)::int`,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .where(inArray(purchaseOrders.status, ["ordered", "partial"]))
    .groupBy(purchaseOrderLines.productId);
  return new Map(
    rows.map((row) => [row.productId, Math.max(0, Number(row.ordered) - Number(row.received))]),
  );
}

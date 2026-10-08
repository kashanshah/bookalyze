import {
  type AllocationMethod,
  type Costing,
  costDelivery,
  type LandedCostKind,
} from "@bookalyze/core";
import { asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { lotsConsumed } from "./cogs";
import { PurchasingError } from "./purchasing";
import { contacts } from "./schema/accounting";
import {
  inventoryLots,
  products,
  purchaseOrderLines,
  purchaseOrders,
  purchaseReceiptCosts,
  purchaseReceiptLines,
  purchaseReceipts,
} from "./schema/inventory";

/**
 * Landed costs and FIFO lots (phase 5, slice 3). Run inside `withOrg()`. Every line of a
 * delivery is one lot; its cost in the main currency is the PO cost (at the delivery's
 * exchange rate) plus its share of the delivery's extra costs. Lots are rebuilt in place
 * whenever the delivery's rate or costs change. Nothing here posts to the books.
 */

export type DeliveryCostInput = {
  kind: LandedCostKind;
  description: string | null;
  amount: string;
  currency: string;
  exchangeRate: string | null;
  allocation: AllocationMethod;
};

export type DeliveryCostingLine = {
  receiptLineId: string;
  productId: string;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitCost: string;
  unitWeight: string | null;
};

export type DeliveryCosting = {
  receiptId: string;
  receivedOn: string;
  notes: string | null;
  exchangeRate: string | null;
  purchaseOrderId: string;
  purchaseOrderNumber: number;
  supplierName: string;
  poCurrency: string;
  lines: DeliveryCostingLine[];
  costs: (DeliveryCostInput & { id: string })[];
  /** Whether lots exist for this delivery (deliveries recorded before costing have none). */
  costed: boolean;
};

async function loadDelivery(tx: Transaction, receiptId: string) {
  const [receipt] = await tx
    .select({
      receiptId: purchaseReceipts.id,
      receivedOn: purchaseReceipts.receivedOn,
      notes: purchaseReceipts.notes,
      exchangeRate: purchaseReceipts.exchangeRate,
      purchaseOrderId: purchaseOrders.id,
      purchaseOrderNumber: purchaseOrders.number,
      supplierName: contacts.name,
      poCurrency: purchaseOrders.currency,
    })
    .from(purchaseReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
    .innerJoin(contacts, eq(contacts.id, purchaseOrders.supplierId))
    .where(eq(purchaseReceipts.id, receiptId));
  if (!receipt) return null;
  const lines = await tx
    .select({
      receiptLineId: purchaseReceiptLines.id,
      productId: purchaseOrderLines.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: purchaseReceiptLines.quantity,
      unitCost: purchaseOrderLines.unitCost,
      unitWeight: products.unitWeight,
    })
    .from(purchaseReceiptLines)
    .innerJoin(
      purchaseOrderLines,
      eq(purchaseOrderLines.id, purchaseReceiptLines.purchaseOrderLineId),
    )
    .innerJoin(products, eq(products.id, purchaseOrderLines.productId))
    .where(eq(purchaseReceiptLines.receiptId, receiptId))
    .orderBy(asc(purchaseOrderLines.lineNo));
  const costs = await tx
    .select({
      id: purchaseReceiptCosts.id,
      kind: purchaseReceiptCosts.kind,
      description: purchaseReceiptCosts.description,
      amount: purchaseReceiptCosts.amount,
      currency: purchaseReceiptCosts.currency,
      exchangeRate: purchaseReceiptCosts.exchangeRate,
      allocation: purchaseReceiptCosts.allocation,
    })
    .from(purchaseReceiptCosts)
    .where(eq(purchaseReceiptCosts.receiptId, receiptId))
    .orderBy(asc(purchaseReceiptCosts.lineNo));
  return { ...receipt, lines, costs };
}

/** A delivery with what arrived and its extra costs, for the costs page. */
export async function getDeliveryCosting(
  tx: Transaction,
  receiptId: string,
): Promise<DeliveryCosting | null> {
  const delivery = await loadDelivery(tx, receiptId);
  if (!delivery) return null;
  const lineIds = delivery.lines.map((line) => line.receiptLineId);
  const [lot] = lineIds.length
    ? await tx
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(inArray(inventoryLots.receiptLineId, lineIds))
        .limit(1)
    : [];
  return { ...delivery, costed: Boolean(lot) };
}

/**
 * Works out the delivery's lots and writes them (same lot ids as before). Returns the problem
 * instead when something needed is missing, such as an exchange rate, and leaves lots alone.
 */
export async function buildLots(
  tx: Transaction,
  input: { orgId: string; receiptId: string; baseCurrency: string },
): Promise<Costing> {
  const delivery = await loadDelivery(tx, input.receiptId);
  if (!delivery) return { ok: false, problem: "This delivery no longer exists." };
  const costing = costDelivery({
    baseCurrency: input.baseCurrency,
    poCurrency: delivery.poCurrency,
    rate: delivery.exchangeRate,
    lines: delivery.lines.map((line) => ({
      id: line.receiptLineId,
      name: line.productName,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unitWeight: line.unitWeight,
    })),
    extras: delivery.costs.map((cost) => ({
      amount: cost.amount,
      currency: cost.currency,
      rate: cost.exchangeRate,
      allocation: cost.allocation,
    })),
  });
  if (!costing.ok) return costing;
  const byLine = new Map(delivery.lines.map((line) => [line.receiptLineId, line]));
  for (const lot of costing.lines) {
    const line = byLine.get(lot.id);
    if (!line) continue;
    await tx
      .insert(inventoryLots)
      .values({
        organizationId: input.orgId,
        productId: line.productId,
        receiptLineId: lot.id,
        receivedOn: delivery.receivedOn,
        quantity: lot.quantity,
        currency: input.baseCurrency,
        productCost: lot.productCost,
        landedCost: lot.landedCost,
      })
      .onConflictDoUpdate({
        target: inventoryLots.receiptLineId,
        set: {
          receivedOn: delivery.receivedOn,
          quantity: lot.quantity,
          currency: input.baseCurrency,
          productCost: lot.productCost,
          landedCost: lot.landedCost,
          updatedAt: new Date(),
        },
      });
  }
  return costing;
}

/** Saves the delivery's exchange rate and extra costs, then rebuilds its lots. */
export async function saveDeliveryCosts(
  tx: Transaction,
  input: {
    orgId: string;
    receiptId: string;
    baseCurrency: string;
    exchangeRate: string | null;
    costs: DeliveryCostInput[];
  },
): Promise<Costing & { ok: true }> {
  const [receipt] = await tx
    .select({ purchaseOrderId: purchaseReceipts.purchaseOrderId })
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.id, input.receiptId));
  if (!receipt) throw new PurchasingError("This delivery no longer exists.", "not_found");
  // One writer at a time per PO, like receiving.
  const [po] = await tx
    .select({ currency: purchaseOrders.currency })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, receipt.purchaseOrderId))
    .for("update");
  if (!po) throw new PurchasingError("This purchase order no longer exists.", "not_found");
  if (input.costs.length > 20) throw new PurchasingError("Up to 20 costs per delivery.");
  const lots = await tx
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .innerJoin(purchaseReceiptLines, eq(purchaseReceiptLines.id, inventoryLots.receiptLineId))
    .where(eq(purchaseReceiptLines.receiptId, input.receiptId));
  const usedIn = await lotsConsumed(
    tx,
    lots.map((lot) => lot.id),
  );
  if (usedIn) {
    throw new PurchasingError(
      `Some of this delivery's stock is already in cost of goods sold (${usedIn}). Undo that month first to change its costs.`,
      "state",
    );
  }
  await tx
    .update(purchaseReceipts)
    .set({ exchangeRate: po.currency === input.baseCurrency ? null : input.exchangeRate })
    .where(eq(purchaseReceipts.id, input.receiptId));
  await tx.delete(purchaseReceiptCosts).where(eq(purchaseReceiptCosts.receiptId, input.receiptId));
  if (input.costs.length) {
    await tx.insert(purchaseReceiptCosts).values(
      input.costs.map((cost, index) => ({
        organizationId: input.orgId,
        receiptId: input.receiptId,
        lineNo: index + 1,
        kind: cost.kind,
        description: cost.description,
        amount: cost.amount,
        currency: cost.currency,
        exchangeRate: cost.currency === input.baseCurrency ? null : cost.exchangeRate,
        allocation: cost.allocation,
      })),
    );
  }
  const costing = await buildLots(tx, input);
  if (!costing.ok) throw new PurchasingError(costing.problem);
  return costing;
}

/** Landed cost per delivery (main currency) and whether it has lots, for the PO page. */
export async function deliveryCostSummary(
  tx: Transaction,
  receiptIds: string[],
): Promise<Map<string, { landedCost: string; totalCost: string; currency: string }>> {
  if (!receiptIds.length) return new Map();
  const rows = await tx
    .select({
      receiptId: purchaseReceiptLines.receiptId,
      currency: inventoryLots.currency,
      landedCost: sql<string>`sum(${inventoryLots.landedCost})`,
      totalCost: sql<string>`sum(${inventoryLots.productCost} + ${inventoryLots.landedCost})`,
    })
    .from(inventoryLots)
    .innerJoin(purchaseReceiptLines, eq(purchaseReceiptLines.id, inventoryLots.receiptLineId))
    .where(inArray(purchaseReceiptLines.receiptId, receiptIds))
    .groupBy(purchaseReceiptLines.receiptId, inventoryLots.currency);
  return new Map(
    rows.map((row) => [
      row.receiptId,
      { landedCost: row.landedCost, totalCost: row.totalCost, currency: row.currency },
    ]),
  );
}

export type LotRow = {
  id: string;
  productId: string;
  productName: string;
  productSku: string | null;
  source: "receipt" | "opening";
  receivedOn: string;
  quantity: number;
  /** Units already in cost of goods sold. */
  consumed: number;
  currency: string;
  productCost: string;
  landedCost: string;
  notes: string | null;
  /** Receipt lots only. */
  purchaseOrderId: string | null;
  purchaseOrderNumber: number | null;
  supplierName: string | null;
  receiptId: string | null;
};

function like(search: string) {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Lots by product, oldest first within each (the order sales use them in). */
export async function listLots(
  tx: Transaction,
  options: { search?: string } = {},
): Promise<LotRow[]> {
  const search = options.search?.trim();
  const rows = await tx
    .select({
      id: inventoryLots.id,
      productId: inventoryLots.productId,
      productName: products.name,
      productSku: products.sku,
      source: inventoryLots.source,
      receivedOn: inventoryLots.receivedOn,
      quantity: inventoryLots.quantity,
      consumed: sql<number>`coalesce((select sum(c.quantity) from lot_consumptions c where c.lot_id = "inventory_lots"."id"), 0)::int`,
      currency: inventoryLots.currency,
      productCost: inventoryLots.productCost,
      landedCost: inventoryLots.landedCost,
      notes: inventoryLots.notes,
      purchaseOrderId: purchaseOrders.id,
      purchaseOrderNumber: purchaseOrders.number,
      supplierName: contacts.name,
      receiptId: purchaseReceiptLines.receiptId,
    })
    .from(inventoryLots)
    .innerJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(purchaseReceiptLines, eq(purchaseReceiptLines.id, inventoryLots.receiptLineId))
    .leftJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptLines.receiptId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
    .leftJoin(contacts, eq(contacts.id, purchaseOrders.supplierId))
    .where(
      search
        ? or(
            ilike(products.name, like(search)),
            ilike(products.sku, like(search)),
            ilike(contacts.name, like(search)),
          )
        : undefined,
    )
    .orderBy(
      asc(products.name),
      asc(inventoryLots.productId),
      asc(inventoryLots.receivedOn),
      asc(inventoryLots.createdAt),
    )
    .limit(1000);
  return rows.map((row) => ({ ...row, consumed: Number(row.consumed) }));
}

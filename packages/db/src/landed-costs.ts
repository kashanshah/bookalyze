import {
  type AllocationMethod,
  type Costing,
  costDelivery,
  LANDED_COST_KIND_LABELS,
  type LandedCostKind,
  MONEY_ACCOUNT_SUBTYPES,
} from "@bookalyze/core";
import { and, asc, eq, ilike, inArray, isNull, max, or, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { lotsConsumed } from "./cogs";
import { postDelivery } from "./purchase-books";
import { PurchasingError } from "./purchasing";
import { accounts, contacts, journalEntries, journalLines } from "./schema/accounting";
import {
  inventoryLots,
  products,
  purchaseOrderLines,
  purchaseOrders,
  purchasePayments,
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
  /** Who it's paid to, when not the supplier (a shipping company, a customs broker). */
  contactId?: string | null;
  /** The payment on the order that paid it; its amount, currency and rate then come from it. */
  paymentId?: string | null;
};

/** The payment a cost is linked to, for the landed cost page. */
export type CostPaidBy = { date: string; entryNumber: number; journalEntryId: string };

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
  costs: (DeliveryCostInput & { id: string; paidBy: CostPaidBy | null })[];
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
      contactId: purchaseReceiptCosts.contactId,
      paymentId: purchaseReceiptCosts.paymentId,
      paidOn: journalEntries.date,
      entryNumber: journalEntries.entryNumber,
      journalEntryId: journalEntries.id,
    })
    .from(purchaseReceiptCosts)
    .leftJoin(purchasePayments, eq(purchasePayments.id, purchaseReceiptCosts.paymentId))
    .leftJoin(journalEntries, eq(journalEntries.id, purchasePayments.journalEntryId))
    .where(eq(purchaseReceiptCosts.receiptId, receiptId))
    .orderBy(asc(purchaseReceiptCosts.lineNo));
  return {
    ...receipt,
    lines,
    costs: costs.map(({ paidOn, entryNumber, journalEntryId, ...cost }) => ({
      ...cost,
      paidBy:
        paidOn && entryNumber !== null && journalEntryId
          ? { date: paidOn, entryNumber, journalEntryId }
          : null,
    })),
  };
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
    userId?: string | null;
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
  // A cost paid by a payment keeps that payment's amount, currency and rate: what left the bank.
  const linked = new Map(
    (
      await tx
        .select({
          paymentId: purchaseReceiptCosts.paymentId,
          kind: purchaseReceiptCosts.kind,
          description: purchaseReceiptCosts.description,
          amount: purchaseReceiptCosts.amount,
          currency: purchaseReceiptCosts.currency,
          exchangeRate: purchaseReceiptCosts.exchangeRate,
          contactId: purchaseReceiptCosts.contactId,
        })
        .from(purchaseReceiptCosts)
        .where(
          and(
            eq(purchaseReceiptCosts.receiptId, input.receiptId),
            sql`${purchaseReceiptCosts.paymentId} is not null`,
          ),
        )
    ).map((row) => [row.paymentId as string, row]),
  );
  const costs = input.costs.map((cost) => {
    if (!cost.paymentId) return { ...cost, paymentId: null };
    const paid = linked.get(cost.paymentId);
    if (!paid) throw new PurchasingError("That payment no longer pays a cost on this delivery.");
    return {
      ...cost,
      amount: paid.amount,
      currency: paid.currency,
      exchangeRate: paid.exchangeRate,
      contactId: paid.contactId,
    };
  });
  const kept = new Set(costs.map((cost) => cost.paymentId));
  const dropped = [...linked.values()].find((cost) => !kept.has(cost.paymentId));
  if (dropped) {
    throw new PurchasingError(
      `${dropped.description || LANDED_COST_KIND_LABELS[dropped.kind]} was paid by a payment on the order. Take that payment off the order to remove it.`,
    );
  }
  await tx
    .update(purchaseReceipts)
    .set({ exchangeRate: po.currency === input.baseCurrency ? null : input.exchangeRate })
    .where(eq(purchaseReceipts.id, input.receiptId));
  await tx.delete(purchaseReceiptCosts).where(eq(purchaseReceiptCosts.receiptId, input.receiptId));
  if (costs.length) {
    await tx.insert(purchaseReceiptCosts).values(
      costs.map((cost, index) => ({
        organizationId: input.orgId,
        receiptId: input.receiptId,
        lineNo: index + 1,
        kind: cost.kind,
        description: cost.description,
        amount: cost.amount,
        currency: cost.currency,
        exchangeRate: cost.currency === input.baseCurrency ? null : cost.exchangeRate,
        allocation: cost.allocation,
        contactId: cost.contactId || null,
        paymentId: cost.paymentId,
      })),
    );
  }
  const costing = await buildLots(tx, input);
  if (!costing.ok) throw new PurchasingError(costing.problem);
  await postDelivery(tx, { ...input, userId: input.userId ?? null });
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
  source: "receipt" | "opening" | "return" | "found";
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

/** What happened to a payment's cost: added or linked, or why it couldn't be. */
export type PaymentCostResult =
  | { ok: true; costId: string; added: boolean }
  | { ok: false; problem: string };

/**
 * Puts a payment for a delivery (freight, duty… paid to someone other than the supplier) on that
 * delivery's landed cost: as a new cost, or on one already entered by hand (`costId`). The cost
 * takes the payment's amount and currency, at the rate it was actually paid (from what left the
 * bank), then the delivery's lots are re-costed and, for an order in the books, re-posted.
 * Nothing changes when the delivery's stock is already in a month's cost of goods sold.
 */
export async function linkPaymentCost(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    baseCurrency: string;
    paymentId: string;
    /** When set, the payment must be on this order. */
    purchaseOrderId?: string;
    /** A cost on the delivery not paid yet; null adds a new one. */
    costId: string | null;
    kind: LandedCostKind;
    description: string | null;
  },
): Promise<PaymentCostResult> {
  const [payment] = await tx
    .select({
      receiptId: purchasePayments.receiptId,
      contactId: purchasePayments.contactId,
      journalEntryId: purchasePayments.journalEntryId,
      amount: purchasePayments.amount,
      currency: purchasePayments.currency,
      supplierId: purchaseOrders.supplierId,
      poCurrency: purchaseOrders.currency,
    })
    .from(purchasePayments)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchasePayments.purchaseOrderId))
    .where(
      and(
        eq(purchasePayments.id, input.paymentId),
        input.purchaseOrderId
          ? eq(purchasePayments.purchaseOrderId, input.purchaseOrderId)
          : undefined,
      ),
    )
    .for("update");
  if (!payment) return { ok: false, problem: "That payment is no longer on this order." };
  if (!payment.receiptId || payment.contactId === payment.supplierId) {
    return {
      ok: false,
      problem: "Only a payment for a delivery's extra costs goes on its landed cost.",
    };
  }
  const receiptId = payment.receiptId;
  const [taken] = await tx
    .select({ id: purchaseReceiptCosts.id })
    .from(purchaseReceiptCosts)
    .where(eq(purchaseReceiptCosts.paymentId, input.paymentId));
  if (taken) return { ok: true, costId: taken.id, added: false };

  const lots = await tx
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .innerJoin(purchaseReceiptLines, eq(purchaseReceiptLines.id, inventoryLots.receiptLineId))
    .where(eq(purchaseReceiptLines.receiptId, receiptId));
  const usedIn = await lotsConsumed(
    tx,
    lots.map((lot) => lot.id),
  );
  if (usedIn) {
    return {
      ok: false,
      problem: `The delivery's stock is already in cost of goods sold (${usedIn}), so its landed cost can't change. Undo that month, then add the payment to the landed cost.`,
    };
  }

  const exchangeRate =
    payment.currency === input.baseCurrency ? null : await paidRate(tx, payment, receiptId);
  if (payment.currency !== input.baseCurrency && !exchangeRate) {
    return {
      ok: false,
      problem: `The rate it was paid at isn't known. Add it on the delivery's landed cost page with its ${payment.currency} rate.`,
    };
  }
  const values = {
    amount: payment.amount,
    currency: payment.currency,
    exchangeRate,
    contactId: payment.contactId,
    paymentId: input.paymentId,
  };
  let costId: string;
  let added = false;
  if (input.costId) {
    const [cost] = await tx
      .update(purchaseReceiptCosts)
      .set(values)
      .where(
        and(
          eq(purchaseReceiptCosts.id, input.costId),
          eq(purchaseReceiptCosts.receiptId, receiptId),
          isNull(purchaseReceiptCosts.paymentId),
        ),
      )
      .returning({ id: purchaseReceiptCosts.id });
    if (!cost) {
      return { ok: false, problem: "That cost is no longer on the delivery, or is already paid." };
    }
    costId = cost.id;
  } else {
    const [last] = await tx
      .select({ lineNo: max(purchaseReceiptCosts.lineNo), count: sql<number>`count(*)::int` })
      .from(purchaseReceiptCosts)
      .where(eq(purchaseReceiptCosts.receiptId, receiptId));
    if (Number(last?.count ?? 0) >= 20) {
      return { ok: false, problem: "The delivery already has 20 costs, the most it can have." };
    }
    const [cost] = await tx
      .insert(purchaseReceiptCosts)
      .values({
        organizationId: input.orgId,
        receiptId,
        lineNo: (last?.lineNo ?? 0) + 1,
        kind: input.kind,
        description: input.description,
        allocation: "value",
        ...values,
      })
      .returning({ id: purchaseReceiptCosts.id });
    if (!cost) throw new Error("The cost wasn't saved.");
    costId = cost.id;
    added = true;
  }
  const costing = await buildLots(tx, {
    orgId: input.orgId,
    receiptId,
    baseCurrency: input.baseCurrency,
  });
  if (!costing.ok) throw new PurchasingError(costing.problem);
  await postDelivery(tx, {
    orgId: input.orgId,
    userId: input.userId,
    baseCurrency: input.baseCurrency,
    receiptId,
  });
  return { ok: true, costId, added };
}

const moneySubtypes = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "));

/**
 * The main-currency value of one unit of the payment's currency, as paid: what left the bank
 * (in the main currency) over the payment's amount. When the transaction pays several things in
 * that currency, they share it by amount. Falls back to the delivery's rate when the payment is
 * in the order's currency and the bank side isn't known.
 */
async function paidRate(
  tx: Transaction,
  payment: { journalEntryId: string; currency: string; poCurrency: string },
  receiptId: string,
): Promise<string | null> {
  // Paid in the cost's own currency: the transaction's own rate (main currency per unit), so a
  // split one (part for this order, part for something else) prices its part right.
  const [own] = await tx
    .execute<{ rate: string | null }>(sql`
    select round(abs(sum(l.base_amount)) / nullif(abs(sum(l.amount)), 0), 10)::text as rate
    from ${journalLines} l join ${accounts} a on a.id = l.account_id
    where l.journal_entry_id = ${payment.journalEntryId} and a.subtype in (${moneySubtypes})
      and l.currency = ${payment.currency}
    having count(*) > 0`)
    .then((r) => r.rows);
  if (own?.rate && Number(own.rate) > 0) return own.rate;
  // Paid in another currency (e.g. a USD freight bill paid in AED): what left the bank over
  // what the payments on it say they were.
  const [row] = await tx
    .execute<{ rate: string | null }>(sql`
    select round(abs(sum(l.base_amount)) / nullif((
        select sum(p.amount) from ${purchasePayments} p
        where p.journal_entry_id = ${payment.journalEntryId} and p.currency = ${payment.currency}), 0), 10)::text as rate
    from ${journalLines} l join ${accounts} a on a.id = l.account_id
    where l.journal_entry_id = ${payment.journalEntryId} and a.subtype in (${moneySubtypes})
    having count(*) > 0`)
    .then((r) => r.rows);
  if (row?.rate && Number(row.rate) > 0) return row.rate;
  if (payment.currency !== payment.poCurrency) return null;
  const [receipt] = await tx
    .select({ rate: purchaseReceipts.exchangeRate })
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.id, receiptId));
  return receipt?.rate ?? null;
}

export type UnpaidDeliveryCost = {
  id: string;
  receiptId: string;
  kind: LandedCostKind;
  description: string | null;
  amount: string;
  currency: string;
  contactId: string | null;
};

/** The extra costs on the order's deliveries that no payment pays yet, for the payment dialog. */
export async function unpaidDeliveryCosts(
  tx: Transaction,
  purchaseOrderId: string,
): Promise<UnpaidDeliveryCost[]> {
  return tx
    .select({
      id: purchaseReceiptCosts.id,
      receiptId: purchaseReceiptCosts.receiptId,
      kind: purchaseReceiptCosts.kind,
      description: purchaseReceiptCosts.description,
      amount: purchaseReceiptCosts.amount,
      currency: purchaseReceiptCosts.currency,
      contactId: purchaseReceiptCosts.contactId,
    })
    .from(purchaseReceiptCosts)
    .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptCosts.receiptId))
    .where(
      and(
        eq(purchaseReceipts.purchaseOrderId, purchaseOrderId),
        isNull(purchaseReceiptCosts.paymentId),
      ),
    )
    .orderBy(asc(purchaseReceipts.receivedOn), asc(purchaseReceiptCosts.lineNo));
}

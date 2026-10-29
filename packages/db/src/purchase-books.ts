import {
  divRound,
  formatDecimal,
  isMoneyAccountSubtype,
  parseDecimal,
  purchaseOrderNumber,
} from "@bookalyze/core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { ensureSystemAccount, postLines } from "./cogs";
import { reverseJournalEntry } from "./ledger";
import { PurchasingError } from "./purchasing";
import { accounts, journalEntries, journalLines } from "./schema/accounting";
import {
  inventoryLots,
  purchaseOrders,
  purchasePayments,
  purchaseReceiptLines,
  purchaseReceipts,
  purchaseSettings,
} from "./schema/inventory";
import { replaceJournalEntry } from "./transactions";

/**
 * Purchase orders in the books (phase 5, slice 9). From a start date, an order's payments go to
 * Supplier deposits (an asset: paid, not yet received), and each delivery moves its landed cost
 * from there into Inventory. Once everything has arrived and the supplier is paid, what's left
 * on deposits for the order (exchange rates that moved between paying and receiving, a cost
 * that changed) is settled to exchange gains or losses. Orders dated before the start stay as
 * they were: payments categorised to Inventory by hand, nothing posted for deliveries.
 */

export async function getPurchaseSettings(tx: Transaction): Promise<{ postFrom: string } | null> {
  const [row] = await tx.select({ postFrom: purchaseSettings.postFrom }).from(purchaseSettings);
  return row ?? null;
}

/** Whether an order is in the books: dated on or after the start. */
export function orderInBooks(orderDate: string, settings: { postFrom: string } | null): boolean {
  return Boolean(settings && orderDate >= settings.postFrom);
}

type Ctx = { orgId: string; userId: string | null; baseCurrency: string };

/**
 * Puts a bank transaction's category on Supplier deposits (a corrected entry replaces it; its
 * payments, receipts and review follow). Only a transaction with a single category can be moved;
 * one already there, or split with a part already there, is left alone. Returns the entry now holding the payment.
 */
export async function moveToAccount(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    entryId: string;
    accountId: string;
    /** Put on the transaction if it has no customer or vendor yet (the order's supplier). */
    contactId?: string | null;
  },
): Promise<string> {
  const [entry] = await tx
    .select({
      id: journalEntries.id,
      date: journalEntries.date,
      memo: journalEntries.memo,
      reference: journalEntries.reference,
      contactId: journalEntries.contactId,
      currency: journalEntries.currency,
      fxRate: journalEntries.fxRate,
      reversedBy: journalEntries.reversedByEntryId,
    })
    .from(journalEntries)
    .where(eq(journalEntries.id, input.entryId));
  if (!entry || entry.reversedBy)
    throw new PurchasingError("That transaction is no longer in the books.");
  const lines = await tx
    .select({
      accountId: journalLines.accountId,
      subtype: accounts.subtype,
      description: journalLines.description,
      currency: journalLines.currency,
      amount: journalLines.amount,
      baseAmount: journalLines.baseAmount,
      taxRateId: journalLines.taxRateId,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.journalEntryId, entry.id))
    .orderBy(journalLines.lineNo);
  const categories = lines.filter((l) => !isMoneyAccountSubtype(l.subtype));
  if (categories.every((l) => l.accountId === input.accountId)) return entry.id;
  // A split transaction with a part already there (e.g. freight for this company, the rest
  // another company's share): that part is what counts, and the transaction stays as it is.
  if (categories.some((l) => l.accountId === input.accountId)) return entry.id;
  if (new Set(categories.map((l) => l.accountId)).size > 1 || categories.some((l) => l.taxRateId)) {
    throw new PurchasingError(
      "That transaction is split across categories or has tax on it. Change its category to Supplier deposits yourself, then link it.",
    );
  }
  const total = lines.reduce((sum, l) => {
    const units = parseDecimal(l.amount);
    return units > 0n ? sum + units : sum;
  }, 0n);
  const posted = await replaceJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: entry.id,
    date: entry.date,
    reference: entry.reference,
    memo: entry.memo,
    contactId: entry.contactId ?? input.contactId ?? null,
    entry: {
      currency: entry.currency,
      fxRate: entry.fxRate,
      total: formatDecimal(total),
      lines: lines.map((l, index) => ({
        index,
        accountId: isMoneyAccountSubtype(l.subtype) ? l.accountId : input.accountId,
        description: l.description,
        currency: l.currency,
        amount: l.amount,
        baseAmount: l.baseAmount,
        taxRateId: null,
      })),
    },
  });
  return posted.id;
}

/** The order's counted payments (to anyone), with the main-currency value each put on deposits. */
async function orderPayments(tx: Transaction, purchaseOrderId: string, depositsId: string) {
  const rows = await tx
    .select({
      id: purchasePayments.id,
      journalEntryId: purchasePayments.journalEntryId,
      amount: purchasePayments.amount,
      // Everything linked from the same transaction, to share its deposit between orders.
      linked: sql<string>`(select sum(p2.amount)::text from ${purchasePayments} p2
        where p2.journal_entry_id = ${purchasePayments.journalEntryId})`,
      deposited: sql<string>`(select coalesce(sum(l.base_amount), 0)::text from ${journalLines} l
        where l.journal_entry_id = ${purchasePayments.journalEntryId} and l.account_id = ${depositsId})`,
    })
    .from(purchasePayments)
    .innerJoin(journalEntries, eq(journalEntries.id, purchasePayments.journalEntryId))
    .where(
      and(
        eq(purchasePayments.purchaseOrderId, purchaseOrderId),
        isNull(journalEntries.reversedByEntryId),
      ),
    );
  return rows.map((row) => {
    const linked = parseDecimal(row.linked);
    const deposited = parseDecimal(row.deposited);
    // This order's share of what the transaction put on deposits.
    const share = linked > 0n ? divRound(deposited * parseDecimal(row.amount), linked) : deposited;
    return { ...row, base: share };
  });
}

/**
 * Posts (or re-posts) a delivery of an order in the books: Dr Inventory / Cr Supplier deposits
 * for its lots' landed cost, on the day it arrived. Nothing changes if the cost is the same.
 */
export async function postDelivery(
  tx: Transaction,
  input: Ctx & { receiptId: string },
): Promise<void> {
  const settings = await getPurchaseSettings(tx);
  if (!settings) return;
  const [receipt] = await tx
    .select({
      id: purchaseReceipts.id,
      receivedOn: purchaseReceipts.receivedOn,
      journalEntryId: purchaseReceipts.journalEntryId,
      orderDate: purchaseOrders.orderDate,
      number: purchaseOrders.number,
      supplierId: purchaseOrders.supplierId,
    })
    .from(purchaseReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
    .where(eq(purchaseReceipts.id, input.receiptId));
  if (!receipt || !orderInBooks(receipt.orderDate, settings)) return;
  const [cost] = await tx
    .select({
      total: sql<string>`coalesce(sum(${inventoryLots.productCost} + ${inventoryLots.landedCost}), 0)::text`,
    })
    .from(inventoryLots)
    .innerJoin(purchaseReceiptLines, eq(purchaseReceiptLines.id, inventoryLots.receiptLineId))
    .where(eq(purchaseReceiptLines.receiptId, receipt.id));
  const total = parseDecimal(cost?.total ?? "0");
  if (receipt.journalEntryId) {
    const [existing] = await tx
      .select({ amount: journalLines.baseAmount, date: journalEntries.date })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(
        and(
          eq(journalLines.journalEntryId, receipt.journalEntryId),
          isNull(journalEntries.reversedByEntryId),
          sql`${journalLines.amount} > 0`,
        ),
      );
    if (
      existing &&
      parseDecimal(existing.amount) === total &&
      existing.date === receipt.receivedOn
    ) {
      return;
    }
    if (existing) {
      // Reversed on its own day, so a delivery moved to another day leaves nothing behind.
      await reverseJournalEntry(tx, {
        orgId: input.orgId,
        userId: input.userId,
        entryId: receipt.journalEntryId,
        date: existing.date,
      });
    }
  }
  const inventory = await ensureSystemAccount(tx, input.orgId, "inventory");
  const deposits = await ensureSystemAccount(tx, input.orgId, "supplier_deposits");
  const entryId = await postLines(tx, {
    orgId: input.orgId,
    userId: input.userId,
    baseCurrency: input.baseCurrency,
    date: receipt.receivedOn,
    memo: `${purchaseOrderNumber(receipt.number)} · delivery into stock`,
    source: "purchase",
    sourceId: receipt.id,
    contactId: receipt.supplierId,
    lines: [
      { accountId: inventory, amount: total },
      { accountId: deposits, amount: -total },
    ],
  });
  await tx
    .update(purchaseReceipts)
    .set({ journalEntryId: entryId })
    .where(eq(purchaseReceipts.id, receipt.id));
}

/**
 * Makes an order in the books consistent: every payment on Supplier deposits, every delivery
 * posted at its current landed cost. Returns what couldn't be done, in plain words.
 */
export async function syncOrderBooks(
  tx: Transaction,
  input: Ctx & { purchaseOrderId: string },
): Promise<string[]> {
  const settings = await getPurchaseSettings(tx);
  const [po] = await tx
    .select({ id: purchaseOrders.id, orderDate: purchaseOrders.orderDate })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.purchaseOrderId));
  if (!po || !orderInBooks(po.orderDate, settings)) return [];
  const problems: string[] = [];
  const deposits = await ensureSystemAccount(tx, input.orgId, "supplier_deposits");
  const payments = await tx
    .select({ journalEntryId: purchasePayments.journalEntryId })
    .from(purchasePayments)
    .innerJoin(journalEntries, eq(journalEntries.id, purchasePayments.journalEntryId))
    .where(
      and(eq(purchasePayments.purchaseOrderId, po.id), isNull(journalEntries.reversedByEntryId)),
    );
  for (const entryId of new Set(payments.map((p) => p.journalEntryId))) {
    try {
      await moveToAccount(tx, { ...input, entryId, accountId: deposits });
    } catch (error) {
      if (!(error instanceof PurchasingError)) throw error;
      problems.push(error.message);
    }
  }
  const receipts = await tx
    .select({ id: purchaseReceipts.id })
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.purchaseOrderId, po.id));
  for (const receipt of receipts) await postDelivery(tx, { ...input, receiptId: receipt.id });
  return problems;
}

export type OrderDeposits = {
  /** Paid in (main currency) for this order, to anyone. */
  paidIn: string;
  /** Moved into stock by its deliveries. */
  intoStock: string;
  /** Settled already. */
  settled: string;
  /** Left on deposits for the order: + paid more than came in, − owed. */
  left: string;
  settlementEntryId: string | null;
};

/** What's on Supplier deposits for one order, in the main currency. */
export async function orderDeposits(
  tx: Transaction,
  input: { orgId: string; purchaseOrderId: string },
): Promise<OrderDeposits> {
  const deposits = await ensureSystemAccount(tx, input.orgId, "supplier_deposits");
  const paid = (await orderPayments(tx, input.purchaseOrderId, deposits)).reduce(
    (sum, p) => sum + p.base,
    0n,
  );
  const [po] = await tx
    .select({ settlementEntryId: purchaseOrders.settlementEntryId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.purchaseOrderId));
  const entryIds = (
    await tx
      .select({ id: purchaseReceipts.journalEntryId })
      .from(purchaseReceipts)
      .where(eq(purchaseReceipts.purchaseOrderId, input.purchaseOrderId))
  )
    .map((r) => r.id)
    .filter((id): id is string => Boolean(id));
  const credited = async (ids: string[]) => {
    if (!ids.length) return 0n;
    const [row] = await tx
      .select({ sum: sql<string>`coalesce(sum(${journalLines.baseAmount}), 0)::text` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(
        and(
          inArray(journalLines.journalEntryId, ids),
          eq(journalLines.accountId, deposits),
          isNull(journalEntries.reversedByEntryId),
        ),
      );
    return -parseDecimal(row?.sum ?? "0");
  };
  const intoStock = await credited(entryIds);
  const settlementEntryId = po?.settlementEntryId ?? null;
  const settled = settlementEntryId ? await credited([settlementEntryId]) : 0n;
  return {
    paidIn: formatDecimal(paid),
    intoStock: formatDecimal(intoStock),
    settled: formatDecimal(settled),
    left: formatDecimal(paid - intoStock - settled),
    settlementEntryId: settled !== 0n ? settlementEntryId : null,
  };
}

/**
 * Settles what's left on deposits for an order that has fully arrived: to exchange losses when
 * more was paid than went into stock, to exchange gains when less.
 */
export async function settleOrder(
  tx: Transaction,
  input: Ctx & { purchaseOrderId: string; date: string },
): Promise<string | null> {
  const [po] = await tx
    .select({
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.purchaseOrderId))
    .for("update");
  if (!po) throw new PurchasingError("This purchase order no longer exists.");
  if (po.status !== "received") {
    throw new PurchasingError("Settle it once everything on the order has arrived.");
  }
  const now = await orderDeposits(tx, input);
  if (now.settlementEntryId) throw new PurchasingError("This order is already settled.");
  const left = parseDecimal(now.left);
  if (left === 0n) return null;
  const deposits = await ensureSystemAccount(tx, input.orgId, "supplier_deposits");
  const other = await ensureSystemAccount(tx, input.orgId, left > 0n ? "fx_loss" : "fx_gain");
  const entryId = await postLines(tx, {
    orgId: input.orgId,
    userId: input.userId,
    baseCurrency: input.baseCurrency,
    date: input.date,
    memo: `${purchaseOrderNumber(po.number)} · settled: exchange and cost differences`,
    source: "purchase",
    sourceId: input.purchaseOrderId,
    contactId: po.supplierId,
    lines: [
      { accountId: other, amount: left },
      { accountId: deposits, amount: -left },
    ],
  });
  await tx
    .update(purchaseOrders)
    .set({ settlementEntryId: entryId })
    .where(eq(purchaseOrders.id, input.purchaseOrderId));
  return entryId;
}

/** Undoes the settlement (reversed on its own date). */
export async function undoSettlement(
  tx: Transaction,
  input: { orgId: string; userId: string | null; purchaseOrderId: string },
) {
  const [po] = await tx
    .select({ entryId: purchaseOrders.settlementEntryId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.purchaseOrderId))
    .for("update");
  if (!po?.entryId) throw new PurchasingError("This order isn't settled.");
  const [entry] = await tx
    .select({ date: journalEntries.date })
    .from(journalEntries)
    .where(eq(journalEntries.id, po.entryId));
  await reverseJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    entryId: po.entryId,
    date: entry?.date ?? "",
  });
  await tx
    .update(purchaseOrders)
    .set({ settlementEntryId: null })
    .where(eq(purchaseOrders.id, input.purchaseOrderId));
}

/**
 * Starts (or moves) purchase orders in the books from `postFrom`: orders dated from then are
 * synced (payments onto deposits, deliveries posted). Moving the start later is refused once
 * something has been posted for an order it would leave out.
 */
export async function savePurchaseSettings(
  tx: Transaction,
  input: Ctx & { postFrom: string },
): Promise<{ orders: number; problems: string[] }> {
  const current = await getPurchaseSettings(tx);
  if (current && input.postFrom > current.postFrom) {
    const [posted] = await tx
      .select({ id: purchaseReceipts.id })
      .from(purchaseReceipts)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
      .innerJoin(journalEntries, eq(journalEntries.id, purchaseReceipts.journalEntryId))
      .where(
        and(
          sql`${purchaseOrders.orderDate} < ${input.postFrom}`,
          isNull(journalEntries.reversedByEntryId),
        ),
      )
      .limit(1);
    if (posted) {
      throw new PurchasingError(
        "Deliveries of orders before that date are already in the books, so the start can't move later.",
      );
    }
  }
  await tx
    .insert(purchaseSettings)
    .values({ organizationId: input.orgId, postFrom: input.postFrom, updatedBy: input.userId })
    .onConflictDoUpdate({
      target: purchaseSettings.organizationId,
      set: { postFrom: input.postFrom, updatedBy: input.userId, updatedAt: new Date() },
    });
  await ensureSystemAccount(tx, input.orgId, "supplier_deposits");
  const orders = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        sql`${purchaseOrders.orderDate} >= ${input.postFrom}`,
        sql`${purchaseOrders.status} <> 'draft'`,
      ),
    );
  const problems: string[] = [];
  for (const po of orders) {
    problems.push(...(await syncOrderBooks(tx, { ...input, purchaseOrderId: po.id })));
  }
  return { orders: orders.length, problems };
}

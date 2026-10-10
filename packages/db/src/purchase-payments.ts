import { MONEY_ACCOUNT_SUBTYPES, type PaymentPlanPart } from "@bookalyze/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { PurchasingError } from "./purchasing";
import { accounts, contacts, journalEntries, journalLines } from "./schema/accounting";
import { purchaseOrders, purchasePayments, purchaseReceipts } from "./schema/inventory";

/**
 * Paying for purchase orders (phase 5, slice 8): the order's payment plan, and payments linked
 * to it. A payment is a bank transaction already in the books (or one just added for it) and the
 * part of it that went to this order, in the currency it was owed in.
 */

const moneySubtypes = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "));

export type PurchasePaymentRow = {
  id: string;
  receiptId: string | null;
  contactId: string;
  contactName: string;
  label: string | null;
  amount: string;
  currency: string;
  journalEntryId: string;
  entryNumber: number;
  date: string;
  memo: string | null;
  /** Removed from the books (reversed): it no longer counts. */
  removed: boolean;
  /** What left the bank, in the bank account's currency (positive), and in the main currency. */
  bank: { accountId: string; amount: string; currency: string; baseAmount: string } | null;
};

/** The order's payments, oldest first. */
export async function listPurchasePayments(
  tx: Transaction,
  purchaseOrderId: string,
): Promise<PurchasePaymentRow[]> {
  const rows = await tx
    .select({
      id: purchasePayments.id,
      receiptId: purchasePayments.receiptId,
      contactId: purchasePayments.contactId,
      contactName: contacts.name,
      label: purchasePayments.label,
      amount: purchasePayments.amount,
      currency: purchasePayments.currency,
      journalEntryId: purchasePayments.journalEntryId,
      entryNumber: journalEntries.entryNumber,
      date: journalEntries.date,
      memo: journalEntries.memo,
      reversedBy: journalEntries.reversedByEntryId,
      bank: sql<{
        accountId: string;
        amount: string;
        currency: string;
        baseAmount: string;
      } | null>`(select json_build_object(
          'accountId', min(l.account_id::text),
          'amount', (-sum(l.amount))::text,
          'currency', min(l.currency),
          'baseAmount', (-sum(l.base_amount))::text)
        from ${journalLines} l join ${accounts} a on a.id = l.account_id
        where l.journal_entry_id = ${journalEntries.id} and a.subtype in (${moneySubtypes})
        having count(*) > 0)`,
    })
    .from(purchasePayments)
    .innerJoin(journalEntries, eq(journalEntries.id, purchasePayments.journalEntryId))
    .innerJoin(contacts, eq(contacts.id, purchasePayments.contactId))
    .where(eq(purchasePayments.purchaseOrderId, purchaseOrderId))
    .orderBy(asc(journalEntries.date), asc(purchasePayments.createdAt));
  return rows.map(({ reversedBy, ...row }) => ({ ...row, removed: reversedBy !== null }));
}

/** The order's currency, total and supplier, to check a payment or plan against. */
async function orderForPayment(tx: Transaction, purchaseOrderId: string) {
  const [po] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
      currency: purchaseOrders.currency,
      supplierId: purchaseOrders.supplierId,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, purchaseOrderId))
    .for("update");
  if (!po) throw new PurchasingError("This purchase order no longer exists.");
  return po;
}

/**
 * Links a transaction to the order as a payment. To the supplier (in the order's currency) by
 * default; with `receiptId`, a delivery's extra cost paid to someone else, in any currency.
 */
export async function addPurchasePayment(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    purchaseOrderId: string;
    journalEntryId: string;
    contactId?: string | null;
    receiptId?: string | null;
    label: string | null;
    amount: string;
    currency?: string | null;
  },
): Promise<{ id: string }> {
  const po = await orderForPayment(tx, input.purchaseOrderId);
  if (po.status === "cancelled") {
    throw new PurchasingError("This order was cancelled, so it takes no more payments.");
  }
  const [entry] = await tx
    .select({
      reversedBy: journalEntries.reversedByEntryId,
      reverses: journalEntries.reversesEntryId,
    })
    .from(journalEntries)
    .where(eq(journalEntries.id, input.journalEntryId));
  if (!entry || entry.reversedBy || entry.reverses) {
    throw new PurchasingError("That transaction is no longer in the books.");
  }
  if (input.receiptId) {
    const [receipt] = await tx
      .select({ id: purchaseReceipts.id })
      .from(purchaseReceipts)
      .where(
        and(eq(purchaseReceipts.id, input.receiptId), eq(purchaseReceipts.purchaseOrderId, po.id)),
      );
    if (!receipt) throw new PurchasingError("That delivery isn't on this order.");
  }
  const contactId = input.contactId || po.supplierId;
  const [taken] = await tx
    .select({ id: purchasePayments.id })
    .from(purchasePayments)
    .where(
      and(
        eq(purchasePayments.purchaseOrderId, po.id),
        eq(purchasePayments.journalEntryId, input.journalEntryId),
        input.receiptId
          ? eq(purchasePayments.receiptId, input.receiptId)
          : sql`${purchasePayments.receiptId} is null`,
      ),
    );
  if (taken) throw new PurchasingError("That transaction is already a payment on this order.");
  const [row] = await tx
    .insert(purchasePayments)
    .values({
      organizationId: input.orgId,
      purchaseOrderId: po.id,
      receiptId: input.receiptId ?? null,
      contactId,
      journalEntryId: input.journalEntryId,
      label: input.label,
      amount: input.amount,
      // The supplier is paid in the order's currency; others (freight…) in their own.
      currency: contactId === po.supplierId ? po.currency : (input.currency ?? po.currency),
      createdBy: input.userId,
    })
    .returning({ id: purchasePayments.id });
  if (!row) throw new Error("The payment wasn't saved.");
  return row;
}

/** Unlinks a payment from its order. The bank transaction stays in the books. */
export async function removePurchasePayment(
  tx: Transaction,
  input: { purchaseOrderId: string; paymentId: string },
) {
  const removed = await tx
    .delete(purchasePayments)
    .where(
      and(
        eq(purchasePayments.id, input.paymentId),
        eq(purchasePayments.purchaseOrderId, input.purchaseOrderId),
      ),
    )
    .returning({ id: purchasePayments.id });
  if (!removed.length) throw new PurchasingError("That payment is no longer on this order.");
}

export async function savePaymentPlan(
  tx: Transaction,
  input: { purchaseOrderId: string; plan: PaymentPlanPart[] },
) {
  const po = await orderForPayment(tx, input.purchaseOrderId);
  if (po.status === "cancelled") throw new PurchasingError("This order was cancelled.");
  await tx
    .update(purchaseOrders)
    .set({ paymentPlan: input.plan })
    .where(eq(purchaseOrders.id, po.id));
}

/**
 * Paid so far per order to its supplier, in the order's currency. Payments to others (freight…)
 * and ones removed from the books are left out.
 */
export async function paidByOrder(tx: Transaction): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      purchaseOrderId: purchasePayments.purchaseOrderId,
      paid: sql<string>`sum(${purchasePayments.amount})::text`,
    })
    .from(purchasePayments)
    .innerJoin(journalEntries, eq(journalEntries.id, purchasePayments.journalEntryId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchasePayments.purchaseOrderId))
    .where(
      and(
        eq(purchasePayments.contactId, purchaseOrders.supplierId),
        sql`${journalEntries.reversedByEntryId} is null`,
      ),
    )
    .groupBy(purchasePayments.purchaseOrderId);
  return new Map(rows.map((r) => [r.purchaseOrderId, r.paid]));
}

/** Orders a transaction pays toward, for the Transactions list. */
export async function ordersPaidBy(
  tx: Transaction,
  entryIds: readonly string[],
): Promise<Map<string, { purchaseOrderId: string; number: number }[]>> {
  if (!entryIds.length) return new Map();
  const rows = await tx
    .select({
      entryId: purchasePayments.journalEntryId,
      purchaseOrderId: purchasePayments.purchaseOrderId,
      number: purchaseOrders.number,
    })
    .from(purchasePayments)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchasePayments.purchaseOrderId))
    .where(inArray(purchasePayments.journalEntryId, [...entryIds]));
  const map = new Map<string, { purchaseOrderId: string; number: number }[]>();
  for (const r of rows) {
    const list = map.get(r.entryId) ?? [];
    if (!list.some((o) => o.purchaseOrderId === r.purchaseOrderId)) {
      list.push({ purchaseOrderId: r.purchaseOrderId, number: r.number });
    }
    map.set(r.entryId, list);
  }
  return map;
}

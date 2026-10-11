"use server";

import { planProblems, purchaseOrderNumber } from "@bookalyze/core";
import {
  addPurchasePayment,
  addSupplier,
  cancelPurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  ensureSystemAccount,
  getContact,
  getPurchaseOrder,
  getPurchaseSettings,
  LedgerError,
  linkPaymentCost,
  listTransactions,
  markPurchaseOrderOrdered,
  orderInBooks,
  PurchasingError,
  receivePurchaseOrder,
  removePurchasePayment,
  saveDeliveryCosts,
  savePaymentPlan,
  savePurchaseSettings,
  settleOrder,
  undoSettlement,
  updatePurchaseOrder,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate, nowIn, openDate } from "@/lib/dates";
import {
  deliveryCostsSchema,
  paymentCostSchema,
  paymentPlanSchema,
  purchaseOrderSchema,
  purchasePaymentSchema,
  receiveSchema,
} from "@/lib/validation/purchasing";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";
import { isOrgAdmin } from "@/server/org";
import { saveTransactionAction } from "../../accounting/transactions/actions";

type Fail = {
  ok: false;
  message: string;
  errors?: Record<string, string>;
  lineErrors?: Record<string, string>;
};
export type SavePurchaseOrderResult = { ok: true; id: string; number: string } | Fail;
export type PurchaseOrderActionResult = { ok: true; message?: string } | Fail;

const FEATURE = "inventory.purchasing";
const base = (slug: string) => `/o/${slug}/inventory/purchase-orders`;

function issues(error: z.ZodError): {
  errors: Record<string, string>;
  lineErrors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const lineErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const [first, index, field] = issue.path;
    if (first === "lines" && typeof index === "number") {
      lineErrors[`${index}.${String(field ?? "")}`] ??= issue.message;
    } else {
      errors[String(first ?? "form")] ??= issue.message;
    }
  }
  return { errors, lineErrors };
}

function friendly(error: unknown): Fail {
  if (error instanceof PurchasingError) {
    return { ok: false, message: error.message, lineErrors: error.lineErrors };
  }
  // Posting into a closed period, or an entry that no longer balances.
  if (error instanceof LedgerError) return { ok: false, message: error.message };
  throw error;
}

const validId = (id: string) => z.uuid().safeParse(id).success;
const gone: Fail = { ok: false, message: "This purchase order no longer exists." };

/** Creates a draft, or saves changes to one (`id`). */
export async function savePurchaseOrderAction(
  slug: string,
  input: unknown,
  id?: string,
): Promise<SavePurchaseOrderResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (id !== undefined && !validId(id)) return gone;
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", ...issues(parsed.error) };
  }
  try {
    const saved = await inOrg(ctx, async (tx) => {
      let row: { id: string; number: number };
      if (id) {
        await updatePurchaseOrder(tx, { ...parsed.data, id, orgId: ctx.org.id });
        row = { id, number: (await getPurchaseOrder(tx, id))?.number ?? 0 };
      } else {
        row = await createPurchaseOrder(tx, {
          ...parsed.data,
          orgId: ctx.org.id,
          userId: ctx.session.user.id,
        });
      }
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: id ? "purchase_order.updated" : "purchase_order.created",
        entityType: "purchase_order",
        entityId: row.id,
        after: {
          number: row.number,
          supplierId: parsed.data.supplierId,
          currency: parsed.data.currency,
          lines: parsed.data.lines.length,
        },
      });
      return row;
    });
    revalidatePath(base(slug), "layout");
    return { ok: true, id: saved.id, number: purchaseOrderNumber(saved.number) };
  } catch (error) {
    return friendly(error);
  }
}

async function step(
  slug: string,
  id: string,
  action: "ordered" | "cancelled" | "deleted",
): Promise<PurchaseOrderActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(id)) return gone;
  try {
    await inOrg(ctx, async (tx) => {
      if (action === "ordered") await markPurchaseOrderOrdered(tx, id);
      else if (action === "cancelled") await cancelPurchaseOrder(tx, id);
      else await deletePurchaseOrder(tx, id);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: `purchase_order.${action}`,
        entityType: "purchase_order",
        entityId: id,
      });
    });
    revalidatePath(base(slug), "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

/** Draft → sent to the supplier. */
export async function markOrderedAction(slug: string, id: string) {
  return step(slug, id, "ordered");
}

export async function cancelPurchaseOrderAction(slug: string, id: string) {
  return step(slug, id, "cancelled");
}

export async function deletePurchaseOrderAction(slug: string, id: string) {
  return step(slug, id, "deleted");
}

/** Records a delivery: how many of each line arrived, and when. */
export async function receiveAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<PurchaseOrderActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(id)) return gone;
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    const lineErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const [first, key] = issue.path;
      if (first === "quantities" && key !== undefined) lineErrors[String(key)] ??= issue.message;
      else errors[String(first ?? "form")] ??= issue.message;
    }
    return { ok: false, message: "Check the highlighted fields.", errors, lineErrors };
  }
  try {
    const result = await inOrg(ctx, async (tx) => {
      const received = await receivePurchaseOrder(tx, {
        ...parsed.data,
        baseCurrency: ctx.profile.baseCurrency,
        id,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "purchase_order.received",
        entityType: "purchase_order",
        entityId: id,
        after: {
          receiptId: received.receiptId,
          receivedOn: parsed.data.receivedOn,
          units: Object.values(parsed.data.quantities).reduce((sum, n) => sum + n, 0),
          status: received.status,
        },
      });
      return received;
    });
    revalidatePath(base(slug), "layout");
    return {
      ok: true,
      message:
        result.status === "received"
          ? "Everything on this order has arrived."
          : "The rest is still to come.",
    };
  } catch (error) {
    return friendly(error);
  }
}

/** Saves a delivery's exchange rate and extra costs (freight, duty…), re-costing its lots. */
export async function saveDeliveryCostsAction(
  slug: string,
  receiptId: string,
  input: unknown,
): Promise<PurchaseOrderActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(receiptId)) return { ok: false, message: "This delivery no longer exists." };
  const parsed = deliveryCostsSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    const lineErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const [first, index, field] = issue.path;
      if (first === "costs" && typeof index === "number") {
        lineErrors[`${index}.${String(field ?? "")}`] ??= issue.message;
      } else {
        errors[String(first ?? "form")] ??= issue.message;
      }
    }
    return { ok: false, message: "Check the highlighted fields.", errors, lineErrors };
  }
  const { baseCurrency } = ctx.profile;
  const missingRate = parsed.data.costs.findIndex(
    (cost) => cost.currency !== baseCurrency && !cost.exchangeRate,
  );
  if (missingRate !== -1) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      lineErrors: { [`${missingRate}.exchangeRate`]: "Enter the exchange rate." },
    };
  }
  try {
    const costing = await inOrg(ctx, async (tx) => {
      const result = await saveDeliveryCosts(tx, {
        ...parsed.data,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        receiptId,
        baseCurrency,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "purchase_receipt.costs_saved",
        entityType: "purchase_receipt",
        entityId: receiptId,
        after: {
          exchangeRate: parsed.data.exchangeRate,
          costs: parsed.data.costs.length,
          landedCost: result.landedCost,
        },
      });
      return result;
    });
    revalidatePath(`/o/${slug}/inventory`, "layout");
    return { ok: true, message: costing.totalCost };
  } catch (error) {
    return friendly(error);
  }
}

const newSupplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the vendor's name.").max(200, "Keep the name under 200."),
  address: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
});

export type AddSupplierResult = { ok: true; id: string; name: string } | Fail;

/** Adds a receipt's seller as a vendor (or finds the one with that name) for the order form. */
export async function addSupplierAction(slug: string, input: unknown): Promise<AddSupplierResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const parsed = newSupplierSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the vendor's name." };
  }
  const saved = await inOrg(ctx, async (tx) => {
    const supplier = await addSupplier(tx, {
      ...parsed.data,
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: supplier.created ? "contact.created" : "contact.updated",
      entityType: "contact",
      entityId: supplier.id,
      after: { name: supplier.name, type: "vendor", source: "alibaba_receipt" },
    });
    return supplier;
  });
  revalidatePath(`/o/${slug}/accounting`, "layout");
  return { ok: true, id: saved.id, name: saved.name };
}

/** Saves the order's payment plan (any number of parts, each a percentage or an amount). */
export async function savePaymentPlanAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<PurchaseOrderActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(id)) return gone;
  const parsed = paymentPlanSchema.safeParse(input);
  if (!parsed.success) {
    const lineErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const [index, field] = issue.path;
      lineErrors[`${String(index)}.${String(field ?? "value")}`] ??= issue.message;
    }
    return { ok: false, message: "Check the highlighted parts.", lineErrors };
  }
  try {
    return await inOrg(ctx, async (tx): Promise<PurchaseOrderActionResult> => {
      const po = await getPurchaseOrder(tx, id);
      if (!po) return gone;
      const problems = planProblems(parsed.data, po.total, po.currency);
      if (Object.keys(problems).length) {
        const { plan, ...parts } = problems;
        return {
          ok: false,
          message: plan ?? "Check the highlighted parts.",
          lineErrors: Object.fromEntries(
            Object.entries(parts).map(([index, message]) => [`${index}.value`, message]),
          ),
        };
      }
      await savePaymentPlan(tx, { purchaseOrderId: id, plan: parsed.data });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "purchase_order.plan_saved",
        entityType: "purchase_order",
        entityId: id,
        after: { plan: parsed.data },
      });
      return { ok: true };
    });
  } catch (error) {
    return friendly(error);
  } finally {
    revalidatePath(base(slug), "layout");
  }
}

export type PaymentCandidate = {
  id: string;
  number: number;
  date: string;
  memo: string | null;
  contactId: string | null;
  amount: string;
  currency: string;
};

/** Money that went out, newest first, to pick a payment that's already in the books. */
export async function paymentCandidatesAction(
  slug: string,
  search: string,
): Promise<PaymentCandidate[]> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const { rows } = await inOrg(ctx, (tx) =>
    listTransactions(tx, {
      kind: "withdrawal",
      search: search.trim().slice(0, 100) || null,
      limit: 30,
      offset: 0,
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.entryNumber,
    date: row.date,
    memo: row.memo,
    contactId: row.contactId,
    amount: row.view.amount,
    currency: row.currency,
  }));
}

export type RecordPaymentResult =
  | { ok: true; message: string; note?: string }
  | { ok: false; message?: string; errors?: Record<string, string> };

/**
 * Records a payment toward the order: a new bank transaction (money out to Inventory, like any
 * supplier payment) or one already in the books, linked with the part of it for this order.
 */
export async function recordPurchasePaymentAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<RecordPaymentResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(id)) return gone;
  const parsed = purchasePaymentSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  const value = parsed.data;
  const po = await inOrg(ctx, (tx) => getPurchaseOrder(tx, id));
  if (!po) return gone;
  if (value.receiptId && !value.contactId) {
    return {
      ok: false,
      errors: { contactId: "Choose who you paid: the shipping company, broker…" },
    };
  }
  const contactId = value.contactId || po.supplierId;
  if (contactId !== po.supplierId) {
    const contact = await inOrg(ctx, (tx) => getContact(tx, contactId));
    if (!contact) return { ok: false, errors: { contactId: "This vendor no longer exists." } };
  }
  const number = purchaseOrderNumber(po.number);

  let entryId = value.journalEntryId;
  if (value.mode === "new") {
    // An order in the books holds payments on Supplier deposits; before that, on Inventory.
    const category = await inOrg(ctx, async (tx) =>
      ensureSystemAccount(
        tx,
        ctx.org.id,
        orderInBooks(po.orderDate, await getPurchaseSettings(tx))
          ? "supplier_deposits"
          : "inventory",
      ),
    );
    const saved = await saveTransactionAction(slug, {
      kind: "withdrawal",
      date: value.date,
      memo: [
        number,
        value.label || (contactId === po.supplierId ? "Payment" : "Shipping and costs"),
      ]
        .join(" · ")
        .slice(0, 200),
      contactId,
      moneyAccountId: value.moneyAccountId,
      fxRate: value.fxRate,
      splits: [{ accountId: category, amount: value.bankAmount, description: "", taxRateId: "" }],
    });
    if (!saved.ok) {
      const errors: Record<string, string> = {};
      for (const [key, message] of Object.entries(saved.errors ?? {})) {
        errors[key.startsWith("splits") ? "bankAmount" : key] ??= message;
      }
      return { ok: false, message: saved.message ?? "Check the highlighted fields.", errors };
    }
    entryId = saved.data.id;
  }
  if (!entryId) return { ok: false, errors: { journalEntryId: "Choose the transaction." } };
  const journalEntryId = entryId;
  // A payment for a delivery's extra costs goes on its landed cost too.
  const forCost = Boolean(value.receiptId) && contactId !== po.supplierId;
  try {
    const payment = await inOrg(ctx, async (tx) => {
      const payment = await addPurchasePayment(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        purchaseOrderId: id,
        journalEntryId,
        contactId,
        receiptId: value.receiptId || null,
        label: value.label,
        amount: value.amount,
        currency: value.currency,
        baseCurrency: ctx.profile.baseCurrency,
        cost: forCost
          ? { costId: value.costId, kind: value.costKind, description: value.label }
          : null,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "purchase_order.payment_added",
        entityType: "purchase_order",
        entityId: id,
        after: {
          paymentId: payment.id,
          journalEntryId,
          contactId,
          amount: value.amount,
          created: value.mode === "new",
          costId: payment.cost?.ok ? payment.cost.costId : null,
        },
      });
      return payment;
    });
    revalidatePath(base(slug), "layout");
    revalidatePath(`/o/${slug}/accounting`, "layout");
    return {
      ok: true,
      message: value.mode === "new" ? "Payment recorded" : "Payment linked to the order",
      note: payment.cost
        ? payment.cost.ok
          ? payment.cost.added
            ? "Added to the delivery's landed cost."
            : "The delivery's landed cost now uses what you paid."
          : payment.cost.problem
        : undefined,
    };
  } catch (error) {
    const failed = friendly(error);
    return { ok: false, message: failed.message };
  }
}

/** Puts a payment already on the order (freight, duty…) on its delivery's landed cost. */
export async function linkPaymentCostAction(
  slug: string,
  id: string,
  paymentId: string,
  input: unknown,
): Promise<PurchaseOrderActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(id) || !validId(paymentId)) return gone;
  const parsed = paymentCostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose the cost it paid." };
  try {
    const result = await inOrg(ctx, async (tx) => {
      const linked = await linkPaymentCost(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        baseCurrency: ctx.profile.baseCurrency,
        paymentId,
        purchaseOrderId: id,
        costId: parsed.data.costId,
        kind: parsed.data.costKind,
        description: null,
      });
      if (linked.ok) {
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "purchase_order.payment_cost_linked",
          entityType: "purchase_order",
          entityId: id,
          after: { paymentId, costId: linked.costId, added: linked.added },
        });
      }
      return linked;
    });
    if (!result.ok) return { ok: false, message: result.problem };
    revalidatePath(base(slug), "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

/** Takes a payment off the order. Its bank transaction stays in the books. */
export async function removePurchasePaymentAction(
  slug: string,
  id: string,
  paymentId: string,
): Promise<PurchaseOrderActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(id) || !validId(paymentId)) return gone;
  try {
    await inOrg(ctx, async (tx) => {
      await removePurchasePayment(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        purchaseOrderId: id,
        paymentId,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "purchase_order.payment_removed",
        entityType: "purchase_order",
        entityId: id,
        after: { paymentId },
      });
    });
    revalidatePath(base(slug), "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

/**
 * Puts purchase orders in the books from a date: their payments wait on Supplier deposits and
 * each delivery moves its landed cost into Inventory. Admins only.
 */
export async function savePurchaseSettingsAction(
  slug: string,
  postFrom: string,
): Promise<{ ok: true; message: string; problems: string[] } | Fail> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only an admin can change this." };
  if (!isIsoDate(postFrom)) {
    return { ok: false, message: "Choose a date.", errors: { postFrom: "Choose a date." } };
  }
  const locked = ctx.profile.booksLockedThrough;
  if (locked && postFrom <= locked) {
    return {
      ok: false,
      message: "Your books are closed for that date.",
      errors: { postFrom: "Choose a day after the books' closing date." },
    };
  }
  try {
    const result = await inOrg(ctx, async (tx) => {
      const synced = await savePurchaseSettings(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        baseCurrency: ctx.profile.baseCurrency,
        postFrom,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "purchase_settings.saved",
        entityType: "organization",
        entityId: ctx.org.id,
        after: { postFrom, orders: synced.orders, problems: synced.problems.length },
      });
      return synced;
    });
    revalidatePath(`/o/${slug}/inventory`, "layout");
    revalidatePath(`/o/${slug}/accounting`, "layout");
    return {
      ok: true,
      message:
        result.orders === 0
          ? "Purchase orders are in the books from that date."
          : `Purchase orders are in the books from that date (${result.orders} brought in).`,
      problems: result.problems,
    };
  } catch (error) {
    return friendly(error);
  }
}

/** Settles what's left on Supplier deposits for a fully received order. */
export async function settleOrderAction(
  slug: string,
  id: string,
): Promise<PurchaseOrderActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(id)) return gone;
  const date = openDate(nowIn(ctx.profile.timezone).date, ctx.profile.booksLockedThrough);
  try {
    await inOrg(ctx, async (tx) => {
      const entryId = await settleOrder(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        baseCurrency: ctx.profile.baseCurrency,
        purchaseOrderId: id,
        date,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "purchase_order.settled",
        entityType: "purchase_order",
        entityId: id,
        after: { entryId, date },
      });
    });
    revalidatePath(base(slug), "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

export async function undoSettlementAction(
  slug: string,
  id: string,
): Promise<PurchaseOrderActionResult> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!validId(id)) return gone;
  try {
    await inOrg(ctx, async (tx) => {
      await undoSettlement(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        purchaseOrderId: id,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "purchase_order.settlement_undone",
        entityType: "purchase_order",
        entityId: id,
      });
    });
    revalidatePath(base(slug), "layout");
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

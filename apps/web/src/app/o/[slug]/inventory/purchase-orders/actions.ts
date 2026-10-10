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
  listTransactions,
  markPurchaseOrderOrdered,
  PurchasingError,
  receivePurchaseOrder,
  removePurchasePayment,
  saveDeliveryCosts,
  savePaymentPlan,
  updatePurchaseOrder,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  deliveryCostsSchema,
  paymentPlanSchema,
  purchaseOrderSchema,
  purchasePaymentSchema,
  receiveSchema,
} from "@/lib/validation/purchasing";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";
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
  | { ok: true; message: string }
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
  const contactId = value.contactId || po.supplierId;
  if (contactId !== po.supplierId) {
    const contact = await inOrg(ctx, (tx) => getContact(tx, contactId));
    if (!contact) return { ok: false, errors: { contactId: "This vendor no longer exists." } };
  }
  const number = purchaseOrderNumber(po.number);

  let entryId = value.journalEntryId;
  if (value.mode === "new") {
    const inventory = await inOrg(ctx, (tx) => ensureSystemAccount(tx, ctx.org.id, "inventory"));
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
      splits: [{ accountId: inventory, amount: value.bankAmount, description: "", taxRateId: "" }],
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
  try {
    await inOrg(ctx, async (tx) => {
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
        },
      });
    });
  } catch (error) {
    const failed = friendly(error);
    return { ok: false, message: failed.message };
  }
  revalidatePath(base(slug), "layout");
  revalidatePath(`/o/${slug}/accounting`, "layout");
  return {
    ok: true,
    message: value.mode === "new" ? "Payment recorded" : "Payment linked to the order",
  };
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
      await removePurchasePayment(tx, { purchaseOrderId: id, paymentId });
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

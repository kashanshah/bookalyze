"use server";

import { purchaseOrderNumber } from "@bookalyze/core";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrder,
  markPurchaseOrderOrdered,
  PurchasingError,
  receivePurchaseOrder,
  saveDeliveryCosts,
  updatePurchaseOrder,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  deliveryCostsSchema,
  purchaseOrderSchema,
  receiveSchema,
} from "@/lib/validation/purchasing";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";

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

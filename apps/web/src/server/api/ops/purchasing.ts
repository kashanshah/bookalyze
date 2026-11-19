import "server-only";
import { getPurchaseOrder, listPurchaseOrders, listPurchasePayments } from "@bookalyze/db";
import { z } from "zod";
import { recordPurchasePaymentAction } from "@/app/o/[slug]/inventory/purchase-orders/actions";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { defineOperation, notFoundError, unwrap } from "../core";
import { amount, company, id, isoDate } from "./shared";

const FEATURE = "inventory.purchasing";

export const purchasingOperations = [
  defineOperation({
    name: "list_purchase_orders",
    title: "List purchase orders",
    description:
      "Purchase orders to suppliers, newest first (up to 200): number, supplier, status (draft, ordered, partial, received, cancelled), currency, total, units ordered and received. `status: open` lists draft, ordered and partly received ones; `search` matches the supplier, its reference or PO-12.",
    access: "read",
    http: "GET /companies/{company}/purchase-orders",
    input: z.object({
      company,
      status: z.enum(["open", "draft", "ordered", "partial", "received", "cancelled"]).optional(),
      search: z.string().max(100).optional(),
    }),
    run: async ({ input }) => {
      const ctx = await getInventoryContext(input.company, FEATURE);
      return inOrg(ctx, (tx) =>
        listPurchaseOrders(tx, { status: input.status, search: input.search }),
      );
    },
  }),

  defineOperation({
    name: "get_purchase_order",
    title: "Get a purchase order",
    description:
      "One purchase order with its lines, deliveries, payment plan and every payment toward it (to the supplier and to others such as freight), each with the bank transaction that paid it.",
    access: "read",
    http: "GET /companies/{company}/purchase-orders/{purchaseOrderId}",
    input: z.object({ company, purchaseOrderId: id("purchase order") }),
    run: async ({ input }) => {
      const ctx = await getInventoryContext(input.company, FEATURE);
      const result = await inOrg(ctx, async (tx) => {
        const po = await getPurchaseOrder(tx, input.purchaseOrderId);
        if (!po) return null;
        return { ...po, payments: await listPurchasePayments(tx, po.id) };
      });
      if (!result) throw notFoundError("purchase order");
      return result;
    },
  }),

  defineOperation({
    name: "record_purchase_payment",
    title: "Record a payment toward a purchase order",
    description: [
      "Records a payment toward a purchase order, as the order's Payments section does.",
      "mode `new`: a new bank transaction (money out of `moneyAccountId` on `date`, `bankAmount` in the bank account's currency; `fxRate` when it isn't the main currency), categorised to Supplier deposits or Inventory as the company's purchase settings say.",
      "mode `existing`: link a transaction already in the books (`journalEntryId`, e.g. from list_transactions).",
      "`amount` is how much of it was for this order, in the order's currency. For a delivery's freight, duty or brokerage paid to someone else, give `receiptId` (the delivery), `contactId` (who was paid) and `costKind`.",
    ].join(" "),
    access: "write",
    module: "inventory",
    http: "POST /companies/{company}/purchase-orders/{purchaseOrderId}/payments",
    input: z.object({
      company,
      purchaseOrderId: id("purchase order"),
      mode: z.enum(["new", "existing"]),
      amount: amount("How much was for this order, in the order's currency."),
      currency: z.string().length(3).optional(),
      label: z.string().max(60).optional().describe("e.g. Deposit, Balance."),
      journalEntryId: z.uuid().optional(),
      date: isoDate("mode new: the day it was paid.").optional(),
      moneyAccountId: z.uuid().optional(),
      bankAmount: amount("mode new: what left the bank account, in its currency.").optional(),
      fxRate: z.string().max(30).optional(),
      contactId: z.uuid().optional().describe("Who was paid, when not the supplier."),
      receiptId: z.uuid().optional().describe("The delivery an extra cost belongs to."),
      costId: z.uuid().optional(),
      costKind: z.enum(["freight", "duty", "brokerage", "prep", "other"]).optional(),
    }),
    run: async ({ input: { company: slug, purchaseOrderId, ...value } }) =>
      unwrap(await recordPurchasePaymentAction(slug, purchaseOrderId, value)),
  }),
];

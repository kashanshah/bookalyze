import { prepareJournalEntry, transactionLines } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createProduct } from "../inventory";
import { createDefaultChart, postJournalEntry } from "../ledger";
import {
  addPurchasePayment,
  listPurchasePayments,
  ordersPaidBy,
  paidByOrder,
  removePurchasePayment,
  savePaymentPlan,
} from "../purchase-payments";
import { cancelPurchaseOrder, createPurchaseOrder, getPurchaseOrder } from "../purchasing";
import * as schema from "../schema";
import { replaceJournalEntry, voidJournalEntry } from "../transactions";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let orgId: string;
let otherOrgId: string;
let supplierId: string;
let shipperId: string;
let productId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

/** Money out of the bank (1000) to Inventory (1200), as a bank transaction. */
async function payment(amount: string, memo = "Supplier payment") {
  return scoped(async (tx) => {
    const all = await tx.select().from(schema.accounts);
    const code = new Map(all.map((a) => [a.code, a.id]));
    const prepared = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: transactionLines({
          kind: "withdrawal",
          moneyAccountId: code.get("1000") as string,
          splits: [{ accountId: code.get("1200") as string, amount }],
        }),
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!prepared.ok) throw new Error("bad entry");
    return postJournalEntry(tx, {
      orgId,
      date: "2026-09-02",
      memo,
      entry: prepared.entry,
    });
  });
}

async function order() {
  return scoped((tx) =>
    createPurchaseOrder(tx, {
      orgId,
      userId: null,
      supplierId,
      currency: "CAD",
      orderDate: "2026-09-01",
      expectedDate: null,
      reference: null,
      notes: null,
      lines: [{ productId, quantity: 2000, unitCost: "2.5000" }],
    }),
  );
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([
      { code: "CAD", name: "Canadian Dollar", minorUnits: 2 },
      { code: "USD", name: "US Dollar", minorUnits: 2 },
    ])
    .onConflictDoNothing();
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "PO Payments Org", slug: "po-payments-org", createdAt: new Date() },
      { name: "Other PO Payments Org", slug: "other-po-payments-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    await createDefaultChart(tx, { orgId, baseCurrency: "CAD" });
    const people = await tx
      .insert(schema.contacts)
      .values([
        { organizationId: orgId, type: "vendor", name: "Ningbo Ceramics" },
        { organizationId: orgId, type: "vendor", name: "Harbour Freight Forwarding" },
      ])
      .returning({ id: schema.contacts.id });
    supplierId = people[0]?.id ?? "";
    shipperId = people[1]?.id ?? "";
    productId = (
      await createProduct(tx, { orgId, userId: null, name: "Mug", sku: "MUG", notes: null })
    ).id;
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("purchase order payments", () => {
  it("keeps a plan and payments to the supplier and to a shipper", async () => {
    const po = await order();
    await scoped((tx) =>
      savePaymentPlan(tx, {
        purchaseOrderId: po.id,
        plan: [
          { label: "Upfront", kind: "percent", value: "35" },
          { label: "Rest", kind: "amount", value: "3250" },
        ],
      }),
    );
    expect((await scoped((tx) => getPurchaseOrder(tx, po.id)))?.paymentPlan).toHaveLength(2);

    const upfront = await payment("1750.00", "Deposit");
    await scoped((tx) =>
      addPurchasePayment(tx, {
        orgId,
        userId: null,
        purchaseOrderId: po.id,
        journalEntryId: upfront.id,
        label: "Upfront",
        amount: "1750.00",
      }),
    );
    // The same transaction can't be linked twice.
    await expect(
      scoped((tx) =>
        addPurchasePayment(tx, {
          orgId,
          userId: null,
          purchaseOrderId: po.id,
          journalEntryId: upfront.id,
          label: null,
          amount: "1.00",
        }),
      ),
    ).rejects.toThrow(/already a payment/);

    const freight = await payment("300.00", "Freight");
    await scoped((tx) =>
      addPurchasePayment(tx, {
        orgId,
        userId: null,
        purchaseOrderId: po.id,
        journalEntryId: freight.id,
        contactId: shipperId,
        receiptId: null,
        label: "Sea freight",
        amount: "300.00",
      }),
    );

    const rows = await scoped((tx) => listPurchasePayments(tx, po.id));
    expect(rows.map((r) => [r.contactName, r.label, r.amount, r.removed])).toEqual([
      ["Ningbo Ceramics", "Upfront", "1750.0000", false],
      ["Harbour Freight Forwarding", "Sea freight", "300.0000", false],
    ]);
    expect(rows[0]?.bank).toMatchObject({ amount: "1750.0000", currency: "CAD" });
    // Paid to the supplier counts toward the order; the shipper's payment doesn't.
    expect((await scoped((tx) => paidByOrder(tx))).get(po.id)).toBe("1750.0000");
    expect((await scoped((tx) => ordersPaidBy(tx, [upfront.id]))).get(upfront.id)).toEqual([
      { purchaseOrderId: po.id, number: expect.any(Number) },
    ]);

    // A corrected transaction carries its payment over; a removed one stops counting.
    const all = await scoped((tx) => tx.select().from(schema.accounts));
    const code = new Map(all.map((a) => [a.code, a.id]));
    const corrected = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: transactionLines({
          kind: "withdrawal",
          moneyAccountId: code.get("1000") as string,
          splits: [{ accountId: code.get("1200") as string, amount: "1750.00" }],
        }),
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!corrected.ok) throw new Error("bad entry");
    const replaced = await scoped((tx) =>
      replaceJournalEntry(tx, {
        orgId,
        entryId: upfront.id,
        date: "2026-09-03",
        memo: "Deposit 35%",
        entry: corrected.entry,
      }),
    );
    const after = await scoped((tx) => listPurchasePayments(tx, po.id));
    const deposit = () => after.find((r) => r.label === "Upfront");
    expect(deposit()).toMatchObject({ journalEntryId: replaced.id, date: "2026-09-03" });
    await scoped((tx) => voidJournalEntry(tx, { orgId, entryId: replaced.id }));
    expect(
      (await scoped((tx) => listPurchasePayments(tx, po.id))).find((r) => r.label === "Upfront")
        ?.removed,
    ).toBe(true);
    expect((await scoped((tx) => paidByOrder(tx))).get(po.id)).toBeUndefined();
    // Nor can a removed transaction be linked again.
    await expect(
      scoped((tx) =>
        addPurchasePayment(tx, {
          orgId,
          userId: null,
          purchaseOrderId: po.id,
          journalEntryId: replaced.id,
          label: null,
          amount: "1.00",
        }),
      ),
    ).rejects.toThrow(/no longer in the books/);

    // Unlinking leaves the transaction in the books.
    const [first] = after;
    await scoped((tx) =>
      removePurchasePayment(tx, { purchaseOrderId: po.id, paymentId: first?.id ?? "" }),
    );
    expect(await scoped((tx) => listPurchasePayments(tx, po.id))).toHaveLength(1);
  });

  it("takes no payments on a cancelled order", async () => {
    const po = await order();
    await scoped((tx) => cancelPurchaseOrder(tx, po.id));
    const paid = await payment("10.00");
    await expect(
      scoped((tx) =>
        addPurchasePayment(tx, {
          orgId,
          userId: null,
          purchaseOrderId: po.id,
          journalEntryId: paid.id,
          label: null,
          amount: "10.00",
        }),
      ),
    ).rejects.toThrow(/cancelled/);
  });

  it("keeps each company's payments to itself", async () => {
    const po = await order();
    const paid = await payment("5.00");
    await scoped((tx) =>
      addPurchasePayment(tx, {
        orgId,
        userId: null,
        purchaseOrderId: po.id,
        journalEntryId: paid.id,
        label: null,
        amount: "5.00",
      }),
    );
    expect(await scoped((tx) => listPurchasePayments(tx, po.id), otherOrgId)).toEqual([]);
    expect((await scoped((tx) => paidByOrder(tx), otherOrgId)).size).toBe(0);
  });
});

import { parseDecimal, prepareJournalEntry, transactionLines } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { createProduct } from "../inventory";
import { getDeliveryCosting, saveDeliveryCosts } from "../landed-costs";
import { createDefaultChart, postJournalEntry } from "../ledger";
import {
  orderDeposits,
  savePurchaseSettings,
  settleOrder,
  undoSettlement,
} from "../purchase-books";
import { addPurchasePayment, removePurchasePayment } from "../purchase-payments";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
} from "../purchasing";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let orgId: string;
let supplierId: string;
let shipperId: string;
let productId: string;
const cad = (amount: string) => parseDecimal(amount);
const ctx = () => ({ orgId, userId: null, baseCurrency: "CAD" });
const scoped = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId }, fn);

/** Money out of the bank (CAD) to `code`, as a bank transaction. */
async function paid(amount: string, date: string, code = "1200") {
  return scoped(async (tx) => {
    const all = await tx.select().from(schema.accounts);
    const byCode = new Map(all.map((a) => [a.code, a.id]));
    const prepared = prepareJournalEntry(
      {
        currency: "CAD",
        baseCurrency: "CAD",
        lines: transactionLines({
          kind: "withdrawal",
          moneyAccountId: byCode.get("1000") as string,
          splits: [{ accountId: byCode.get(code) as string, amount }],
        }),
      },
      new Map(all.map((a) => [a.id, a])),
    );
    if (!prepared.ok) throw new Error("bad entry");
    return postJournalEntry(tx, { orgId, date, memo: "Payment", entry: prepared.entry });
  });
}

/** Balance of an account by code or system key, in CAD units (exact). */
async function balance(key: string): Promise<bigint> {
  return scoped(async (tx) => {
    const [account] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        key.match(/^\d+$/) ? eq(schema.accounts.code, key) : eq(schema.accounts.systemKey, key),
      );
    const lines = await tx
      .select({ amount: schema.journalLines.baseAmount })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.accountId, account?.id ?? ""));
    return lines.reduce((sum, l) => sum + parseDecimal(l.amount), 0n);
  });
}

async function sentOrder(orderDate: string) {
  return scoped(async (tx) => {
    const po = await createPurchaseOrder(tx, {
      orgId,
      userId: null,
      supplierId,
      currency: "USD",
      orderDate,
      expectedDate: null,
      reference: null,
      notes: null,
      lines: [{ productId, quantity: 1000, unitCost: "2.0000" }],
    });
    await markPurchaseOrderOrdered(tx, po.id);
    return po;
  });
}

const link = (input: {
  purchaseOrderId: string;
  journalEntryId: string;
  amount: string;
  contactId?: string;
  currency?: string;
}) => scoped((tx) => addPurchasePayment(tx, { orgId, userId: null, label: null, ...input }));

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values([
      { code: "CAD", name: "Canadian Dollar", minorUnits: 2 },
      { code: "USD", name: "US Dollar", minorUnits: 2 },
    ])
    .onConflictDoNothing();
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: "Purchases In Books", slug: "purchases-in-books", createdAt: new Date() })
    .returning({ id: schema.organization.id });
  orgId = org?.id ?? "";
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

describe("purchase orders in the books", () => {
  it("leaves orders alone until it's switched on, then only from the start date", async () => {
    const before = await sentOrder("2026-08-20");
    const payment = await paid("500.00", "2026-08-21");
    await link({ purchaseOrderId: before.id, journalEntryId: payment.id, amount: "370.00" });
    expect(await balance("supplier_deposits")).toBe(cad("0.00"));

    const result = await scoped((tx) =>
      savePurchaseSettings(tx, { ...ctx(), postFrom: "2026-09-01" }),
    );
    expect(result).toEqual({ orders: 0, problems: [] });
    // The August order stays as it was: its payment on Inventory, nothing posted.
    expect(await balance("supplier_deposits")).toBe(cad("0.00"));
    expect(await balance("inventory")).toBe(cad("500.00"));
  });

  it("holds payments on deposits, posts deliveries and settles the difference", async () => {
    const inventoryBefore = await balance("inventory");
    const po = await sentOrder("2026-09-05");

    // 1000 USD paid at 1.36, then 1000 USD at 1.41: CAD 2,770 on deposits.
    const first = await paid("1360.00", "2026-09-06");
    await link({ purchaseOrderId: po.id, journalEntryId: first.id, amount: "1000.00" });
    const second = await paid("1410.00", "2026-09-20");
    await link({ purchaseOrderId: po.id, journalEntryId: second.id, amount: "1000.00" });
    expect(await balance("supplier_deposits")).toBe(cad("2770.00"));
    expect(await balance("inventory")).toBe(inventoryBefore);

    // Everything arrives at 1.38: CAD 2,760 into stock.
    const { receiptId } = await scoped(async (tx) => {
      const detail = await getPurchaseOrder(tx, po.id);
      return receivePurchaseOrder(tx, {
        id: po.id,
        orgId,
        userId: null,
        baseCurrency: "CAD",
        receivedOn: "2026-10-01",
        exchangeRate: "1.38",
        notes: null,
        quantities: Object.fromEntries((detail?.lines ?? []).map((l) => [l.id, l.quantity])),
      });
    });
    expect(await balance("supplier_deposits")).toBe(cad("10.00"));
    expect((await balance("inventory")) - inventoryBefore).toBe(cad("2760"));

    // Freight paid to a shipper, added to the delivery: the delivery is re-posted at CAD 2,860.
    const freight = await paid("100.00", "2026-10-02");
    await link({
      purchaseOrderId: po.id,
      journalEntryId: freight.id,
      amount: "100.00",
      contactId: shipperId,
      currency: "CAD",
    });
    await scoped((tx) =>
      saveDeliveryCosts(tx, {
        orgId,
        userId: null,
        receiptId,
        baseCurrency: "CAD",
        exchangeRate: "1.38",
        costs: [
          {
            kind: "freight",
            description: null,
            amount: "100.00",
            currency: "CAD",
            exchangeRate: null,
            allocation: "units",
            contactId: shipperId,
          },
        ],
      }),
    );
    expect((await balance("inventory")) - inventoryBefore).toBe(cad("2860"));
    const deposits = await scoped((tx) => orderDeposits(tx, { orgId, purchaseOrderId: po.id }));
    expect(deposits).toMatchObject({
      paidIn: "2870.0000",
      intoStock: "2860.0000",
      left: "10.0000",
      settlementEntryId: null,
    });

    // Settled: the CAD 10 paid over the stock's value is an exchange loss.
    await scoped((tx) => settleOrder(tx, { ...ctx(), purchaseOrderId: po.id, date: "2026-10-03" }));
    expect(await balance("fx_loss")).toBe(cad("10.00"));
    expect(await balance("supplier_deposits")).toBe(cad("0.00"));
    await expect(
      scoped((tx) => settleOrder(tx, { ...ctx(), purchaseOrderId: po.id, date: "2026-10-03" })),
    ).rejects.toThrow(/already settled/);
    await scoped((tx) => undoSettlement(tx, { orgId, userId: null, purchaseOrderId: po.id }));
    expect(await balance("fx_loss")).toBe(cad("0.00"));
    expect(await balance("supplier_deposits")).toBe(cad("10.00"));
  });

  it("puts a payment taken off an order back on Inventory", async () => {
    const po = await sentOrder("2026-09-10");
    const payment = await paid("200.00", "2026-09-11");
    await link({ purchaseOrderId: po.id, journalEntryId: payment.id, amount: "150.00" });
    const depositsBefore = await balance("supplier_deposits");
    const inventoryBefore = await balance("inventory");
    const [row] = await scoped((tx) =>
      tx
        .select({ id: schema.purchasePayments.id })
        .from(schema.purchasePayments)
        .where(eq(schema.purchasePayments.purchaseOrderId, po.id)),
    );
    await scoped((tx) =>
      removePurchasePayment(tx, {
        orgId,
        userId: null,
        purchaseOrderId: po.id,
        paymentId: row?.id ?? "",
      }),
    );
    expect(await balance("supplier_deposits")).toBe(depositsBefore - cad("200"));
    expect(await balance("inventory")).toBe(inventoryBefore + cad("200"));
  });

  it("refuses a split transaction and settling before everything arrives", async () => {
    const po = await sentOrder("2026-09-12");
    const payment = await scoped(async (tx) => {
      const all = await tx.select().from(schema.accounts);
      const byCode = new Map(all.map((a) => [a.code, a.id]));
      const prepared = prepareJournalEntry(
        {
          currency: "CAD",
          baseCurrency: "CAD",
          lines: transactionLines({
            kind: "withdrawal",
            moneyAccountId: byCode.get("1000") as string,
            splits: [
              { accountId: byCode.get("1200") as string, amount: "50.00" },
              { accountId: byCode.get("6400") as string, amount: "10.00" },
            ],
          }),
        },
        new Map(all.map((a) => [a.id, a])),
      );
      if (!prepared.ok) throw new Error("bad entry");
      return postJournalEntry(tx, { orgId, date: "2026-09-13", entry: prepared.entry });
    });
    await expect(
      link({ purchaseOrderId: po.id, journalEntryId: payment.id, amount: "40.00" }),
    ).rejects.toThrow(/split across categories/);
    await expect(
      scoped((tx) => settleOrder(tx, { ...ctx(), purchaseOrderId: po.id, date: "2026-10-03" })),
    ).rejects.toThrow(/everything on the order has arrived/);
  });

  it("won't move the start later once deliveries before it are posted", async () => {
    await expect(
      scoped((tx) => savePurchaseSettings(tx, { ...ctx(), postFrom: "2026-11-01" })),
    ).rejects.toThrow(/can't move later/);
  });

  it("puts a freight payment on its delivery's landed cost, at the rate it was paid", async () => {
    const inventoryBefore = await balance("inventory");
    const po = await sentOrder("2026-09-10");
    const { receiptId } = await scoped(async (tx) => {
      const detail = await getPurchaseOrder(tx, po.id);
      return receivePurchaseOrder(tx, {
        id: po.id,
        orgId,
        userId: null,
        baseCurrency: "CAD",
        receivedOn: "2026-10-05",
        exchangeRate: "1.38",
        notes: null,
        quantities: Object.fromEntries((detail?.lines ?? []).map((l) => [l.id, l.quantity])),
      });
    });
    const stock = async () => (await balance("inventory")) - inventoryBefore;
    const costs = async () =>
      (await scoped((tx) => getDeliveryCosting(tx, receiptId)))?.costs ?? [];
    expect(await stock()).toBe(cad("2760"));

    // USD 100 of sea freight paid from the CAD account: CAD 140 left the bank, so 1.40.
    const freight = await paid("140.00", "2026-10-06");
    const linked = await scoped((tx) =>
      addPurchasePayment(tx, {
        orgId,
        userId: null,
        purchaseOrderId: po.id,
        journalEntryId: freight.id,
        contactId: shipperId,
        receiptId,
        label: "Sea",
        amount: "100.00",
        currency: "USD",
        baseCurrency: "CAD",
        cost: { costId: null, kind: "freight", description: "Sea" },
      }),
    );
    expect(linked.cost).toMatchObject({ ok: true, added: true });
    expect(await costs()).toEqual([
      expect.objectContaining({
        kind: "freight",
        description: "Sea",
        amount: "100.0000",
        currency: "USD",
        exchangeRate: "1.4000000000",
        contactId: shipperId,
        paymentId: linked.id,
        paidBy: expect.objectContaining({ date: "2026-10-06" }),
      }),
    ]);
    expect(await stock()).toBe(cad("2900"));

    // Duty entered by hand. Saving again keeps the freight as paid, whatever the form sends.
    const save = (list: Parameters<typeof saveDeliveryCosts>[1]["costs"]) =>
      scoped((tx) =>
        saveDeliveryCosts(tx, {
          orgId,
          userId: null,
          receiptId,
          baseCurrency: "CAD",
          exchangeRate: "1.38",
          costs: list,
        }),
      );
    const freightCost = {
      kind: "freight" as const,
      description: "Sea",
      amount: "999.00",
      currency: "CAD",
      exchangeRate: null,
      allocation: "value" as const,
      paymentId: linked.id,
    };
    const duty = {
      kind: "duty" as const,
      description: null,
      amount: "50.00",
      currency: "CAD",
      exchangeRate: null,
      allocation: "value" as const,
      contactId: shipperId,
    };
    await save([freightCost, duty]);
    expect(
      (await costs()).map((c) => [c.kind, c.amount, c.currency, Boolean(c.paymentId)]),
    ).toEqual([
      ["freight", "100.0000", "USD", true],
      ["duty", "50.0000", "CAD", false],
    ]);
    expect(await stock()).toBe(cad("2950"));

    // Paying the duty links it: the cost becomes what was paid.
    const dutyId = (await costs())[1]?.id ?? null;
    const dutyPaid = await paid("55.00", "2026-10-07");
    const second = await scoped((tx) =>
      addPurchasePayment(tx, {
        orgId,
        userId: null,
        purchaseOrderId: po.id,
        journalEntryId: dutyPaid.id,
        contactId: shipperId,
        receiptId,
        label: null,
        amount: "55.00",
        currency: "CAD",
        baseCurrency: "CAD",
        cost: { costId: dutyId, kind: "duty", description: null },
      }),
    );
    expect(second.cost).toEqual({ ok: true, costId: dutyId, added: false });
    expect((await costs())[1]).toMatchObject({ amount: "55.0000", paymentId: second.id });
    expect(await stock()).toBe(cad("2955"));

    // A paid cost can't be dropped from the form; taking its payment off keeps it, unlinked.
    await expect(save([duty])).rejects.toThrow(/Sea was paid by a payment on the order/);
    await scoped((tx) =>
      removePurchasePayment(tx, {
        orgId,
        userId: null,
        purchaseOrderId: po.id,
        paymentId: linked.id,
      }),
    );
    expect((await costs())[0]).toMatchObject({ amount: "100.0000", paymentId: null, paidBy: null });
    // The bank transaction goes back on Inventory, as for any payment taken off.
    expect(await stock()).toBe(cad("3095"));
  });
});

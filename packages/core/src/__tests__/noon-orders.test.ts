import { describe, expect, it } from "vitest";
import { type NoonOrderRow, noonOrders } from "../commerce/noon-orders";

const row = (over: Partial<NoonOrderRow>): NoonOrderRow => ({
  orderNr: "NAE001",
  itemNr: "I1",
  orderDate: "2026-09-01",
  transactionDate: "2026-09-02",
  transactionType: "order",
  sku: "Z1",
  partnerSku: "MUG-1",
  title: "Maple mug",
  currency: "AED",
  netProceeds: "100.0000",
  ...over,
});

describe("noonOrders", () => {
  it("makes an order per order number, an item per item number, with returns as refunds", () => {
    const orders = noonOrders([
      row({}),
      row({ itemNr: "I2", partnerSku: null, sku: "Z2", title: "Spoon", netProceeds: "20" }),
      row({ transactionType: "Order Update", netProceeds: "-100", transactionDate: "2026-09-20" }),
      row({ orderNr: "NAE002", orderDate: null, transactionDate: "2026-08-30" }),
      // Fees only: nothing to show without the sale.
      row({ orderNr: "NAE003", transactionType: "order_update", netProceeds: "0" }),
      // Not an order at all.
      row({ orderNr: null, transactionType: "statement_fee" }),
    ]);
    expect(orders).toEqual([
      {
        orderNr: "NAE002",
        currency: "AED",
        purchasedOn: "2026-08-30",
        total: "100.0000",
        refunded: null,
        items: [{ itemNr: "I1", sku: "MUG-1", title: "Maple mug", price: "100.0000" }],
      },
      {
        orderNr: "NAE001",
        currency: "AED",
        purchasedOn: "2026-09-01",
        total: "120.0000",
        refunded: "100.0000",
        items: [
          { itemNr: "I1", sku: "MUG-1", title: "Maple mug", price: "100.0000" },
          { itemNr: "I2", sku: "Z2", title: "Spoon", price: "20.0000" },
        ],
      },
    ]);
  });
});

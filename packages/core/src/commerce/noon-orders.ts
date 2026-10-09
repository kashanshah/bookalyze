import { formatDecimal, parseDecimal } from "../money";
import { noonTypeKey } from "./noon-posting";

/**
 * Noon orders from its transaction view (phase 4c, slice 6). Noon's order APIs cover only orders
 * the seller ships (FBP), but every order Noon charges, FBN or FBP, has an "Order" row per item
 * (its order and item numbers, order date, the seller's SKU and the item's net proceeds), and a
 * return or change shows as an "Order Update" row. So orders are built from the rows: one item
 * number is one unit (Noon numbers each unit of an order line on its own).
 */

/** The parts of a transaction row an order is built from. */
export type NoonOrderRow = {
  orderNr: string | null;
  itemNr: string | null;
  orderDate: string | null;
  transactionDate: string;
  transactionType: string;
  /** Noon's own SKU (Z…) and the seller's (`partnerSku`), which products are linked by. */
  sku: string | null;
  partnerSku: string | null;
  title: string | null;
  currency: string;
  netProceeds: string;
};

export type NoonOrderItem = {
  /** Noon's item number (one unit). */
  itemNr: string;
  sku: string | null;
  title: string | null;
  /** What the buyer paid for it (net proceeds), VAT included. */
  price: string;
};

export type NoonOrder = {
  orderNr: string;
  currency: string;
  /** YYYY-MM-DD: Noon's order date (or the first row's day when Noon leaves it out). */
  purchasedOn: string;
  total: string;
  /** Given back on returns and changes (positive), or null. */
  refunded: string | null;
  items: NoonOrderItem[];
};

/**
 * Orders from rows. Only orders with an "Order" row (the sale) are made; an order whose sale is
 * older than the rows brought in has nothing to show. Items keep their first SKU and title;
 * an item charged twice adds up.
 */
export function noonOrders(rows: readonly NoonOrderRow[]): NoonOrder[] {
  const byOrder = new Map<string, NoonOrderRow[]>();
  for (const r of rows) {
    if (!r.orderNr) continue;
    const list = byOrder.get(r.orderNr) ?? [];
    list.push(r);
    byOrder.set(r.orderNr, list);
  }
  const result: NoonOrder[] = [];
  for (const [orderNr, list] of byOrder) {
    const sales = list.filter((r) => noonTypeKey(r.transactionType) === "order");
    if (!sales.length) continue;
    const items = new Map<string, { sku: string | null; title: string | null; units: bigint }>();
    sales.forEach((r, i) => {
      const itemNr = r.itemNr ?? `${orderNr}-${i + 1}`;
      const item = items.get(itemNr) ?? {
        sku: r.partnerSku ?? r.sku,
        title: r.title,
        units: 0n,
      };
      item.units += parseDecimal(r.netProceeds);
      items.set(itemNr, item);
    });
    const returned = list
      .filter((r) => noonTypeKey(r.transactionType) === "order_update")
      .reduce((t, r) => t + parseDecimal(r.netProceeds), 0n);
    const total = [...items.values()].reduce((t, i) => t + i.units, 0n);
    const days = list.map((r) => r.orderDate ?? r.transactionDate).sort();
    result.push({
      orderNr,
      currency: list[0]?.currency ?? "",
      purchasedOn: days[0] ?? "",
      total: formatDecimal(total),
      refunded: returned < 0n ? formatDecimal(-returned) : null,
      items: [...items.entries()].map(([itemNr, i]) => ({
        itemNr,
        sku: i.sku,
        title: i.title,
        price: formatDecimal(i.units),
      })),
    });
  }
  return result.sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn));
}

import { formatDecimal, parseDecimal } from "../money";
import type { AdMetricRow } from "./ads";
import { splitUnits } from "./sku-pnl";

/** An ad fee as kept: when, on which order (if any), and what it did to the balance (signed). */
export type EbayAdFee = { date: string; orderId: string | null; amount: string };
/** One line of an eBay order: its SKU, units and what it sold for. */
export type EbayAdOrderLine = { orderId: string; sku: string; quantity: number; sales: string };

/**
 * eBay's Promoted Listings spend per SKU per day (docs/ADS.md §9), from its ad fees in the
 * Finances rows: no new eBay access needed. A fee on an order (Promoted Listings General charges
 * when an ad led to the sale) is shared over the order's lines by what each sold for, and the
 * sale is the ad's: those lines' sales, units and one order. A fee given back takes it off. A
 * fee on no order Bookalyze has (Priority's click charges, or an order not brought in) is spend
 * tied to no product. Rows are dated by the order's first ad fee.
 */
export function ebayAdMetricRows(
  fees: readonly EbayAdFee[],
  lines: readonly EbayAdOrderLine[],
): AdMetricRow[] {
  const linesOf = new Map<string, EbayAdOrderLine[]>();
  for (const l of lines) linesOf.set(l.orderId, [...(linesOf.get(l.orderId) ?? []), l]);
  const base = {
    adType: "promoted_listings" as const,
    campaignId: "",
    campaignName: "Promoted Listings",
    impressions: 0,
    clicks: 0,
    attributionWindow: "30d",
  };
  const byOrder = new Map<string, { date: string; spend: bigint }>();
  const rows: AdMetricRow[] = [];
  for (const f of fees) {
    // The fee is money out (negative); a fee given back is money in.
    const spend = -parseDecimal(f.amount);
    if (f.orderId && linesOf.has(f.orderId)) {
      const o = byOrder.get(f.orderId);
      byOrder.set(f.orderId, {
        date: o && o.date < f.date ? o.date : f.date,
        spend: (o?.spend ?? 0n) + spend,
      });
      continue;
    }
    rows.push({
      ...base,
      date: f.date,
      sku: null,
      listingRef: null,
      spend: formatDecimal(spend),
      attributedSales: "0.0000",
      attributedOrders: 0,
      attributedUnits: 0,
    });
  }
  for (const [orderId, o] of byOrder) {
    const order = linesOf.get(orderId) ?? [];
    const shares = splitUnits(
      o.spend,
      order.map((l) => parseDecimal(l.sales)),
    );
    // A sale counts as the ad's only while its fee stands; a fee given back in full leaves nothing.
    if (o.spend === 0n) continue;
    const attributed = o.spend > 0n;
    order.forEach((l, i) => {
      rows.push({
        ...base,
        date: o.date,
        sku: l.sku,
        listingRef: null,
        spend: formatDecimal(shares[i] ?? 0n),
        attributedSales: attributed ? formatDecimal(parseDecimal(l.sales)) : "0.0000",
        attributedOrders: attributed ? 1 : 0,
        attributedUnits: attributed ? l.quantity : 0,
      });
    });
  }
  return rows;
}

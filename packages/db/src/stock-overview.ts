import { ORDER_STATUS_GROUPS } from "@bookalyze/core";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { CogsError, cogsStartMonth, earliestOpeningStock, listCogsPeriods } from "./cogs";
import { noonStockByProduct } from "./noon-stock";
import { products, stockCounts } from "./schema/inventory";

/**
 * Stock in one place (phase 5): per product, what the books say you own (units left in the
 * lots, less what sold in months cost of goods sold hasn't posted yet, plus what came back or
 * turned up in them), against what each place holds: Amazon's FBA inventory (sellable,
 * reserved, inbound, unsellable, being looked for), Noon's FBN summary, and your own latest
 * count at hand. Run inside `withOrg()`.
 */

const cancelled = sql.raw(ORDER_STATUS_GROUPS.cancelled.map((s) => `'${s}'`).join(", "));

export type StockOverviewRow = {
  productId: string;
  productName: string;
  productSku: string | null;
  /** Units left in stock lots (what posted months leave). */
  inLots: number;
  /** Shipped in months not posted yet, less returns and net adjustments in them. */
  notPosted: number;
  /** What the books say you own now: in lots less not posted. */
  expected: number;
  amazon: {
    sellable: number;
    reserved: number;
    inbound: number;
    unsellable: number;
    researching: number;
    total: number;
  } | null;
  noon: { sellable: number; other: number; total: number } | null;
  atHand: { quantity: number; countedOn: string; notes: string | null; id: string } | null;
  /** Expected less everything counted somewhere (+: the books say more than is anywhere). */
  difference: number;
};

export type StockOverview = {
  rows: StockOverviewRow[];
  /** When Amazon's FBA inventory was last brought in (null: never). */
  amazonAt: string | null;
  /** The day of Noon's latest FBN summary (null: none uploaded). */
  noonDay: string | null;
  /** The months not posted yet that "not posted" counts, oldest first. */
  monthsNotPosted: string[];
};

export async function stockOverview(
  tx: Transaction,
  options: { timezone: string },
): Promise<StockOverview> {
  const periods = await listCogsPeriods(tx);
  const start = cogsStartMonth({
    openingDay: await earliestOpeningStock(tx),
    postedMonths: periods.map((p) => p.month),
  });
  const posted = periods.length
    ? sql.join(
        periods.map((p) => sql`(${p.channelId}::uuid, ${p.month})`),
        sql`, `,
      )
    : null;
  const orderMonth = sql`to_char(o.purchased_at at time zone ${options.timezone}, 'YYYY-MM')`;
  const ledgerMonth = sql`to_char(e.event_date, 'YYYY-MM')`;
  const notPostedOrder = sql`${start ? sql`${orderMonth} >= ${start}` : sql`true`}
    and ${posted ? sql`(o.channel_id, ${orderMonth}) not in (${posted})` : sql`true`}`;
  const notPostedLedger = sql`${start ? sql`${ledgerMonth} >= ${start}` : sql`true`}
    and ${posted ? sql`(e.channel_id, ${ledgerMonth}) not in (${posted})` : sql`true`}`;

  const rows = await tx.execute<{
    product_id: string;
    product_name: string;
    product_sku: string | null;
    in_lots: number;
    shipped: number;
    moved: number;
    months: string[] | null;
    sellable: number | null;
    reserved: number | null;
    inbound: number | null;
    unsellable: number | null;
    researching: number | null;
  }>(sql`
    select p.id as product_id, p.name as product_name, p.sku as product_sku,
      coalesce((select sum(l.quantity - coalesce((select sum(c.quantity) from lot_consumptions c
        where c.lot_id = l.id), 0)) from inventory_lots l where l.product_id = p.id), 0)::int as in_lots,
      coalesce((select sum(oi.quantity_shipped * ps.units) from order_items oi
        join orders o on o.id = oi.order_id
        join product_skus ps on ps.channel_id = o.channel_id and ps.sku = oi.sku
        where ps.product_id = p.id and oi.quantity_shipped > 0 and o.status not in (${cancelled})
          and ${notPostedOrder}), 0)::int as shipped,
      coalesce((select sum(e.quantity * ps.units) from inventory_ledger_events e
        join product_skus ps on ps.channel_id = e.channel_id and ps.sku = e.sku
        where ps.product_id = p.id
          and ((e.event_type = 'CustomerReturns' and e.quantity > 0) or e.event_type = 'Adjustments')
          and ${notPostedLedger}), 0)::int as moved,
      (select array_agg(distinct ${orderMonth}) from order_items oi
        join orders o on o.id = oi.order_id
        join product_skus ps on ps.channel_id = o.channel_id and ps.sku = oi.sku
        where ps.product_id = p.id and oi.quantity_shipped > 0 and o.status not in (${cancelled})
          and ${notPostedOrder}) as months,
      (select sum(cs.fulfillable * ps.units) from product_skus ps
        join channel_skus cs on cs.channel_id = ps.channel_id and cs.sku = ps.sku
        where ps.product_id = p.id and cs.fulfillable is not null)::int as sellable,
      (select sum(coalesce(cs.reserved, 0) * ps.units) from product_skus ps
        join channel_skus cs on cs.channel_id = ps.channel_id and cs.sku = ps.sku
        where ps.product_id = p.id and cs.fulfillable is not null)::int as reserved,
      (select sum(coalesce(cs.inbound, 0) * ps.units) from product_skus ps
        join channel_skus cs on cs.channel_id = ps.channel_id and cs.sku = ps.sku
        where ps.product_id = p.id and cs.fulfillable is not null)::int as inbound,
      (select sum(coalesce(cs.unfulfillable, 0) * ps.units) from product_skus ps
        join channel_skus cs on cs.channel_id = ps.channel_id and cs.sku = ps.sku
        where ps.product_id = p.id and cs.fulfillable is not null)::int as unsellable,
      (select sum(coalesce(cs.researching, 0) * ps.units) from product_skus ps
        join channel_skus cs on cs.channel_id = ps.channel_id and cs.sku = ps.sku
        where ps.product_id = p.id and cs.fulfillable is not null)::int as researching
    from products p
    where not p.is_archived
      and (exists (select 1 from inventory_lots l where l.product_id = p.id)
        or exists (select 1 from product_skus ps join channel_skus cs
          on cs.channel_id = ps.channel_id and cs.sku = ps.sku where ps.product_id = p.id)
        or exists (select 1 from stock_counts sc where sc.product_id = p.id))
    order by p.name`);

  const noon = await noonStockByProduct(tx);
  const noonBy = new Map(noon.products.map((n) => [n.productId, n]));
  const counts = await tx
    .select({
      id: stockCounts.id,
      productId: stockCounts.productId,
      quantity: stockCounts.quantity,
      countedOn: stockCounts.countedOn,
      notes: stockCounts.notes,
    })
    .from(stockCounts)
    .orderBy(desc(stockCounts.countedOn), desc(stockCounts.createdAt));
  const latest = new Map<string, (typeof counts)[number]>();
  for (const c of counts) if (!latest.has(c.productId)) latest.set(c.productId, c);

  const [amazonAt] = await tx
    .execute<{ at: string | null }>(
      sql`select max(seen_at)::text as at from channel_skus where fulfillable is not null`,
    )
    .then((r) => r.rows);

  const months = new Set<string>();
  const result = rows.rows.map((r): StockOverviewRow => {
    for (const m of r.months ?? []) months.add(m);
    const inLots = Number(r.in_lots);
    const notPosted = Number(r.shipped) - Number(r.moved);
    const expected = inLots - notPosted;
    const amazon =
      r.sellable === null
        ? null
        : (() => {
            const parts = {
              sellable: Number(r.sellable),
              reserved: Number(r.reserved ?? 0),
              inbound: Number(r.inbound ?? 0),
              unsellable: Number(r.unsellable ?? 0),
              researching: Number(r.researching ?? 0),
            };
            return {
              ...parts,
              total:
                parts.sellable +
                parts.reserved +
                parts.inbound +
                parts.unsellable +
                parts.researching,
            };
          })();
    const n = noonBy.get(r.product_id);
    const noonRow = n
      ? { sellable: n.sellable, other: n.other, total: n.sellable + n.other }
      : null;
    const count = latest.get(r.product_id);
    const atHand = count
      ? { id: count.id, quantity: count.quantity, countedOn: count.countedOn, notes: count.notes }
      : null;
    const counted = (amazon?.total ?? 0) + (noonRow?.total ?? 0) + (atHand?.quantity ?? 0);
    return {
      productId: r.product_id,
      productName: r.product_name,
      productSku: r.product_sku,
      inLots,
      notPosted,
      expected,
      amazon,
      noon: noonRow,
      atHand,
      difference: expected - counted,
    };
  });
  return {
    rows: result,
    amazonAt: amazonAt?.at ?? null,
    noonDay: noon.date,
    monthsNotPosted: [...months].sort(),
  };
}

/** Records how many of a product you hold yourself, counted on a day. */
export async function addStockCount(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    productId: string;
    quantity: number;
    countedOn: string;
    notes: string | null;
  },
): Promise<{ id: string }> {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) throw new CogsError("This product no longer exists.", "not_found");
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new CogsError("Enter how many you have (0 or more).");
  }
  const [row] = await tx
    .insert(stockCounts)
    .values({
      organizationId: input.orgId,
      productId: input.productId,
      quantity: input.quantity,
      countedOn: input.countedOn,
      notes: input.notes,
      createdBy: input.userId,
    })
    .returning({ id: stockCounts.id });
  if (!row) throw new CogsError("The count couldn't be saved.");
  return row;
}

/** Removes a count (the one before it, if any, is at hand again). */
export async function removeStockCount(
  tx: Transaction,
  input: { productId: string; countId: string },
): Promise<void> {
  const gone = await tx
    .delete(stockCounts)
    .where(and(eq(stockCounts.id, input.countId), eq(stockCounts.productId, input.productId)))
    .returning({ id: stockCounts.id });
  if (!gone.length) throw new CogsError("This count was already removed.", "not_found");
}

import {
  addDaysIso,
  DEFAULT_REORDER_SETTINGS,
  ORDER_STATUS_GROUPS,
  REORDER_HISTORY_DAYS,
} from "@bookalyze/core";
import { eq, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { cogsStartMonth, earliestOpeningStock, listCogsPeriods } from "./cogs";
import { unitsOnOrder } from "./purchasing";
import { products, reorderSettings } from "./schema/inventory";

/**
 * The reorder planner's data (inventory forecast). Run inside `withOrg()`. The maths is core's
 * `planReorder`; this brings each product's daily sales, stock and what's on order.
 */

const cancelled = sql.raw(ORDER_STATUS_GROUPS.cancelled.map((s) => `'${s}'`).join(", "));

export type ReorderSettings = { leadTimeDays: number; coverDays: number; saved: boolean };

export async function getReorderSettings(tx: Transaction): Promise<ReorderSettings> {
  const [row] = await tx.select().from(reorderSettings).limit(1);
  return row
    ? { leadTimeDays: row.leadTimeDays, coverDays: row.coverDays, saved: true }
    : { ...DEFAULT_REORDER_SETTINGS, saved: false };
}

export async function saveReorderSettings(
  tx: Transaction,
  input: { orgId: string; userId: string | null; leadTimeDays: number; coverDays: number },
) {
  const values = {
    leadTimeDays: input.leadTimeDays,
    coverDays: input.coverDays,
    updatedBy: input.userId,
    updatedAt: new Date(),
  };
  await tx
    .insert(reorderSettings)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: reorderSettings.organizationId, set: values });
}

/** A product's own lead time, minimum order and case pack (null: the company's lead time). */
export async function saveProductReorder(
  tx: Transaction,
  input: {
    productId: string;
    leadTimeDays: number | null;
    minimumOrder: number | null;
    casePack: number | null;
  },
) {
  const [row] = await tx
    .update(products)
    .set({
      leadTimeDays: input.leadTimeDays,
      minimumOrder: input.minimumOrder,
      casePack: input.casePack,
    })
    .where(eq(products.id, input.productId))
    .returning({ id: products.id });
  return Boolean(row);
}

export type ReorderProduct = {
  productId: string;
  name: string;
  sku: string | null;
  leadTimeDays: number | null;
  minimumOrder: number | null;
  casePack: number | null;
  /** Units ordered each day (linked SKUs × units per listing), oldest first, ending yesterday. */
  dailyUnits: number[];
  /** Units left in stock lots, less those shipped in months cost of goods sold hasn't taken yet. */
  inStock: number;
  /** Units on purchase orders sent and not yet received. */
  onOrder: number;
};

/**
 * Every product that's selling, in stock or on order: the last 90 days of sales by day (in the
 * company's time zone, cancelled orders left out) and the stock it has to sell from.
 */
export async function reorderProducts(
  tx: Transaction,
  input: { timezone: string; today: string },
): Promise<ReorderProduct[]> {
  const from = addDaysIso(input.today, -REORDER_HISTORY_DAYS);
  const day = sql`(o.purchased_at at time zone ${input.timezone})::date`;
  const sold = await tx.execute<{ product_id: string; day: string; units: number }>(sql`
    select ps.product_id, ${day}::text as day, sum(oi.quantity_ordered * ps.units)::int as units
    from order_items oi
    join orders o on o.id = oi.order_id
    join product_skus ps on ps.channel_id = o.channel_id and ps.sku = oi.sku
    where o.status not in (${cancelled})
      and ${day} >= ${from}::date and ${day} < ${input.today}::date
    group by 1, 2`);

  // Lots are only taken by cost of goods sold month by month: units shipped since then (on
  // months not posted, from the start month) are still in the lots but already sold.
  const periods = await listCogsPeriods(tx);
  const start =
    cogsStartMonth({
      openingDay: await earliestOpeningStock(tx),
      postedMonths: periods.map((p) => p.month),
    }) ?? "0000-00";
  const month = sql`to_char(o.purchased_at at time zone ${input.timezone}, 'YYYY-MM')`;
  const stock = await tx.execute<{
    product_id: string;
    name: string;
    sku: string | null;
    lead_time_days: number | null;
    minimum_order: number | null;
    case_pack: number | null;
    in_lots: number;
    not_costed: number;
  }>(sql`
    select p.id as product_id, p.name, p.sku, p.lead_time_days, p.minimum_order, p.case_pack,
      coalesce((select sum(l.quantity - coalesce((select sum(c.quantity) from lot_consumptions c
        where c.lot_id = l.id), 0)) from inventory_lots l where l.product_id = p.id), 0)::int as in_lots,
      coalesce((select sum(oi.quantity_shipped * ps.units)
        from product_skus ps
        join orders o on o.channel_id = ps.channel_id
        join order_items oi on oi.order_id = o.id and oi.sku = ps.sku
        where ps.product_id = p.id and oi.quantity_shipped > 0 and o.status not in (${cancelled})
          and ${month} >= ${start}
          and not exists (select 1 from cogs_periods cp
            where cp.channel_id = o.channel_id and cp.month = ${month})), 0)::int as not_costed
    from products p
    where not p.is_archived
    order by lower(p.name)`);
  const onOrder = await unitsOnOrder(tx);

  const byProduct = new Map<string, Map<string, number>>();
  for (const r of sold.rows) {
    let days = byProduct.get(r.product_id);
    if (!days) {
      days = new Map();
      byProduct.set(r.product_id, days);
    }
    days.set(r.day, Number(r.units));
  }
  const dates = Array.from({ length: REORDER_HISTORY_DAYS }, (_, i) => addDaysIso(from, i));
  return stock.rows
    .map((r): ReorderProduct => {
      const days = byProduct.get(r.product_id);
      return {
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        leadTimeDays: r.lead_time_days === null ? null : Number(r.lead_time_days),
        minimumOrder: r.minimum_order === null ? null : Number(r.minimum_order),
        casePack: r.case_pack === null ? null : Number(r.case_pack),
        dailyUnits: dates.map((d) => days?.get(d) ?? 0),
        inStock: Math.max(0, Number(r.in_lots) - Number(r.not_costed)),
        onOrder: onOrder.get(r.product_id) ?? 0,
      };
    })
    .filter((p) => p.inStock > 0 || p.onOrder > 0 || p.dailyUnits.some((u) => u > 0));
}

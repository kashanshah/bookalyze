import {
  amazonSkuKind,
  ebaySkuRows,
  NOON_ADVERTISING_PATTERN,
  NOON_AMOUNT_FIELDS,
  type NoonAmountField,
  noonSkuRows,
  ORDER_STATUS_GROUPS,
  type SkuMoneyRow,
  type SkuOrderLine,
  walmartLayout,
  walmartSkuColumns,
  walmartSkuRow,
} from "@bookalyze/core";
import { sql } from "drizzle-orm";
import type { Transaction } from "./client";

/**
 * What each SKU's exact profit and loss reads (docs/ADS.md §6b, core `channelSkuPnl`): the order
 * lines bought in a period, and every marketplace amount on those orders or, for amounts on no
 * order of the company's, in the period by their own day. Amounts in each channel's currency.
 */

const cancelled = sql.raw(ORDER_STATUS_GROUPS.cancelled.map((s) => `'${s}'`).join(", "));
const advertising = NOON_ADVERTISING_PATTERN.replace(/[^a-z]/g, "");

type Range = { from: string; to: string; timezone: string };

/** The period's orders (not cancelled), as SQL, for joins: channel and the marketplace's number. */
const periodOrders = (r: Range) => sql`(
  select o.channel_id, o.external_id from orders o
  where o.status not in (${cancelled})
    and (o.purchased_at at time zone ${r.timezone})::date between ${r.from}::date and ${r.to}::date
)`;

/**
 * Order lines bought in the period, by channel: units, item price, promotion, the line's share
 * of what the order gave back (by item price), and units returned (the order's refunds of the SKU).
 */
export async function skuOrderLines(
  tx: Transaction,
  r: Range,
): Promise<(SkuOrderLine & { channelId: string; title: string | null })[]> {
  const rows = await tx.execute<{
    channel_id: string;
    order_ref: string;
    sku: string;
    title: string | null;
    date: string;
    units: number;
    gross: string;
    promotions: string;
    refunded: string;
    returned: number;
  }>(sql`
    with lines as (
      select o.id as order_id, o.channel_id, o.external_id as order_ref, oi.sku, oi.title,
        to_char(o.purchased_at at time zone ${r.timezone}, 'YYYY-MM-DD') as date,
        oi.quantity_ordered as units,
        coalesce(oi.item_price, 0) as gross,
        coalesce(oi.promotion_discount, 0) as promotions,
        coalesce(o.refunded, 0) as order_refunded,
        sum(coalesce(oi.item_price, 0)) over (partition by o.id) as order_gross,
        count(*) over (partition by o.id) as order_lines
      from order_items oi
      join orders o on o.id = oi.order_id
      where oi.sku is not null and o.status not in (${cancelled})
        and (o.purchased_at at time zone ${r.timezone})::date between ${r.from}::date and ${r.to}::date
    )
    select l.channel_id, l.order_ref, l.sku, l.title, l.date, l.units::int as units,
      l.gross::text as gross, l.promotions::text as promotions,
      round(case when l.order_gross > 0 then l.order_refunded * l.gross / l.order_gross
        else l.order_refunded / l.order_lines end, 4)::text as refunded,
      coalesce((select sum(rf.quantity) from order_refunds rf
        where rf.order_id = l.order_id and rf.sku = l.sku), 0)::int as returned
    from lines l`);
  return rows.rows.map((x) => ({
    channelId: x.channel_id,
    orderRef: x.order_ref,
    sku: x.sku,
    title: x.title,
    date: x.date,
    units: Number(x.units),
    gross: x.gross,
    promotions: x.promotions,
    refunded: x.refunded,
    returnedUnits: Math.min(Number(x.returned), Number(x.units)),
  }));
}

export type ChannelMoneyRow = SkuMoneyRow & { channelId: string };

/**
 * Amazon settlement amounts by order and SKU: on the period's orders, or on no order the company
 * has and dated in the period (their posted day, else their settlement's last day).
 */
export async function amazonSkuRows(tx: Transaction, r: Range): Promise<ChannelMoneyRow[]> {
  const rows = await tx.execute<{
    channel_id: string;
    order_ref: string | null;
    sku: string | null;
    date: string;
    transaction_type: string;
    amount_type: string;
    amount_description: string;
    amount: string;
    quantity: number;
  }>(sql`
    select s.channel_id, l.order_ref, l.sku,
      coalesce(l.posted_date, (s.end_at at time zone ${r.timezone})::date)::text as date,
      l.transaction_type, l.amount_type, l.amount_description, l.amount::text as amount, l.quantity
    from settlement_sku_lines l
    join settlements s on s.id = l.settlement_id
    left join ${periodOrders(r)} p on p.channel_id = s.channel_id and p.external_id = l.order_ref
    where s.channel_id is not null
      and (p.external_id is not null or (
        coalesce(l.posted_date, (s.end_at at time zone ${r.timezone})::date) between ${r.from}::date and ${r.to}::date
        and (l.order_ref is null or not exists (select 1 from orders o
          where o.channel_id = s.channel_id and o.external_id = l.order_ref))
      ))`);
  return rows.rows.map((x) => ({
    channelId: x.channel_id,
    orderRef: x.order_ref,
    sku: x.sku,
    date: x.date,
    kind: amazonSkuKind({
      transactionType: x.transaction_type,
      amountType: x.amount_type,
      amountDescription: x.amount_description,
    }),
    amount: x.amount,
    quantity: Number(x.quantity),
    orderElsewhere: false,
  }));
}

/** Noon's transaction rows, the same way (its SKU is the partner SKU, else Noon's). */
export async function noonSkuMoneyRows(tx: Transaction, r: Range): Promise<ChannelMoneyRow[]> {
  const columns = NOON_AMOUNT_FIELDS.map((f) =>
    sql.raw(`t.${f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}::text as "${f}"`),
  );
  const rows = await tx.execute<
    {
      channel_id: string;
      order_nr: string | null;
      sku: string | null;
      partner_sku: string | null;
      transaction_date: string;
      transaction_type: string;
      advertising: boolean;
      total: string;
    } & Record<NoonAmountField, string>
  >(sql`
    select t.channel_id, t.order_nr, t.sku, t.partner_sku, t.transaction_date::text,
      t.transaction_type, coalesce(t.title ~* ${advertising}, false) as advertising,
      t.total::text as total, ${sql.join(columns, sql`, `)}
    from noon_transactions t
    left join ${periodOrders(r)} p on p.channel_id = t.channel_id and p.external_id = t.order_nr
    where p.external_id is not null or (
      t.transaction_date between ${r.from}::date and ${r.to}::date
      and (t.order_nr is null or not exists (select 1 from orders o
        where o.channel_id = t.channel_id and o.external_id = t.order_nr))
    )`);
  return rows.rows.flatMap((x) =>
    noonSkuRows({
      orderNr: x.order_nr,
      sku: x.sku,
      partnerSku: x.partner_sku,
      transactionDate: x.transaction_date,
      transactionType: x.transaction_type,
      advertising: Boolean(x.advertising),
      amounts: Object.fromEntries(NOON_AMOUNT_FIELDS.map((f) => [f, x[f]])) as Record<
        NoonAmountField,
        string
      >,
      total: x.total,
    }).map((m) => ({ ...m, channelId: x.channel_id, orderElsewhere: false })),
  );
}

/** eBay's finances rows: by order (no SKU; the P&L shares them over the order's lines). */
export async function ebaySkuMoneyRows(tx: Transaction, r: Range): Promise<ChannelMoneyRow[]> {
  const rows = await tx.execute<{
    channel_id: string;
    order_id: string | null;
    transaction_date: string;
    transaction_type: string;
    fee_type: string | null;
    amount: string;
    fees: string;
  }>(sql`
    select t.channel_id, t.order_id, t.transaction_date::text, t.transaction_type, t.fee_type,
      t.amount::text as amount, t.fees::text as fees
    from ebay_transactions t
    left join ${periodOrders(r)} p on p.channel_id = t.channel_id and p.external_id = t.order_id
    where p.external_id is not null or (
      t.transaction_date between ${r.from}::date and ${r.to}::date
      and (t.order_id is null or not exists (select 1 from orders o
        where o.channel_id = t.channel_id and o.external_id = t.order_id))
    )`);
  return rows.rows.flatMap((x) =>
    ebaySkuRows({
      orderId: x.order_id,
      transactionDate: x.transaction_date,
      transactionType: x.transaction_type,
      feeType: x.fee_type,
      amount: x.amount,
      fees: x.fees,
    }).map((m) => ({ ...m, channelId: x.channel_id, orderElsewhere: false })),
  );
}

/** Walmart settles an order within weeks: its reports this long after the period are read too. */
const WALMART_SETTLE_DAYS = 45;

/**
 * Walmart's settlement rows, read by their SKU and PO columns: on the period's orders (in reports
 * up to 45 days after it), or on no order the company has in a report dated in the period.
 */
export async function walmartSkuMoneyRows(tx: Transaction, r: Range): Promise<ChannelMoneyRow[]> {
  const settlements = await tx.execute<{
    id: string;
    channel_id: string;
    date: string;
    columns: string[];
  }>(sql`
    select id, channel_id, coalesce(period_to, report_date)::text as date, columns
    from walmart_settlements
    where coalesce(period_to, report_date) between ${r.from}::date
      and (${r.to}::date + ${WALMART_SETTLE_DAYS}::int)`);
  if (!settlements.rows.length) return [];
  const period = await tx.execute<{ channel_id: string; external_id: string }>(
    sql`select channel_id, external_id from ${periodOrders(r)} p`,
  );
  const inPeriod = new Set(period.rows.map((p) => `${p.channel_id}|${p.external_id}`));
  const out: ChannelMoneyRow[] = [];
  for (const s of settlements.rows) {
    const layout = walmartLayout(s.columns);
    if (!layout) continue;
    const columns = walmartSkuColumns(s.columns);
    const rows = await tx.execute<{ data: Record<string, string> }>(
      sql`select data from walmart_settlement_rows where settlement_id = ${s.id} order by line`,
    );
    const read = rows.rows.flatMap((x) => {
      const m = walmartSkuRow(x.data, layout, columns, s.date);
      return m && m.kind !== "ignore" ? [m] : [];
    });
    const refs = [...new Set(read.map((m) => m.orderRef).filter((v): v is string => !!v))];
    const known = refs.length
      ? new Set(
          (
            await tx.execute<{ external_id: string }>(
              sql`select external_id from orders where channel_id = ${s.channel_id}
                and external_id in ${refs}`,
            )
          ).rows.map((o) => o.external_id),
        )
      : new Set<string>();
    const dated = s.date >= r.from && s.date <= r.to;
    for (const m of read) {
      const ours = m.orderRef !== null && inPeriod.has(`${s.channel_id}|${m.orderRef}`);
      const elsewhere = m.orderRef !== null && known.has(m.orderRef) && !ours;
      if (ours || (dated && !elsewhere))
        out.push({ ...m, channelId: s.channel_id, orderElsewhere: false });
    }
  }
  return out;
}

/**
 * The unit cost each product's units posted at in cost of goods sold, per channel and month:
 * what its lots' consumptions for sales cost, over their units (in the lots' currency).
 */
export async function postedUnitCosts(
  tx: Transaction,
  input: { fromMonth: string; toMonth: string },
): Promise<Map<string, Map<string, Map<string, string>>>> {
  const rows = await tx.execute<{
    channel_id: string;
    month: string;
    product_id: string;
    cost: string;
  }>(sql`
    select p.channel_id, p.month, l.product_id,
      round(sum(c.cost) / nullif(sum(c.quantity), 0), 4)::text as cost
    from lot_consumptions c
    join cogs_periods p on p.id = c.cogs_period_id
    join inventory_lots l on l.id = c.lot_id
    where c.kind = 'sale' and p.month between ${input.fromMonth} and ${input.toMonth}
    group by p.channel_id, p.month, l.product_id`);
  const out = new Map<string, Map<string, Map<string, string>>>();
  for (const x of rows.rows) {
    if (x.cost === null) continue;
    const channel = out.get(x.channel_id) ?? new Map<string, Map<string, string>>();
    const month = channel.get(x.month) ?? new Map<string, string>();
    month.set(x.product_id, x.cost);
    channel.set(x.month, month);
    out.set(x.channel_id, channel);
  }
  return out;
}

/** Ad spend per channel, SKU (null: Sponsored Brands and the like) and day, in its currency. */
export async function adSpendByDay(tx: Transaction, input: { from: string; to: string }) {
  const rows = await tx.execute<{
    channel_id: string;
    currency: string;
    sku: string | null;
    date: string;
    spend: string;
    attributed_sales: string;
  }>(sql`
    select channel_id, currency, sku, date::text as date, sum(spend)::text as spend,
      sum(attributed_sales)::text as attributed_sales
    from ad_metrics
    where date between ${input.from}::date and ${input.to}::date
    group by channel_id, currency, sku, date`);
  return rows.rows.map((x) => ({
    channelId: x.channel_id,
    currency: x.currency,
    sku: x.sku,
    date: x.date,
    spend: x.spend,
    attributedSales: x.attributed_sales,
  }));
}

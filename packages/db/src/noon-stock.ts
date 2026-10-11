import { type NoonLedgerMismatch, type NoonStockDay, noonLedgerMismatches } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { noonStockDays } from "./schema/inventory";

/**
 * Noon's FBN ledger summary (phase 4c, slice 8): what Noon holds, and a check of the detailed
 * ledger against it. Run inside `withOrg()`.
 */

/** Adds the summary's days; a day brought in again replaces what was there. */
export async function importNoonStockDays(
  tx: Transaction,
  input: { orgId: string; rows: readonly NoonStockDay[] },
): Promise<{ saved: number }> {
  let saved = 0;
  for (let i = 0; i < input.rows.length; i += 500) {
    const chunk = input.rows.slice(i, i + 500);
    const rows = await tx
      .insert(noonStockDays)
      .values(
        chunk.map((r) => ({
          organizationId: input.orgId,
          date: r.date,
          location: r.location,
          sku: r.sku,
          nfsku: r.nfsku,
          condition: r.condition,
          opening: r.opening,
          closing: r.closing,
          movements: r.movements,
        })),
      )
      .onConflictDoUpdate({
        target: [
          noonStockDays.organizationId,
          noonStockDays.date,
          noonStockDays.location,
          noonStockDays.sku,
          noonStockDays.condition,
        ],
        set: {
          nfsku: sql`excluded.nfsku`,
          opening: sql`excluded.opening`,
          closing: sql`excluded.closing`,
          movements: sql`excluded.movements`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: noonStockDays.id });
    saved += rows.length;
  }
  return { saved };
}

/**
 * Each summary row's Noon channel: the one whose detailed ledger uses its warehouse code most,
 * else the company's only Noon channel.
 */
const dayChannels = sql`
  with loc as (
    select distinct on (e.fulfillment_center) e.fulfillment_center as location, e.channel_id
    from inventory_ledger_events e
    join sales_channels c on c.id = e.channel_id and c.kind = 'noon'
    where e.fulfillment_center is not null
    group by e.fulfillment_center, e.channel_id
    order by e.fulfillment_center, count(*) desc),
  only_noon as (
    select min(c.id::text)::uuid as channel_id from sales_channels c where c.kind = 'noon'
    having count(*) = 1),
  days as (
    select d.*, coalesce(loc.channel_id, (select channel_id from only_noon)) as channel_id
    from noon_stock_days d left join loc on loc.location = d.location)`;

export type NoonStockLevel = {
  productId: string;
  /** Units Noon can sell (sellable), on the summary's latest day. */
  sellable: number;
  /** Units Noon holds in another condition (damaged…). */
  other: number;
};

/** What Noon holds per product on the summary's latest day (linked SKUs × units). */
export async function noonStockByProduct(
  tx: Transaction,
): Promise<{ date: string | null; products: NoonStockLevel[] }> {
  const date = await latestNoonStockDay(tx);
  if (!date) return { date, products: [] };
  const rows = await tx.execute<{
    product_id: string;
    sellable: number;
    other: number;
  }>(sql`${dayChannels}
    select ps.product_id,
      coalesce(sum(case when d.condition = 'sellable' then d.closing * ps.units end), 0)::int as sellable,
      coalesce(sum(case when d.condition <> 'sellable' then d.closing * ps.units end), 0)::int as other
    from days d
    join product_skus ps on ps.channel_id = d.channel_id and ps.sku = d.sku
    where d.date = ${date}::date
    group by ps.product_id`);
  return {
    date,
    products: rows.rows.map((r) => ({
      productId: r.product_id,
      sellable: Number(r.sellable),
      other: Number(r.other),
    })),
  };
}

async function latestNoonStockDay(tx: Transaction): Promise<string | null> {
  const rows = await tx.execute<{ date: string | null }>(
    sql`select max(date)::text as date from noon_stock_days`,
  );
  return rows.rows[0]?.date ?? null;
}

export type NoonLedgerCheck = {
  /** The days checked: the summary's, up to the day Noon's detailed ledger is in through. */
  from: string | null;
  to: string | null;
  mismatches: NoonLedgerMismatch[];
};

/**
 * Days where Noon's summary and its detailed ledger move a SKU by different amounts. Only days
 * both cover are checked: the summary's, up to the day every Noon channel's ledger is in through.
 */
export async function noonLedgerCheck(tx: Transaction): Promise<NoonLedgerCheck> {
  const bounds = await tx.execute<{ from: string | null; to: string | null }>(sql`
    select (select min(date) from noon_stock_days)::text as "from",
      least((select max(date) from noon_stock_days),
        (select min(c.ledger_synced_through) from sales_channels c where c.kind = 'noon' and c.is_active))::text as "to"`);
  const from = bounds.rows[0]?.from ?? null;
  const to = bounds.rows[0]?.to ?? null;
  if (!from || !to || to < from) return { from, to: null, mismatches: [] };
  const summary = await tx.execute<{ date: string; sku: string; change: number }>(sql`
    select d.date::text as date, d.sku, sum(d.closing - d.opening)::int as change
    from noon_stock_days d
    where d.date between ${from}::date and ${to}::date
    group by d.date, d.sku`);
  const ledger = await tx.execute<{ date: string; sku: string; quantity: number }>(sql`
    select e.event_date::text as date, e.sku, sum(e.quantity)::int as quantity
    from inventory_ledger_events e
    join sales_channels c on c.id = e.channel_id and c.kind = 'noon'
    where e.event_date between ${from}::date and ${to}::date
      and e.sku in (select distinct sku from noon_stock_days)
    group by e.event_date, e.sku`);
  return {
    from,
    to,
    mismatches: noonLedgerMismatches(
      summary.rows.map((r) => ({ ...r, change: Number(r.change) })),
      ledger.rows.map((r) => ({ ...r, quantity: Number(r.quantity) })),
    ),
  };
}

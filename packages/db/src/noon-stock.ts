import { type NoonLedgerMismatch, type NoonStockDay, noonLedgerMismatches } from "@bookalyze/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { noonSyncState, saveNoonSyncState } from "./noon-transactions";
import { connections } from "./schema/banking";
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
          fromDate: r.fromDate ?? null,
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
          fromDate: sql`excluded.from_date`,
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
 * Saves one window of Noon's summary as brought in from its API. Asked for a window of several
 * days, Noon sends one row per warehouse and SKU for the whole window, dated a single day (the
 * month's last, even for a month not over yet): those rows are saved as the window itself
 * (`fromDate` → `date`), replacing any saved under that single day before. Daily rows (several
 * days in the file) are saved as they are.
 */
export async function importNoonStockWindow(
  tx: Transaction,
  input: {
    orgId: string;
    rows: readonly NoonStockDay[];
    window: { from: string; to: string };
  },
): Promise<{ saved: number }> {
  const dates = new Set(input.rows.map((r) => r.date));
  const [label] = dates;
  if (dates.size !== 1 || !label || input.window.from >= input.window.to) {
    return importNoonStockDays(tx, input);
  }
  if (label !== input.window.to) {
    await tx
      .delete(noonStockDays)
      .where(and(eq(noonStockDays.date, label), isNull(noonStockDays.fromDate)));
  }
  return importNoonStockDays(tx, {
    orgId: input.orgId,
    rows: input.rows.map((r) => ({ ...r, date: input.window.to, fromDate: input.window.from })),
  });
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
    from noon_stock_days d left join loc on loc.location = d.location),
  alias as (
    -- Noon's own SKU (a period report has only that) to the seller's, from Noon's transactions.
    select distinct on (t.channel_id, t.sku) t.channel_id, t.sku as noon_sku, t.partner_sku
    from noon_transactions t
    where t.sku is not null and t.partner_sku is not null
    order by t.channel_id, t.sku, t.transaction_date desc),
  day_skus as (
    -- Each summary row under the seller's SKU: its own when it's linked, else its alias's.
    select d.*, case
        when exists (select 1 from product_skus p where p.channel_id = d.channel_id and p.sku = d.sku)
          then d.sku
        else coalesce(a.partner_sku, d.sku)
      end as seller_sku
    from days d left join alias a on a.channel_id = d.channel_id and a.noon_sku = d.sku)`;

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
    from day_skus d
    join product_skus ps on ps.channel_id = d.channel_id and ps.sku = d.seller_sku
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
 * Where Noon's summary and its detailed ledger move a product by different amounts, on each
 * channel: each day the summary covers (or each period a period report covers), up to the day
 * every Noon channel's ledger is in through. Matched by product (in units of it), so the same
 * product under two SKU spellings still matches; a SKU linked to no product is matched as itself.
 */
export async function noonLedgerCheck(tx: Transaction): Promise<NoonLedgerCheck> {
  const bounds = await tx.execute<{ from: string | null; to: string | null }>(sql`
    select (select min(coalesce(from_date, date)) from noon_stock_days)::text as "from",
      least((select max(date) from noon_stock_days),
        (select min(c.ledger_synced_through) from sales_channels c where c.kind = 'noon' and c.is_active))::text as "to"`);
  const from = bounds.rows[0]?.from ?? null;
  const to = bounds.rows[0]?.to ?? null;
  if (!from || !to || to < from) return { from, to: null, mismatches: [] };
  // One product per SKU (a bundle's first), in units of it.
  const links = sql`links as (
    select distinct on (ps.channel_id, ps.sku) ps.channel_id, ps.sku, ps.product_id, ps.units, p.name
    from product_skus ps join products p on p.id = ps.product_id
    order by ps.channel_id, ps.sku, ps.units)`;
  const summary = await tx.execute<{
    date: string;
    from: string | null;
    key: string;
    label: string;
    change: number;
  }>(sql`${dayChannels}, ${links}
    select d.date::text as date, d.from_date::text as "from",
      coalesce(d.channel_id::text, '') || '|' || coalesce(l.product_id::text, d.seller_sku) as key,
      coalesce(l.name, d.seller_sku) as label,
      sum((d.closing - d.opening) * coalesce(l.units, 1))::int as change
    from day_skus d
    left join links l on l.channel_id = d.channel_id and l.sku = d.seller_sku
    where d.date <= ${to}::date
    group by 1, 2, 3, 4`);
  const ledger = await tx.execute<{ date: string; key: string; quantity: number }>(sql`
    with ${links}
    select e.event_date::text as date,
      e.channel_id::text || '|' || coalesce(l.product_id::text, e.sku) as key,
      sum(e.quantity * coalesce(l.units, 1))::int as quantity
    from inventory_ledger_events e
    join sales_channels c on c.id = e.channel_id and c.kind = 'noon'
    left join links l on l.channel_id = e.channel_id and l.sku = e.sku
    where e.event_date between ${from}::date and ${to}::date
    group by 1, 2`);
  return {
    from,
    to,
    mismatches: noonLedgerMismatches(
      summary.rows.map((r) => ({ ...r, change: Number(r.change) })),
      ledger.rows.map((r) => ({ ...r, quantity: Number(r.quantity) })),
    ),
  };
}

export type NoonStockUpload = {
  /** The day, or a period report's last day. */
  date: string;
  /** A period report's first day; null for one day. */
  fromDate: string | null;
  rows: number;
};

/** The summaries in: each day, or each period a period report covers, newest first. */
export async function noonStockUploads(tx: Transaction): Promise<NoonStockUpload[]> {
  const rows = await tx
    .select({
      date: noonStockDays.date,
      fromDate: noonStockDays.fromDate,
      rows: sql<number>`count(*)::int`,
    })
    .from(noonStockDays)
    .groupBy(noonStockDays.date, noonStockDays.fromDate)
    .orderBy(sql`${noonStockDays.date} desc`, sql`${noonStockDays.fromDate} desc nulls first`);
  return rows.map((r) => ({ ...r, rows: Number(r.rows) }));
}

/** Removes one day's summary, or one period report's; returns how many rows went. */
export async function removeNoonStockUpload(
  tx: Transaction,
  input: { date: string; fromDate: string | null },
): Promise<number> {
  const gone = await tx
    .delete(noonStockDays)
    .where(
      and(
        eq(noonStockDays.date, input.date),
        input.fromDate
          ? eq(noonStockDays.fromDate, input.fromDate)
          : isNull(noonStockDays.fromDate),
      ),
    )
    .returning({ id: noonStockDays.id });
  return gone.length;
}

/**
 * Has Noon's summary brought in again from `from` on: each Noon connection's summary sync goes
 * back to the day before (and its refresh is due), so the next "Bring in" fetches those days.
 * Used after a summary is removed. Returns how many connections were rewound.
 */
export async function rewindNoonSummarySync(tx: Transaction, from: string): Promise<number> {
  const rows = await tx
    .select({ id: connections.id, settings: connections.settings })
    .from(connections)
    .where(eq(connections.provider, "noon"));
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const before = d.toISOString().slice(0, 10);
  let n = 0;
  for (const c of rows) {
    const state = noonSyncState((c.settings ?? {}) as Record<string, unknown>, "summary");
    if (!state.through || state.through <= before) continue;
    await saveNoonSyncState(tx, c.id, { ...state, through: before, refreshedAt: null }, "summary");
    n++;
  }
  return n;
}

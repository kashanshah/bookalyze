import type { LedgerEvent } from "@bookalyze/core";
import { eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { salesChannels } from "./schema/commerce";
import { inventoryLedgerEvents } from "./schema/inventory";

/**
 * Amazon's FBA inventory ledger (phase 5, slice 5). Run inside `withOrg()`. Rows come from the
 * Reports API or an uploaded file; a row already in is skipped. Each marketplace remembers the
 * day its ledger is in through, so a month's cost of goods sold waits until it's all there.
 */

/** Adds ledger rows (skipping ones already in) and moves "in through" forward to `through`. */
export async function importLedgerEvents(
  tx: Transaction,
  input: {
    orgId: string;
    channelId: string;
    events: readonly LedgerEvent[];
    through: string | null;
  },
): Promise<{ added: number }> {
  let added = 0;
  for (let i = 0; i < input.events.length; i += 500) {
    const chunk = input.events.slice(i, i + 500);
    const rows = await tx
      .insert(inventoryLedgerEvents)
      .values(
        chunk.map((e) => ({
          organizationId: input.orgId,
          channelId: input.channelId,
          eventDate: e.date,
          sku: e.sku,
          fnsku: e.fnsku,
          asin: e.asin,
          eventType: e.eventType,
          referenceId: e.referenceId,
          quantity: e.quantity,
          fulfillmentCenter: e.fulfillmentCenter,
          disposition: e.disposition,
          reason: e.reason,
          key: e.key,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: inventoryLedgerEvents.id });
    added += rows.length;
  }
  if (input.through) {
    await tx
      .update(salesChannels)
      .set({
        ledgerSyncedThrough: sql`greatest(${salesChannels.ledgerSyncedThrough}, ${input.through}::date)`,
      })
      .where(eq(salesChannels.id, input.channelId));
  }
  return { added };
}

export type LedgerMonthRow = {
  channelId: string;
  month: string;
  sku: string;
  productName: string | null;
  /** Listing units, signed: what each kind of movement did to Amazon's stock. */
  shipped: number;
  returned: number;
  received: number;
  adjusted: number;
  removed: number;
  other: number;
};

/** Movements per marketplace, month and SKU, newest month first (up to `months` months). */
export async function ledgerByMonth(
  tx: Transaction,
  options: { months?: number } = {},
): Promise<LedgerMonthRow[]> {
  const rows = await tx.execute<{
    channel_id: string;
    month: string;
    sku: string;
    product_name: string | null;
    shipped: number;
    returned: number;
    received: number;
    adjusted: number;
    removed: number;
    other: number;
  }>(sql`
    with recent as (
      select distinct to_char(event_date, 'YYYY-MM') as month from inventory_ledger_events
      order by 1 desc limit ${options.months ?? 6}
    )
    select e.channel_id, to_char(e.event_date, 'YYYY-MM') as month, e.sku,
      (select string_agg(p.name, ' + ' order by p.name) from product_skus ps join products p on p.id = ps.product_id
        where ps.channel_id = e.channel_id and ps.sku = e.sku) as product_name,
      coalesce(sum(e.quantity) filter (where e.event_type = 'Shipments'), 0)::int as shipped,
      coalesce(sum(e.quantity) filter (where e.event_type = 'CustomerReturns'), 0)::int as returned,
      coalesce(sum(e.quantity) filter (where e.event_type = 'Receipts'), 0)::int as received,
      coalesce(sum(e.quantity) filter (where e.event_type = 'Adjustments'), 0)::int as adjusted,
      coalesce(sum(e.quantity) filter (where e.event_type = 'VendorReturns'), 0)::int as removed,
      coalesce(sum(e.quantity) filter (where e.event_type not in ('Shipments', 'CustomerReturns', 'Receipts', 'Adjustments', 'VendorReturns')), 0)::int as other
    from inventory_ledger_events e
    where to_char(e.event_date, 'YYYY-MM') in (select month from recent)
    group by e.channel_id, 2, e.sku
    order by 2 desc, e.sku`);
  return rows.rows.map((r) => ({
    channelId: r.channel_id,
    month: r.month,
    sku: r.sku,
    productName: r.product_name,
    shipped: Number(r.shipped),
    returned: Number(r.returned),
    received: Number(r.received),
    adjusted: Number(r.adjusted),
    removed: Number(r.removed),
    other: Number(r.other),
  }));
}

/**
 * Noon's FBN ledger covers every Noon country at once: each row goes to the company's Noon
 * channel for its country, and every Noon channel counts as brought in through `through` (a
 * country with no movements had none). Rows for a country the company hasn't added are left out
 * and named, so it can be added.
 */
export async function importNoonLedger(
  tx: Transaction,
  input: { orgId: string; events: readonly LedgerEvent[]; through: string | null },
): Promise<{ added: number; countriesMissing: string[] }> {
  const channels = await tx
    .select({ id: salesChannels.id, country: salesChannels.country })
    .from(salesChannels)
    .where(eq(salesChannels.kind, "noon"));
  let added = 0;
  for (const channel of channels) {
    const events = input.events.filter((e) => e.country === channel.country);
    const r = await importLedgerEvents(tx, {
      orgId: input.orgId,
      channelId: channel.id,
      events,
      through: input.through,
    });
    added += r.added;
  }
  const known = new Set(channels.map((c) => c.country));
  const countriesMissing = [
    ...new Set(input.events.map((e) => e.country ?? "").filter((c) => c && !known.has(c))),
  ].sort();
  return { added, countriesMissing };
}

/**
 * Each channel whose warehouse stock has a ledger (Amazon marketplaces, Noon countries): in
 * through, a report waiting, rows brought in.
 */
export async function ledgerChannels(tx: Transaction) {
  const channels = await tx
    .select({
      id: salesChannels.id,
      name: salesChannels.name,
      kind: salesChannels.kind,
      country: salesChannels.country,
      isActive: salesChannels.isActive,
      ordersFrom: salesChannels.ordersFrom,
      through: salesChannels.ledgerSyncedThrough,
      reportId: salesChannels.ledgerReportId,
      events: sql<number>`(select count(*) from inventory_ledger_events e where e.channel_id = "sales_channels"."id")::int`,
    })
    .from(salesChannels)
    .where(inArray(salesChannels.kind, ["amazon", "noon"]))
    .orderBy(salesChannels.name);
  return channels.map((c) => ({ ...c, events: Number(c.events) }));
}

/**
 * Movement types a marketplace used that aren't read yet ("Other": they change nothing), with
 * how many rows and units, so they can be told apart later.
 */
export async function ledgerOtherTypes(tx: Transaction) {
  const rows = await tx.execute<{
    channel_id: string;
    reason: string | null;
    rows: number;
    units: number;
  }>(sql`
    select e.channel_id, e.reason, count(*)::int as rows, sum(e.quantity)::int as units
    from inventory_ledger_events e
    where e.event_type = 'Other'
    group by e.channel_id, e.reason
    order by count(*) desc
    limit 50`);
  return rows.rows.map((r) => ({
    channelId: r.channel_id,
    type: r.reason,
    rows: Number(r.rows),
    units: Number(r.units),
  }));
}

/** Remembers a ledger report asked of Amazon (or clears it once it's in). */
export async function saveLedgerReport(
  tx: Transaction,
  channelId: string,
  report: { id: string; from: string; to: string } | null,
) {
  await tx
    .update(salesChannels)
    .set({
      ledgerReportId: report?.id ?? null,
      ledgerReportFrom: report?.from ?? null,
      ledgerReportTo: report?.to ?? null,
    })
    .where(eq(salesChannels.id, channelId));
}

export type StockComparison = {
  productId: string;
  productName: string;
  /** Units left in stock lots. */
  inLots: number;
  /** Units Amazon says can be sold now (FBA inventory, linked SKUs × units), if brought in. */
  atAmazon: number | null;
};

/** Per product: what your lots say you own against what Amazon says it holds to sell. */
export async function stockComparison(tx: Transaction): Promise<StockComparison[]> {
  const rows = await tx.execute<{
    product_id: string;
    product_name: string;
    in_lots: number;
    at_amazon: number | null;
  }>(sql`
    select p.id as product_id, p.name as product_name,
      coalesce((select sum(l.quantity - coalesce((select sum(c.quantity) from lot_consumptions c where c.lot_id = l.id), 0))
        from inventory_lots l where l.product_id = p.id), 0)::int as in_lots,
      (select sum(cs.fulfillable * ps.units) from product_skus ps
        join channel_skus cs on cs.channel_id = ps.channel_id and cs.sku = ps.sku
        where ps.product_id = p.id and cs.fulfillable is not null)::int as at_amazon
    from products p
    where not p.is_archived
      and (exists (select 1 from inventory_lots l where l.product_id = p.id)
        or exists (select 1 from product_skus ps join channel_skus cs on cs.channel_id = ps.channel_id and cs.sku = ps.sku where ps.product_id = p.id))
    order by p.name`);
  return rows.rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    inLots: Number(r.in_lots),
    atAmazon: r.at_amazon === null ? null : Number(r.at_amazon),
  }));
}

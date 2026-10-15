import type { EbayPayout, EbaySum, EbayTransaction } from "@bookalyze/core";
import { and, between, eq, inArray, like, notLike, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { importEbayPayouts } from "./ebay-posting";
import { connections } from "./schema/banking";
import { ebayTransactions, salesChannels } from "./schema/commerce";

/**
 * eBay's money (phase 4d, slice 4): the Finances API's rows kept one by one, each on the eBay site
 * of its order (else the site in its currency), and summed by month. Run inside `withOrg()`.
 */

type EbayChannel = { id: string; currency: string; isActive: boolean };

/** The company's eBay sites, switched-on first. */
async function ebayChannels(tx: Transaction): Promise<EbayChannel[]> {
  const rows = await tx
    .select({
      id: salesChannels.id,
      currency: salesChannels.currency,
      isActive: salesChannels.isActive,
    })
    .from(salesChannels)
    .where(eq(salesChannels.kind, "ebay"))
    .orderBy(sql`${salesChannels.isActive} desc`, salesChannels.createdAt);
  return rows;
}

export type EbayImportResult = { added: number; updated: number };

/**
 * Saves rows as eBay reports them: new ones added, known ones (same id and type) updated. A row
 * goes on its order's site when the order is in, else on the site in its currency, else the
 * first eBay site. Rows put on a site by currency move to their order's site once it comes in.
 */
export async function importEbayTransactions(
  tx: Transaction,
  input: { orgId: string; rows: readonly EbayTransaction[] },
): Promise<EbayImportResult> {
  const result: EbayImportResult = { added: 0, updated: 0 };
  if (!input.rows.length) return result;
  const channels = await ebayChannels(tx);
  const fallback = channels[0];
  if (!fallback) return result;
  const byCurrency = new Map<string, string>();
  for (const c of channels) if (!byCurrency.has(c.currency)) byCurrency.set(c.currency, c.id);

  const orderIds = [...new Set(input.rows.map((r) => r.orderId).filter(Boolean))] as string[];
  const byOrder = new Map<string, string>();
  if (orderIds.length) {
    const found = await tx.execute<{ external_id: string; channel_id: string }>(sql`
      select o.external_id, o.channel_id from orders o
      join sales_channels sc on sc.id = o.channel_id and sc.kind = 'ebay'
      where o.external_id in ${orderIds}`);
    for (const r of found.rows) byOrder.set(r.external_id, r.channel_id);
  }

  for (let i = 0; i < input.rows.length; i += 500) {
    const chunk = input.rows.slice(i, i + 500);
    const saved = await tx
      .insert(ebayTransactions)
      .values(
        chunk.map((r) => ({
          organizationId: input.orgId,
          channelId:
            (r.orderId && byOrder.get(r.orderId)) || byCurrency.get(r.currency) || fallback.id,
          transactionId: r.transactionId,
          transactionType: r.transactionType,
          status: r.status,
          transactionAt: new Date(r.transactionDate),
          transactionDate: r.transactionDate.slice(0, 10),
          orderId: r.orderId,
          payoutId: r.payoutId,
          feeType: r.feeType,
          currency: r.currency,
          amount: r.amount,
          fees: r.fees,
          ebayTax: r.ebayTax,
        })),
      )
      .onConflictDoUpdate({
        target: [
          ebayTransactions.organizationId,
          ebayTransactions.transactionId,
          ebayTransactions.transactionType,
        ],
        set: {
          channelId: sql`excluded.channel_id`,
          status: sql`excluded.status`,
          transactionAt: sql`excluded.transaction_at`,
          transactionDate: sql`excluded.transaction_date`,
          orderId: sql`excluded.order_id`,
          payoutId: sql`excluded.payout_id`,
          feeType: sql`excluded.fee_type`,
          currency: sql`excluded.currency`,
          amount: sql`excluded.amount`,
          fees: sql`excluded.fees`,
          ebayTax: sql`excluded.ebay_tax`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const s of saved) {
      if (s.inserted) result.added++;
      else result.updated++;
    }
  }
  return result;
}

/** The keys of rows from eBay's transaction report (the report has no API transaction id). */
export const EBAY_REPORT_KEY = "report:%";

export type EbayReportImport = EbayImportResult & {
  /** Rows on days eBay's API already brought in: left out, so nothing counts twice. */
  fromApi: number;
  payouts: number;
};

/**
 * Saves rows from eBay's transaction report (Seller Hub → Payments → Reports). A day the API
 * already brought in keeps the API's rows (they're the same money), so the report's rows for it
 * are left out; when the API later reads days the report filled, it replaces them
 * (`dropEbayReportRows`). Payouts are eBay's own ids, so they never double up.
 */
export async function importEbayReport(
  tx: Transaction,
  input: { orgId: string; rows: readonly EbayTransaction[]; payouts: readonly EbayPayout[] },
): Promise<EbayReportImport> {
  const days = [...new Set(input.rows.map((r) => r.transactionDate.slice(0, 10)))];
  const apiDays = new Set(
    days.length
      ? (
          await tx
            .selectDistinct({ day: ebayTransactions.transactionDate })
            .from(ebayTransactions)
            .where(
              and(
                inArray(ebayTransactions.transactionDate, days),
                notLike(ebayTransactions.transactionId, EBAY_REPORT_KEY),
              ),
            )
        ).map((r) => r.day)
      : [],
  );
  const rows = input.rows.filter((r) => !apiDays.has(r.transactionDate.slice(0, 10)));
  const saved = await importEbayTransactions(tx, { orgId: input.orgId, rows });
  await placeEbayTransactionsByOrder(tx);
  const payouts = await importEbayPayouts(tx, { orgId: input.orgId, payouts: input.payouts });
  return { ...saved, fromApi: input.rows.length - rows.length, payouts };
}

/** Removes the report's rows on days the API has just read (its rows replace them). */
export async function dropEbayReportRows(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<number> {
  const dropped = await tx
    .delete(ebayTransactions)
    .where(
      and(
        like(ebayTransactions.transactionId, EBAY_REPORT_KEY),
        between(ebayTransactions.transactionDate, range.from, range.to),
      ),
    )
    .returning({ id: ebayTransactions.id });
  return dropped.length;
}

/** Puts rows on their order's eBay site, for orders that came in after their rows. */
export async function placeEbayTransactionsByOrder(tx: Transaction): Promise<number> {
  const moved = await tx.execute(sql`
    update ebay_transactions t set channel_id = o.channel_id, updated_at = now()
    from orders o
    join sales_channels sc on sc.id = o.channel_id and sc.kind = 'ebay'
    where t.order_id = o.external_id and t.channel_id <> o.channel_id`);
  return moved.rowCount ?? 0;
}

export type EbayMonth = {
  channelId: string;
  channelName: string;
  currency: string;
  /** YYYY-MM. */
  month: string;
  rows: number;
  sums: EbaySum[];
};

/** Each eBay site's months (optionally only days in `from`…`to`), newest first. */
export async function ebayMonths(
  tx: Transaction,
  range?: { from: string; to: string },
): Promise<EbayMonth[]> {
  const rows = await tx.execute<{
    channel_id: string;
    channel_name: string;
    currency: string;
    month: string;
    transaction_type: string;
    fee_type: string | null;
    rows: number;
    amount: string;
    fees: string;
  }>(sql`
    select t.channel_id, sc.name as channel_name, t.currency,
      to_char(t.transaction_date, 'YYYY-MM') as month, t.transaction_type, t.fee_type,
      count(*)::int as rows, sum(t.amount)::text as amount, sum(t.fees)::text as fees
    from ebay_transactions t
    join sales_channels sc on sc.id = t.channel_id
    ${range ? sql`where t.transaction_date between ${range.from}::date and ${range.to}::date` : sql``}
    group by 1, 2, 3, 4, 5, 6
    order by month desc, channel_name`);
  const months = new Map<string, EbayMonth>();
  for (const r of rows.rows) {
    const key = `${r.channel_id}:${r.currency}:${r.month}`;
    let m = months.get(key);
    if (!m) {
      m = {
        channelId: r.channel_id,
        channelName: r.channel_name,
        currency: r.currency,
        month: r.month,
        rows: 0,
        sums: [],
      };
      months.set(key, m);
    }
    m.rows += r.rows;
    m.sums.push({
      transactionType: r.transaction_type,
      feeType: r.fee_type,
      rows: r.rows,
      amount: r.amount,
      fees: r.fees,
    });
  }
  return [...months.values()];
}

/** How far eBay's rows are in: days read through, and a window being read page by page. */
export type EbaySyncState = {
  through: string | null;
  refreshedAt: string | null;
  pending: { from: string; to: string; offset: number } | null;
  /** Payouts are in through this day (they come in with each window, from slice 5). */
  payoutsThrough: string | null;
};

export function ebaySyncState(settings: Record<string, unknown>): EbaySyncState {
  const raw = settings.transactions;
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const p =
    s.pending && typeof s.pending === "object" ? (s.pending as Record<string, unknown>) : null;
  return {
    through: typeof s.through === "string" ? s.through : null,
    refreshedAt: typeof s.refreshedAt === "string" ? s.refreshedAt : null,
    pending:
      p && typeof p.from === "string" && typeof p.to === "string" && typeof p.offset === "number"
        ? { from: p.from, to: p.to, offset: p.offset }
        : null,
    payoutsThrough: typeof s.payoutsThrough === "string" ? s.payoutsThrough : null,
  };
}

export async function saveEbaySyncState(
  tx: Transaction,
  connectionId: string,
  state: EbaySyncState,
) {
  await tx
    .update(connections)
    .set({
      settings: sql`${connections.settings} || jsonb_build_object('transactions', ${JSON.stringify(state)}::jsonb)`,
    })
    .where(and(eq(connections.id, connectionId), eq(connections.provider, "ebay")));
}

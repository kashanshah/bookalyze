import "server-only";
import { isAmazonRegion, orderSyncWindow, refundSyncWindow } from "@bookalyze/core";
import {
  countOrdersNeedingItems,
  getChannelForSync,
  getDb,
  orderSyncChannels,
  ordersNeedingItems,
  recordConnectionSync,
  saveOrderCursor,
  saveOrderItems,
  saveRefundCursor,
  saveRefunds,
  upsertOrders,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import { sql } from "drizzle-orm";
import { AmazonError, orderItems, ordersPage, refundsPage } from "./amazon";
import { openAmazonCredentials } from "./commerce";

/**
 * Bringing Amazon orders in, one sales channel (marketplace) at a time, within a time budget:
 * first the orders changed since the last sync (Amazon's pages, 100 at a time), then the refunds
 * posted since the last sync (Finances API), then the items of orders that don't have them yet.
 * Amazon rations every call, so a large first sync takes several runs; each run carries on where the last stopped (the page token is kept on the channel).
 * Nothing here posts to the books.
 */

const MINUTE = 60_000;
/** A channel synced this recently isn't asked for orders again (items still carry on). */
const FRESH_MS = 10 * MINUTE;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type OrderSyncResult = {
  /** Orders added or changed. */
  orders: number;
  /** Orders whose items were fetched. */
  items: number;
  /** Refunds newly found. */
  refunds: number;
  /** Orders still waiting for their items. */
  waiting: number;
  /** More to do: run again. */
  more: boolean;
  error: string | null;
};

type SyncContext = { orgId: string; userId: string | null };

export async function syncChannelOrders(
  ctx: SyncContext,
  channelId: string,
  deadline: number,
): Promise<OrderSyncResult> {
  const db = getDb();
  const result: OrderSyncResult = {
    orders: 0,
    items: 0,
    refunds: 0,
    waiting: 0,
    more: false,
    error: null,
  };
  const found = await withOrg(db, ctx, (tx) => getChannelForSync(tx, channelId));
  if (!found) return { ...result, error: "This channel no longer exists." };
  const { channel, connection } = found;
  const region = String(connection.settings.region ?? "");
  if (
    connection.provider !== "amazon_sp" ||
    !connection.secret ||
    !isAmazonRegion(region) ||
    !channel.isActive ||
    !channel.ordersFrom ||
    !channel.marketplaceId
  ) {
    return result;
  }
  const from = channel.ordersFrom;
  const marketplaceIds = [channel.marketplaceId];

  /** Waits out Amazon's rationing while there's time; false when there isn't. */
  const backOff = async (wait: number) => {
    if (Date.now() + wait >= deadline) return false;
    await sleep(wait);
    return true;
  };

  try {
    const creds = openAmazonCredentials(ctx.orgId, connection.id, connection.secret);

    // 1. Orders changed since the last sync.
    let nextToken = channel.ordersNextToken;
    let windowEnd = channel.ordersWindowEnd;
    const fresh =
      !nextToken &&
      channel.ordersSyncedThrough &&
      Date.now() - channel.ordersSyncedThrough.getTime() < FRESH_MS;
    let ordersDone = Boolean(fresh);
    while (!ordersDone && Date.now() < deadline) {
      let page: Awaited<ReturnType<typeof ordersPage>>;
      try {
        if (nextToken && windowEnd) {
          page = await ordersPage(creds, region, { marketplaceIds, nextToken });
        } else {
          const window = orderSyncWindow({
            from,
            syncedThrough: channel.ordersSyncedThrough,
            now: new Date(),
          });
          windowEnd = new Date(window.before);
          page = await ordersPage(creds, region, { marketplaceIds, ...window });
        }
      } catch (error) {
        if (error instanceof AmazonError && error.code === "throttled") {
          if (await backOff(5_000)) continue;
          break;
        }
        // A page token Amazon no longer knows: start the window again.
        if (error instanceof AmazonError && error.code === "unexpected" && nextToken) {
          nextToken = null;
          windowEnd = null;
          await withOrg(db, ctx, (tx) =>
            saveOrderCursor(tx, channelId, {
              nextToken: null,
              syncedThrough: channel.ordersSyncedThrough,
            }),
          );
          continue;
        }
        throw error;
      }
      const end = windowEnd as Date;
      const token = page.nextToken;
      result.orders += await withOrg(db, ctx, async (tx) => {
        const saved = await upsertOrders(tx, {
          orgId: ctx.orgId,
          channelId,
          from,
          orders: page.orders,
        });
        await saveOrderCursor(
          tx,
          channelId,
          token ? { nextToken: token, windowEnd: end } : { nextToken: null, syncedThrough: end },
        );
        return saved;
      });
      nextToken = token;
      if (!token) ordersDone = true;
    }
    if (!ordersDone) result.more = true;

    // 2. Refunds posted since the last sync (window by window for a long history), once the
    // orders are all in: a refund is kept only against an order already here. Before items, so a
    // backlog of item details never holds refunds up.
    let refundToken = channel.refundsNextToken;
    let refundEnd = channel.refundsWindowEnd;
    let refundsThrough = channel.refundsSyncedThrough;
    let refundsDone = Boolean(
      !refundToken && refundsThrough && Date.now() - refundsThrough.getTime() < FRESH_MS,
    );
    while (ordersDone && !refundsDone && Date.now() < deadline) {
      let page: Awaited<ReturnType<typeof refundsPage>>;
      try {
        if (refundToken && refundEnd) {
          page = await refundsPage(creds, region, { nextToken: refundToken });
        } else {
          const window = refundSyncWindow({ from, syncedThrough: refundsThrough, now: new Date() });
          refundEnd = new Date(window.before);
          page = await refundsPage(creds, region, window);
        }
      } catch (error) {
        if (error instanceof AmazonError && error.code === "throttled") {
          if (await backOff(2_100)) continue;
          break;
        }
        if (error instanceof AmazonError && error.code === "unexpected" && refundToken) {
          refundToken = null;
          refundEnd = null;
          await withOrg(db, ctx, (tx) =>
            saveRefundCursor(tx, channelId, { nextToken: null, syncedThrough: refundsThrough }),
          );
          continue;
        }
        if (error instanceof AmazonError && error.code === "forbidden") {
          throw new AmazonError(
            "Orders are in, but Amazon didn't let us read refunds. Give the app the Finance and Accounting role in Seller Central → Develop Apps, then authorize it again.",
            "forbidden",
          );
        }
        throw error;
      }
      const end = refundEnd as Date;
      const token = page.nextToken;
      result.refunds += await withOrg(db, ctx, async (tx) => {
        const saved = await saveRefunds(tx, {
          orgId: ctx.orgId,
          channelId,
          refunds: page.refunds,
        });
        await saveRefundCursor(
          tx,
          channelId,
          token ? { nextToken: token, windowEnd: end } : { nextToken: null, syncedThrough: end },
        );
        return saved;
      });
      refundToken = token;
      if (!token) {
        refundsThrough = end;
        refundEnd = null;
        // A window short of now (a long history) means another one follows.
        refundsDone = Date.now() - end.getTime() < FRESH_MS;
      }
    }
    if (!refundsDone) result.more = true;

    // 3. Items of orders that don't have them yet.
    items: while (Date.now() < deadline) {
      const batch = await withOrg(db, ctx, (tx) => ordersNeedingItems(tx, channelId, 10));
      if (!batch.length) break;
      for (const order of batch) {
        if (Date.now() >= deadline) break items;
        let fetched: Awaited<ReturnType<typeof orderItems>> | null = null;
        while (!fetched) {
          try {
            fetched = await orderItems(creds, region, order.externalId);
          } catch (error) {
            // An order Amazon won't list items for (e.g. not found) is left without them, so it
            // doesn't block the rest on every run.
            if (error instanceof AmazonError && error.code === "unexpected") fetched = [];
            else if (!(error instanceof AmazonError && error.code === "throttled")) throw error;
            else if (!(await backOff(2_100))) break items;
          }
        }
        const items = fetched;
        await withOrg(db, ctx, (tx) =>
          saveOrderItems(tx, { orgId: ctx.orgId, orderId: order.id, items }),
        );
        result.items++;
      }
    }

    result.waiting = await withOrg(db, ctx, (tx) => countOrdersNeedingItems(tx, [channelId]));
    if (result.waiting) result.more = true;
    await withOrg(db, ctx, (tx) =>
      recordConnectionSync(tx, connection.id, { at: new Date(), error: null }),
    );
  } catch (error) {
    if (!(error instanceof AmazonError) && !(error instanceof VaultError)) throw error;
    result.error = error.message;
    result.more = false;
    await withOrg(db, ctx, (tx) =>
      recordConnectionSync(tx, connection.id, { at: new Date(), error: error.message }),
    );
  }
  return result;
}

/** Syncs a company's channels, sharing one time budget. */
export async function syncOrgOrders(
  ctx: SyncContext,
  budgetMs: number,
): Promise<OrderSyncResult & { channels: number }> {
  const deadline = Date.now() + budgetMs;
  const total = {
    orders: 0,
    items: 0,
    refunds: 0,
    waiting: 0,
    more: false,
    error: null as string | null,
  };
  const channelIds = (await withOrg(getDb(), ctx, (tx) => orderSyncChannels(tx))).map((c) => c.id);
  for (const id of channelIds) {
    const r = await syncChannelOrders(ctx, id, deadline);
    total.orders += r.orders;
    total.items += r.items;
    total.refunds += r.refunds;
    total.waiting += r.waiting;
    total.more ||= r.more;
    total.error ??= r.error;
  }
  return { ...total, channels: channelIds.length };
}

/**
 * The every-few-minutes job: every channel orders are brought in for, within the budget. Each
 * pass gives a channel at most a minute, so one large first sync doesn't starve the rest; time
 * left over goes to channels that still have more, pass after pass.
 */
export async function syncAllOrders(budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  const rows = await getDb().execute<{ organization_id: string; channel_id: string }>(
    sql`select organization_id, channel_id from syncable_sales_channels()`,
  );
  let orders = 0;
  let items = 0;
  let waiting = 0;
  const failed = new Set<string>();
  let pending = rows.rows;
  while (pending.length && Date.now() < deadline) {
    const again: typeof pending = [];
    waiting = 0;
    for (const row of pending) {
      if (Date.now() >= deadline) break;
      const r = await syncChannelOrders(
        { orgId: row.organization_id, userId: null },
        row.channel_id,
        Math.min(deadline, Date.now() + MINUTE),
      ).catch(() => ({ orders: 0, items: 0, waiting: 0, more: false, error: "failed" }));
      orders += r.orders;
      items += r.items;
      waiting += r.waiting;
      if (r.error) failed.add(row.channel_id);
      // Only channels that got somewhere go round again, so a stuck one can't spin.
      else if (r.more && (r.orders || r.items)) again.push(row);
    }
    pending = again;
  }
  return { channels: rows.rows.length, orders, items, waiting, failed: failed.size };
}

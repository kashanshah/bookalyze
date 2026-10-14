import "server-only";
import { ebayOrdersQuery, orderSyncWindow, parseEbayOrdersPage } from "@bookalyze/core";
import {
  type getChannelForSync,
  getDb,
  recordConnectionSync,
  saveOrderCursor,
  saveOrdersWithItems,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import type { OrderSyncResult } from "./amazon-orders";
import { EbayError, ebaySellGet, openEbayCredentials } from "./ebay";

/**
 * Bringing eBay orders in for one eBay site (channel), within a time budget. eBay's pages carry
 * each order's items, so an order is complete as soon as it's saved. The first sync reads every
 * order created since the start date; later ones the orders changed since the last sync (a little
 * overlap, so nothing slips between runs). A long history takes several pages: the next page's
 * offset and the window's end are kept on the channel, and the next run carries on from there.
 * The account's one connection serves all its sites; each site keeps the orders listed on it.
 * Nothing here posts to the books.
 */

const FRESH_MS = 10 * 60_000;

type SyncContext = { orgId: string; userId: string | null };
type Found = NonNullable<Awaited<ReturnType<typeof getChannelForSync>>>;

export async function syncEbayChannelOrders(
  ctx: SyncContext,
  { channel, connection }: Found,
  deadline: number,
): Promise<OrderSyncResult> {
  const result: OrderSyncResult = {
    orders: 0,
    items: 0,
    refunds: 0,
    waiting: 0,
    more: false,
    error: null,
  };
  const marketplaceId = channel.marketplaceId;
  if (!connection.secret || !channel.isActive || !channel.ordersFrom || !marketplaceId) {
    return result;
  }
  const from = channel.ordersFrom;
  const syncedThrough = channel.ordersSyncedThrough;
  let offset = channel.ordersNextToken ? Number(channel.ordersNextToken) || 0 : null;
  let windowEnd = channel.ordersWindowEnd;
  if (offset === null && syncedThrough && Date.now() - syncedThrough.getTime() < FRESH_MS) {
    return result;
  }
  try {
    const { refreshToken } = openEbayCredentials(ctx.orgId, connection.id, connection.secret);
    // The same window on every page of a run, and on the run that carries it on.
    const window = orderSyncWindow({ from, syncedThrough, now: new Date() });
    const before = windowEnd?.toISOString() ?? window.before;
    const end = new Date(before);
    const by = syncedThrough ? "lastmodifieddate" : "creationdate";
    let done = false;
    while (!done && Date.now() < deadline) {
      const json = await ebaySellGet(
        refreshToken,
        ebayOrdersQuery({ by, after: window.after, before, offset: offset ?? 0 }),
      );
      let page: ReturnType<typeof parseEbayOrdersPage>;
      try {
        page = parseEbayOrdersPage(json, marketplaceId);
      } catch (cause) {
        throw new EbayError("eBay's list of orders didn't make sense. Try again.", "unexpected", {
          cause,
        });
      }
      const next = page.next;
      const saved = await withOrg(getDb(), ctx, async (tx) => {
        const n = await saveOrdersWithItems(tx, {
          orgId: ctx.orgId,
          channelId: channel.id,
          from,
          orders: page.orders,
        });
        await saveOrderCursor(
          tx,
          channel.id,
          next !== null
            ? { nextToken: String(next), windowEnd: end }
            : { nextToken: null, syncedThrough: end },
        );
        return n;
      });
      result.orders += saved;
      result.items += page.orders.length;
      offset = next;
      windowEnd = end;
      if (next === null) done = true;
    }
    if (!done) result.more = true;
    await withOrg(getDb(), ctx, (tx) =>
      recordConnectionSync(tx, connection.id, { at: new Date(), error: null }),
    );
  } catch (error) {
    if (!(error instanceof EbayError) && !(error instanceof VaultError)) throw error;
    const message =
      error instanceof EbayError && error.code === "unexpected"
        ? `${channel.name}, orders: ${error.message}`
        : error.message;
    result.error = message;
    await withOrg(getDb(), ctx, (tx) =>
      recordConnectionSync(tx, connection.id, { at: new Date(), error: message }),
    );
  }
  return result;
}

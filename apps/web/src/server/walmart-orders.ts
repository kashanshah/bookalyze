import "server-only";
import {
  orderSyncWindow,
  parseWalmartOrdersPage,
  walmartMarketplace,
  walmartOrdersNextPath,
  walmartOrdersQuery,
  walmartShipNodes,
} from "@bookalyze/core";
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
import { openWalmartCredentials } from "./commerce";
import { WalmartError, walmartGet } from "./walmart";

/**
 * Bringing Walmart orders in for one Walmart country (channel), within a time budget. Walmart's
 * pages carry each order's lines, so an order is complete as soon as it's saved. The first sync
 * reads every order created since the start date; later ones the orders changed since the last
 * sync (a little overlap, so nothing slips between runs). Walmart lists the orders it ships
 * (WFS) apart from the seller's own, so a channel shipped both ways reads both lists, one after
 * the other. A long history takes several pages: where the run got to (which list, and
 * Walmart's cursor in it) and the window's end are kept on the channel, and the next run carries
 * on from there. Nothing here posts to the books.
 */

const FRESH_MS = 10 * 60_000;

type SyncContext = { orgId: string; userId: string | null };
type Found = NonNullable<Awaited<ReturnType<typeof getChannelForSync>>>;

/** Where a run stopped: the list (ship node) and Walmart's cursor in it ("" = its first page). */
const encode = (node: string, cursor: string) => `${node}|${cursor}`;
function decode(token: string | null) {
  if (!token) return null;
  const at = token.indexOf("|");
  return at < 0 ? null : { node: token.slice(0, at), cursor: token.slice(at + 1) };
}

export async function syncWalmartChannelOrders(
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
  const marketplace = walmartMarketplace(channel.marketplaceId ?? "");
  if (!connection.secret || !channel.isActive || !channel.ordersFrom || !marketplace) {
    return result;
  }
  const from = channel.ordersFrom;
  const syncedThrough = channel.ordersSyncedThrough;
  const nodes = walmartShipNodes(channel.fulfilment);
  let at = decode(channel.ordersNextToken);
  if (at && !nodes.includes(at.node as (typeof nodes)[number])) at = null;
  if (!at && syncedThrough && Date.now() - syncedThrough.getTime() < FRESH_MS) return result;
  try {
    const creds = openWalmartCredentials(ctx.orgId, connection.id, connection.secret);
    // The same window on every page of a run, and on the run that carries it on.
    const window = orderSyncWindow({ from, syncedThrough, now: new Date() });
    const before = channel.ordersWindowEnd?.toISOString() ?? window.before;
    const end = new Date(before);
    const by = syncedThrough ? "lastModified" : "created";
    let nodeIndex = at ? nodes.indexOf(at.node as (typeof nodes)[number]) : 0;
    let cursor = at?.cursor ?? "";
    let done = false;
    while (!done && Date.now() < deadline) {
      const node = nodes[nodeIndex];
      if (!node) break;
      const path = cursor
        ? walmartOrdersNextPath(cursor)
        : walmartOrdersQuery({ by, after: window.after, before, shipNode: node });
      const json = await walmartGet(creds, marketplace.market, path);
      let page: ReturnType<typeof parseWalmartOrdersPage>;
      try {
        page = parseWalmartOrdersPage(json);
      } catch (cause) {
        throw new WalmartError(
          "Walmart's list of orders didn't make sense. Try again.",
          "unexpected",
          {
            cause,
          },
        );
      }
      // Next: this list's next page, else the next list's first page, else the window is done.
      const nextNode = page.next ? node : nodes[nodeIndex + 1];
      const nextCursor = page.next ?? "";
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
          nextNode
            ? { nextToken: encode(nextNode, nextCursor), windowEnd: end }
            : { nextToken: null, syncedThrough: end },
        );
        return n;
      });
      result.orders += saved;
      result.items += page.orders.length;
      if (!nextNode) done = true;
      else {
        nodeIndex = nodes.indexOf(nextNode);
        cursor = nextCursor;
      }
    }
    if (!done) result.more = true;
    await withOrg(getDb(), ctx, (tx) =>
      recordConnectionSync(tx, connection.id, { at: new Date(), error: null }),
    );
  } catch (error) {
    if (!(error instanceof WalmartError) && !(error instanceof VaultError)) throw error;
    const message =
      error instanceof WalmartError && error.code === "unexpected"
        ? `${channel.name}, orders: ${error.message}`
        : error.message;
    result.error = message;
    await withOrg(getDb(), ctx, (tx) =>
      recordConnectionSync(tx, connection.id, { at: new Date(), error: message }),
    );
  }
  return result;
}

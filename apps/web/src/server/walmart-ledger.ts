import "server-only";
import {
  type LedgerEvent,
  parseWalmartInventoryLogPage,
  parseWalmartItemGtin,
  WALMART_INVENTORY_LOG_PAGE,
  type WalmartCredentials,
  walmartInventoryLogQuery,
  walmartItemPath,
  walmartMarketplace,
} from "@bookalyze/core";
import {
  getChannel,
  getConnection,
  getDb,
  importLedgerEvents,
  saveChannelSkuGtin,
  VaultError,
  wfsSkus,
  withOrg,
} from "@bookalyze/db";
import { openWalmartCredentials } from "./commerce";
import { WalmartError, walmartGet } from "./walmart";

/** The first time, the log is read this far back (or from the day orders start, if later). */
const FIRST_DAYS = 90;
const DAY = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export type WalmartLedgerResult = {
  added: number;
  /** Ran out of time: the rest comes on the next run. */
  more: boolean;
  /** SKUs Walmart has no GTIN for: their log can't be read. */
  noGtin: string[];
};

/**
 * Brings in WFS's inventory log for a Walmart channel, from the day after it's in through (the
 * first time, 90 days back or the day orders start) to yesterday: each WFS SKU's GTIN (looked
 * up once), then its log a page at a time. Movements already in are skipped. Only once every
 * SKU is read does "in through" move to yesterday, so a run cut short is picked up whole.
 */
export async function syncWalmartLedger(
  ctx: { orgId: string; userId: string | null },
  input: {
    channelId: string;
    market: string;
    creds: WalmartCredentials;
    through: string | null;
    ordersFrom: string | null;
    today: string;
  },
  deadline: number,
): Promise<WalmartLedgerResult> {
  const to = addDays(input.today, -1);
  const earliest = addDays(input.today, -FIRST_DAYS);
  const from = input.through
    ? addDays(input.through, 1)
    : input.ordersFrom && input.ordersFrom > earliest
      ? input.ordersFrom
      : earliest;
  const result: WalmartLedgerResult = { added: 0, more: false, noGtin: [] };
  if (from > to) return result;
  const skus = await withOrg(getDb(), ctx, (tx) => wfsSkus(tx, input.channelId));
  const events: LedgerEvent[] = [];
  const read = async (path: string) => {
    try {
      return await walmartGet(input.creds, input.market, path);
    } catch (error) {
      if (error instanceof WalmartError) throw error;
      throw new WalmartError("Walmart's WFS log couldn't be read.", "unexpected", {
        cause: error,
      });
    }
  };
  for (const s of skus) {
    if (Date.now() >= deadline) {
      result.more = true;
      break;
    }
    let gtin = s.gtin;
    if (!gtin) {
      gtin = parseWalmartItemGtin(await read(walmartItemPath(s.sku)));
      if (!gtin) {
        result.noGtin.push(s.sku);
        continue;
      }
      const found = gtin;
      await withOrg(getDb(), ctx, (tx) =>
        saveChannelSkuGtin(tx, { channelId: input.channelId, sku: s.sku, gtin: found }),
      );
    }
    for (let offset = 0; ; offset += WALMART_INVENTORY_LOG_PAGE) {
      let page: ReturnType<typeof parseWalmartInventoryLogPage>;
      try {
        page = parseWalmartInventoryLogPage(
          await read(walmartInventoryLogQuery({ gtin, from, to, offset })),
          s.sku,
        );
      } catch (cause) {
        if (cause instanceof WalmartError) throw cause;
        throw new WalmartError("Walmart's WFS log couldn't be read.", "unexpected", { cause });
      }
      events.push(...page.events.filter((e) => e.date >= from && e.date <= to));
      const seen = offset + WALMART_INVENTORY_LOG_PAGE;
      if (page.total !== null ? seen >= page.total : !page.events.length) break;
    }
  }
  const saved = await withOrg(getDb(), ctx, (tx) =>
    importLedgerEvents(tx, {
      orgId: ctx.orgId,
      channelId: input.channelId,
      events,
      // A SKU without a GTIN can't be read, but it doesn't hold the rest up.
      through: result.more ? null : to,
    }),
  );
  result.added = saved.added;
  return result;
}

/**
 * Brings in a Walmart channel's WFS log with its own key: nothing for a channel the seller
 * ships, switched off or not connected.
 */
export async function syncWalmartChannelLedger(
  ctx: { orgId: string; userId: string | null },
  channelId: string,
  today: string,
  deadline: number,
): Promise<WalmartLedgerResult & { error: string | null }> {
  const found = await withOrg(getDb(), ctx, async (tx) => {
    const channel = await getChannel(tx, channelId);
    const marketplace = walmartMarketplace(channel?.marketplaceId ?? "");
    if (channel?.kind !== "walmart" || !marketplace) return null;
    if (!channel.isActive || channel.fulfilment === "seller" || !channel.connectionId) return null;
    const connection = await getConnection(tx, channel.connectionId);
    if (!connection?.secret || connection.status === "disconnected") return null;
    return { channel, market: marketplace.market, connection };
  });
  const none = { added: 0, more: false, noGtin: [], error: null };
  if (!found) return none;
  const { channel, connection } = found;
  try {
    const result = await syncWalmartLedger(
      ctx,
      {
        channelId,
        market: found.market,
        creds: openWalmartCredentials(ctx.orgId, connection.id, connection.secret ?? ""),
        through: channel.ledgerSyncedThrough,
        ordersFrom: channel.ordersFrom,
        today,
      },
      deadline,
    );
    return { ...result, error: null };
  } catch (error) {
    if (error instanceof WalmartError || error instanceof VaultError) {
      return { ...none, error: `${channel.name}: ${error.message}` };
    }
    throw error;
  }
}

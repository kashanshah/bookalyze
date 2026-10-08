import "server-only";
import { type FbaInventoryItem, isAmazonRegion } from "@bookalyze/core";
import { getChannelForSync, getDb, saveChannelSkus, VaultError, withOrg } from "@bookalyze/db";
import { AmazonError, fbaInventoryPage } from "./amazon";
import { openAmazonCredentials } from "./commerce";

/**
 * Brings in every seller SKU Amazon holds stock for in a marketplace (its FBA inventory), sold
 * or not, so each variation can be linked to a product before its first order. Done once a day
 * with the orders sync, and when someone asks on the Products screen.
 */

const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SyncContext = { orgId: string; userId: string | null };

export type SkuSyncResult = { skus: number; error: string | null };

export async function syncChannelSkus(
  ctx: SyncContext,
  channelId: string,
  options: { deadline: number; ifOlderThanMs?: number },
): Promise<SkuSyncResult> {
  const found = await withOrg(getDb(), ctx, (tx) => getChannelForSync(tx, channelId));
  if (!found) return { skus: 0, error: "This channel no longer exists." };
  const { channel, connection } = found;
  const region = String(connection.settings.region ?? "");
  if (
    connection.provider !== "amazon_sp" ||
    connection.status === "disconnected" ||
    !connection.secret ||
    !isAmazonRegion(region) ||
    !channel.isActive ||
    !channel.marketplaceId
  ) {
    return { skus: 0, error: null };
  }
  const age = channel.skusSyncedAt ? Date.now() - channel.skusSyncedAt.getTime() : Infinity;
  if (options.ifOlderThanMs !== undefined && age < options.ifOlderThanMs) {
    return { skus: 0, error: null };
  }
  try {
    const creds = openAmazonCredentials(ctx.orgId, connection.id, connection.secret);
    const items: FbaInventoryItem[] = [];
    let nextToken: string | null = null;
    while (true) {
      if (Date.now() >= options.deadline) {
        return { skus: 0, error: "Amazon is slow right now. Try again in a minute." };
      }
      let page: Awaited<ReturnType<typeof fbaInventoryPage>>;
      try {
        page = await fbaInventoryPage(creds, region, {
          marketplaceId: channel.marketplaceId,
          nextToken,
        });
      } catch (error) {
        if (error instanceof AmazonError && error.code === "throttled") {
          await sleep(1_000);
          continue;
        }
        throw error;
      }
      items.push(...page.items);
      nextToken = page.nextToken;
      if (!nextToken) break;
    }
    const skus = await withOrg(getDb(), ctx, (tx) =>
      saveChannelSkus(tx, { orgId: ctx.orgId, channelId, skus: items }),
    );
    return { skus, error: null };
  } catch (error) {
    if (error instanceof AmazonError || error instanceof VaultError) {
      return { skus: 0, error: `${channel.name}: ${error.message}` };
    }
    throw error;
  }
}

/** A day between automatic SKU syncs. */
export const SKU_SYNC_EVERY_MS = DAY;

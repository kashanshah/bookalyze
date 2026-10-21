import "server-only";
import {
  parseWalmartWfsInventoryPage,
  WALMART_WFS_INVENTORY_PAGE,
  type WalmartCredentials,
  type WalmartWfsItem,
  walmartWfsInventoryQuery,
} from "@bookalyze/core";
import { getDb, saveChannelSkus, withOrg } from "@bookalyze/db";
import { WalmartError, walmartGet } from "./walmart";

/**
 * Brings in what Walmart Fulfillment Services holds for a Walmart channel: every SKU's sellable
 * and held units, all pages, saved as the channel's SKUs (like Amazon's FBA inventory), so Stock
 * shows them beside your lots and unlinked SKUs can be linked before their first order.
 */
export async function bringInWfsStock(
  ctx: { orgId: string; userId: string | null },
  input: { channelId: string; market: string; creds: WalmartCredentials },
  deadline: number,
): Promise<{ skus: number; units: number }> {
  const items: WalmartWfsItem[] = [];
  for (let offset = 0; ; offset += WALMART_WFS_INVENTORY_PAGE) {
    if (Date.now() >= deadline) {
      throw new WalmartError("Walmart is slow right now. Try again in a minute.", "throttled");
    }
    let page: ReturnType<typeof parseWalmartWfsInventoryPage>;
    try {
      page = parseWalmartWfsInventoryPage(
        await walmartGet(input.creds, input.market, walmartWfsInventoryQuery(offset)),
      );
    } catch (cause) {
      if (cause instanceof WalmartError) throw cause;
      throw new WalmartError("Walmart's WFS stock couldn't be read.", "unexpected", { cause });
    }
    items.push(...page.items);
    // Walmart says how many SKUs there are; without that, an empty page is the end.
    const seen = offset + WALMART_WFS_INVENTORY_PAGE;
    if (page.total !== null ? seen >= page.total : !page.items.length) break;
  }
  const skus = await withOrg(getDb(), ctx, (tx) =>
    saveChannelSkus(tx, {
      orgId: ctx.orgId,
      channelId: input.channelId,
      skus: items.map((i) => ({ ...i, asin: null, title: null })),
    }),
  );
  const units = items.reduce((t, i) => t + (i.fulfillable ?? 0) + (i.reserved ?? 0), 0);
  return { skus, units };
}

"use server";

import { pricedSkus, saveAmazonSellerId, schema } from "@bookalyze/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nowIn } from "@/lib/dates";
import { priceSchema, sellerIdSchema } from "@/lib/validation/prices";
import { inOrg } from "@/server/accounting";
import {
  changePrice,
  estimatePrice,
  PriceError,
  type PriceEstimate,
  refreshChannelPrices,
} from "@/server/amazon-prices";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";
import { isOrgAdmin } from "@/server/org";

const FEATURE = "inventory.prices";
const path = (slug: string) => `/o/${slug}/inventory/prices`;

type Fail = { ok: false; message: string; errors?: Record<string, string> };

const ADMINS_ONLY: Fail = { ok: false, message: "Only owners and admins can change prices." };

/** Reads every linked SKU's price from Amazon (as many as fit in about 50 seconds). */
export async function refreshPricesAction(
  slug: string,
): Promise<
  | { ok: true; checked: number; remaining: number; needsSellerId: boolean; message: string | null }
  | Fail
> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const channelIds = [
    ...new Set((await inOrg(ctx, (tx) => pricedSkus(tx))).map((r) => r.channelId)),
  ];
  const deadline = Date.now() + 50_000;
  let checked = 0;
  let remaining = 0;
  let needsSellerId = false;
  let message: string | null = null;
  for (const channelId of channelIds) {
    const result = await refreshChannelPrices(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      channelId,
      { deadline },
    );
    checked += result.checked;
    remaining += result.remaining;
    needsSellerId ||= result.needsSellerId;
    message ??= result.error;
  }
  revalidatePath(path(slug));
  if (message && !checked) return { ok: false, message };
  return { ok: true, checked, remaining, needsSellerId, message };
}

/** Fees, cost and profit at the listing's price now and at the one typed. */
export async function estimatePriceAction(
  slug: string,
  input: unknown,
): Promise<{ ok: true; estimate: PriceEstimate } | Fail> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the price." };
  }
  const channel = await channelOf(ctx, parsed.data.channelId);
  if (!channel) return { ok: false, message: "Choose one of your Amazon marketplaces." };
  try {
    const estimate = await estimatePrice(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      {
        ...parsed.data,
        channelCurrency: channel.currency,
        baseCurrency: ctx.profile.baseCurrency,
        today: nowIn(ctx.profile.timezone).date,
      },
    );
    return { ok: true, estimate };
  } catch (error) {
    if (error instanceof PriceError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Sends a new price to Amazon (owners and admins). */
export async function changePriceAction(
  slug: string,
  input: unknown,
): Promise<{ ok: true; newPrice: string; currency: string } | Fail> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!isOrgAdmin(ctx)) return ADMINS_ONLY;
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the price.",
      errors: { price: parsed.error.issues[0]?.message ?? "Check the price." },
    };
  }
  const channel = await channelOf(ctx, parsed.data.channelId);
  if (!channel) return { ok: false, message: "Choose one of your Amazon marketplaces." };
  const linked = (await inOrg(ctx, (tx) => pricedSkus(tx))).some(
    (r) => r.channelId === parsed.data.channelId && r.sku === parsed.data.sku,
  );
  if (!linked) return { ok: false, message: "Link this SKU to a product first." };
  const result = await changePrice(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    { ...parsed.data, channelCurrency: channel.currency },
  );
  await inOrg(ctx, (tx) =>
    audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: result.ok ? "listing.price_sent" : "listing.price_refused",
      entityType: "sales_channel",
      entityId: parsed.data.channelId,
      before: result.ok ? { sku: parsed.data.sku, price: result.oldPrice } : null,
      after: result.ok
        ? { sku: parsed.data.sku, price: result.newPrice, currency: result.currency }
        : { sku: parsed.data.sku, price: parsed.data.price, refused: result.message },
    }),
  );
  revalidatePath(path(slug));
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, newPrice: result.newPrice, currency: result.currency };
}

/** Saves the seller ID (merchant token) of an Amazon account, when Amazon didn't tell us. */
export async function saveSellerIdAction(
  slug: string,
  input: unknown,
): Promise<{ ok: true } | Fail> {
  const ctx = await getInventoryContext(slug, FEATURE);
  if (!isOrgAdmin(ctx)) {
    return { ok: false, message: "Only owners and admins can change connections." };
  }
  const parsed = sellerIdSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the seller ID.",
      errors: { sellerId: parsed.error.issues[0]?.message ?? "Check the seller ID." },
    };
  }
  const saved = await inOrg(ctx, async (tx) => {
    const [connection] = await tx
      .select({ id: schema.connections.id })
      .from(schema.connections)
      .where(
        and(
          eq(schema.connections.id, parsed.data.connectionId),
          eq(schema.connections.provider, "amazon_sp"),
        ),
      );
    if (!connection) return false;
    await saveAmazonSellerId(tx, connection.id, parsed.data.sellerId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.seller_id_saved",
      entityType: "connection",
      entityId: connection.id,
      after: { sellerId: parsed.data.sellerId },
    });
    return true;
  });
  if (!saved) return { ok: false, message: "This connection no longer exists." };
  revalidatePath(path(slug));
  return { ok: true };
}

async function channelOf(ctx: Awaited<ReturnType<typeof getInventoryContext>>, channelId: string) {
  return inOrg(ctx, async (tx) => {
    const [channel] = await tx
      .select({ id: schema.salesChannels.id, currency: schema.salesChannels.currency })
      .from(schema.salesChannels)
      .where(and(eq(schema.salesChannels.id, channelId), eq(schema.salesChannels.kind, "amazon")));
    return channel ?? null;
  });
}

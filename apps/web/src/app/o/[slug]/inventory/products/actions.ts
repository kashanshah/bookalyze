"use server";

import {
  createProduct,
  createProductFromSku,
  getProduct,
  InventoryError,
  inventoryChannels,
  linkBundle,
  linkSku,
  schema,
  setProductArchived,
  unlinkSku,
  updateProduct,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  bundleSchema,
  productSchema,
  skuFromOrdersSchema,
  skuLinkSchema,
} from "@/lib/validation/inventory";
import { inOrg } from "@/server/accounting";
import { syncChannelSkus } from "@/server/amazon-skus";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";

type Fail = { ok: false; message: string; errors?: Record<string, string> };
export type ProductActionResult = { ok: true; id: string; name: string } | Fail;
export type InventoryActionResult = { ok: true } | Fail;

const path = (slug: string) => `/o/${slug}/inventory/products`;

function issues(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

/** Friendly errors from the inventory functions; anything else is a real failure. */
function friendly(error: unknown): Fail {
  if (error instanceof InventoryError) {
    return {
      ok: false,
      message: error.message,
      ...(error.code === "duplicate" ? { errors: { sku: error.message } } : {}),
    };
  }
  throw error;
}

/** Adds a product, or saves changes to one (`id`). */
export async function saveProductAction(
  slug: string,
  input: unknown,
  id?: string,
): Promise<ProductActionResult> {
  const ctx = await getInventoryContext(slug);
  if (id !== undefined && !z.uuid().safeParse(id).success) {
    return { ok: false, message: "This product no longer exists." };
  }
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", errors: issues(parsed.error) };
  }
  try {
    const row = await inOrg(ctx, async (tx) => {
      const before = id ? await getProduct(tx, id) : null;
      if (id && !before) throw new InventoryError("This product no longer exists.");
      const saved = id
        ? await updateProduct(tx, { ...parsed.data, id })
        : await createProduct(tx, {
            ...parsed.data,
            orgId: ctx.org.id,
            userId: ctx.session.user.id,
          });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: id ? "product.updated" : "product.created",
        entityType: "product",
        entityId: saved.id,
        before: before
          ? {
              name: before.name,
              sku: before.sku,
              notes: before.notes,
              unitWeight: before.unitWeight,
            }
          : undefined,
        after: {
          name: saved.name,
          sku: saved.sku,
          notes: saved.notes,
          unitWeight: saved.unitWeight,
        },
      });
      return saved;
    });
    revalidatePath(path(slug));
    return { ok: true, id: row.id, name: row.name };
  } catch (error) {
    return friendly(error);
  }
}

export async function setProductArchivedAction(
  slug: string,
  id: string,
  archived: boolean,
): Promise<InventoryActionResult> {
  const ctx = await getInventoryContext(slug);
  if (!z.uuid().safeParse(id).success)
    return { ok: false, message: "This product no longer exists." };
  try {
    await inOrg(ctx, async (tx) => {
      await setProductArchived(tx, id, archived === true);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: archived ? "product.archived" : "product.restored",
        entityType: "product",
        entityId: id,
      });
    });
    revalidatePath(path(slug));
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

/** Links a marketplace SKU to a product (or changes its units if it's linked there already). */
export async function linkSkuAction(slug: string, input: unknown): Promise<InventoryActionResult> {
  const ctx = await getInventoryContext(slug);
  const parsed = skuLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", errors: issues(parsed.error) };
  }
  return link(ctx, slug, parsed.data);
}

/** Links a SKU from the "not linked yet" list to an existing product, as one unit. */
export async function linkSkuFromOrdersAction(
  slug: string,
  input: unknown,
  productId: string,
): Promise<InventoryActionResult> {
  const ctx = await getInventoryContext(slug);
  const parsed = skuFromOrdersSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(productId).success) {
    return { ok: false, message: "Choose a product to link it to." };
  }
  return link(ctx, slug, { ...parsed.data, productId, units: 1 });
}

async function link(
  ctx: Awaited<ReturnType<typeof getInventoryContext>>,
  slug: string,
  data: { productId: string; channelId: string; sku: string; units: number; bundle?: boolean },
): Promise<InventoryActionResult> {
  try {
    await inOrg(ctx, async (tx) => {
      const [channel] = await tx
        .select({ id: schema.salesChannels.id })
        .from(schema.salesChannels)
        .where(eq(schema.salesChannels.id, data.channelId));
      if (!channel) throw new InventoryError("Choose one of your marketplaces.");
      const row = await linkSku(tx, {
        ...data,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "product.sku_linked",
        entityType: "product",
        entityId: data.productId,
        after: { channelId: row.channelId, sku: row.sku, units: row.units },
      });
    });
    revalidatePath(path(slug));
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

export async function unlinkSkuAction(slug: string, id: string): Promise<InventoryActionResult> {
  const ctx = await getInventoryContext(slug);
  if (!z.uuid().safeParse(id).success)
    return { ok: false, message: "This SKU is no longer linked." };
  try {
    await inOrg(ctx, async (tx) => {
      const row = await unlinkSku(tx, id);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "product.sku_unlinked",
        entityType: "product",
        entityId: row.productId,
        before: { channelId: row.channelId, sku: row.sku, units: row.units },
      });
    });
    revalidatePath(path(slug));
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

/** Creates a product from a SKU seen on orders and links the SKU to it. */
export async function createProductFromSkuAction(
  slug: string,
  input: unknown,
): Promise<ProductActionResult> {
  const ctx = await getInventoryContext(slug);
  const parsed = skuFromOrdersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "This SKU couldn't be found on your orders." };
  try {
    const product = await inOrg(ctx, async (tx) => {
      const { product, link } = await createProductFromSku(tx, {
        ...parsed.data,
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "product.created",
        entityType: "product",
        entityId: product.id,
        after: {
          name: product.name,
          sku: product.sku,
          linked: { channelId: link.channelId, sku: link.sku, units: link.units },
        },
      });
      return product;
    });
    revalidatePath(path(slug));
    return { ok: true, id: product.id, name: product.name };
  } catch (error) {
    return friendly(error);
  }
}

/** Brings in every SKU Amazon holds stock for, sold or not, on each active marketplace. */
export async function syncAmazonSkusAction(
  slug: string,
): Promise<{ ok: true; skus: number; channels: number } | { ok: false; message: string }> {
  const ctx = await getInventoryContext(slug);
  const channels = (await inOrg(ctx, (tx) => inventoryChannels(tx))).filter((c) => c.isActive);
  const deadline = Date.now() + 50_000;
  let skus = 0;
  let synced = 0;
  let error: string | null = null;
  for (const channel of channels) {
    const result = await syncChannelSkus(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      channel.id,
      { deadline },
    );
    if (result.error) error ??= result.error;
    else if (result.skus) synced++;
    skus += result.skus;
  }
  revalidatePath(path(slug));
  if (error && !skus) return { ok: false, message: error };
  return { ok: true, skus, channels: synced };
}

/** Makes a SKU a bundle: one listing holds each of the chosen products. */
export async function makeBundleAction(
  slug: string,
  input: unknown,
): Promise<InventoryActionResult> {
  const ctx = await getInventoryContext(slug);
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the products." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      const channels = await inventoryChannels(tx);
      if (!channels.some((c) => c.id === parsed.data.channelId)) {
        throw new InventoryError("Choose one of your marketplaces.");
      }
      await linkBundle(tx, { ...parsed.data, orgId: ctx.org.id, userId: ctx.session.user.id });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "product.bundle_linked",
        entityType: "sales_channel",
        entityId: parsed.data.channelId,
        after: { sku: parsed.data.sku, components: parsed.data.components },
      });
    });
    revalidatePath(path(slug));
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

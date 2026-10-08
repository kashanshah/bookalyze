import { ORDER_STATUS_GROUPS } from "@bookalyze/core";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import { channelSkus, orderItems, orders, salesChannels } from "./schema/commerce";
import { productSkus, products } from "./schema/inventory";

/**
 * Products and the marketplace SKUs linked to them (phase 5, slice 1). Run inside `withOrg()`.
 * A linked SKU says how many units of the product one listing unit holds, so units sold are
 * order quantities × units.
 */

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly code: "duplicate" | "linked" | "not_found" = "not_found",
  ) {
    super(message);
  }
}

export type ProductInput = {
  name: string;
  sku: string | null;
  notes: string | null;
  /** Weight of one, in any unit used for all products. Left as is when undefined. */
  unitWeight?: string | null;
};

export type LinkedSku = {
  id: string;
  channelId: string;
  channelName: string;
  sku: string;
  units: number;
  /** When the listing is a bundle: the other products in it, and how many of each. */
  bundleWith: { productId: string; name: string; units: number }[];
};

export type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  notes: string | null;
  unitWeight: string | null;
  isArchived: boolean;
  createdAt: Date;
  skus: LinkedSku[];
  /** Product units sold in the last 30 days (cancelled orders left out). */
  unitsSold30d: number;
};

/** How many days "units sold" looks back. */
export const UNITS_SOLD_DAYS = 30;

const cancelled = sql.raw(ORDER_STATUS_GROUPS.cancelled.map((s) => `'${s}'`).join(", "));

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === "23505" || (error as { code?: string }).code === "23505";
}

const duplicateSku = () =>
  new InventoryError("You already have a product with this SKU. Use another code.", "duplicate");

function like(search: string) {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Product units sold per product over the last 30 days. */
async function unitsSold(tx: Transaction, productIds: readonly string[]) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await tx
    .select({
      productId: productSkus.productId,
      units: sql<number>`coalesce(sum(${orderItems.quantityOrdered} * ${productSkus.units}), 0)::int`,
    })
    .from(productSkus)
    .innerJoin(orders, eq(orders.channelId, productSkus.channelId))
    .innerJoin(
      orderItems,
      and(eq(orderItems.orderId, orders.id), eq(orderItems.sku, productSkus.sku)),
    )
    .where(
      and(
        inArray(productSkus.productId, [...productIds]),
        sql`${orders.purchasedAt} >= now() - make_interval(days => ${UNITS_SOLD_DAYS})`,
        sql`${orders.status} not in (${cancelled})`,
      ),
    )
    .groupBy(productSkus.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.units)]));
}

async function linkedSkus(tx: Transaction, productIds: readonly string[]) {
  if (!productIds.length) return new Map<string, LinkedSku[]>();
  const rows = await tx
    .select({
      id: productSkus.id,
      productId: productSkus.productId,
      channelId: productSkus.channelId,
      channelName: salesChannels.name,
      sku: productSkus.sku,
      units: productSkus.units,
    })
    .from(productSkus)
    .innerJoin(salesChannels, eq(salesChannels.id, productSkus.channelId))
    .where(inArray(productSkus.productId, [...productIds]))
    .orderBy(asc(salesChannels.name), asc(productSkus.sku));
  // Other products sharing these SKUs: the rest of each bundle.
  const partners = rows.length
    ? await tx
        .select({
          productId: productSkus.productId,
          name: products.name,
          channelId: productSkus.channelId,
          sku: productSkus.sku,
          units: productSkus.units,
        })
        .from(productSkus)
        .innerJoin(products, eq(products.id, productSkus.productId))
        .where(
          inArray(
            sql`(${productSkus.channelId}, ${productSkus.sku})`,
            rows.map((r) => sql`(${r.channelId}::uuid, ${r.sku})`),
          ),
        )
        .orderBy(asc(products.name))
    : [];
  const map = new Map<string, LinkedSku[]>();
  for (const { productId, ...sku } of rows) {
    const list = map.get(productId) ?? [];
    list.push({
      ...sku,
      bundleWith: partners
        .filter(
          (p) => p.channelId === sku.channelId && p.sku === sku.sku && p.productId !== productId,
        )
        .map((p) => ({ productId: p.productId, name: p.name, units: p.units })),
    });
    map.set(productId, list);
  }
  return map;
}

const productColumns = {
  id: products.id,
  name: products.name,
  sku: products.sku,
  notes: products.notes,
  unitWeight: products.unitWeight,
  isArchived: products.isArchived,
  createdAt: products.createdAt,
};

async function withDetails(
  tx: Transaction,
  rows: Omit<ProductRow, "skus" | "unitsSold30d">[],
): Promise<ProductRow[]> {
  const ids = rows.map((r) => r.id);
  const [skus, sold] = [await linkedSkus(tx, ids), await unitsSold(tx, ids)];
  return rows.map((r) => ({ ...r, skus: skus.get(r.id) ?? [], unitsSold30d: sold.get(r.id) ?? 0 }));
}

/** Products by name, with their linked SKUs and units sold. Archived ones only when asked. */
export async function listProducts(
  tx: Transaction,
  options: { search?: string | null; includeArchived?: boolean } = {},
): Promise<ProductRow[]> {
  const pattern = options.search?.trim() ? like(options.search.trim()) : null;
  const rows = await tx
    .select(productColumns)
    .from(products)
    .where(
      and(
        options.includeArchived ? undefined : eq(products.isArchived, false),
        pattern
          ? or(
              ilike(products.name, pattern),
              ilike(products.sku, pattern),
              sql`exists (select 1 from ${productSkus} ps where ps.product_id = "products"."id" and ps.sku ilike ${pattern})`,
            )
          : undefined,
      ),
    )
    .orderBy(asc(products.isArchived), sql`lower(${products.name})`, asc(products.id));
  return withDetails(tx, rows);
}

export async function getProduct(tx: Transaction, id: string): Promise<ProductRow | null> {
  const rows = await tx.select(productColumns).from(products).where(eq(products.id, id));
  const [row] = await withDetails(tx, rows);
  return row ?? null;
}

async function ownSkuTaken(tx: Transaction, sku: string, exceptId?: string) {
  const [row] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        sql`lower(${products.sku}) = lower(${sku})`,
        exceptId ? sql`${products.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function createProduct(
  tx: Transaction,
  input: ProductInput & { orgId: string; userId: string | null },
) {
  if (input.sku && (await ownSkuTaken(tx, input.sku))) throw duplicateSku();
  try {
    const [row] = await tx
      .insert(products)
      .values({
        organizationId: input.orgId,
        name: input.name,
        sku: input.sku,
        notes: input.notes,
        unitWeight: input.unitWeight ?? null,
        createdBy: input.userId,
      })
      .returning();
    if (!row) throw new InventoryError("The product couldn't be saved.");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateSku();
    throw error;
  }
}

export async function updateProduct(tx: Transaction, input: ProductInput & { id: string }) {
  if (input.sku && (await ownSkuTaken(tx, input.sku, input.id))) throw duplicateSku();
  try {
    const [row] = await tx
      .update(products)
      .set({
        name: input.name,
        sku: input.sku,
        notes: input.notes,
        ...(input.unitWeight !== undefined ? { unitWeight: input.unitWeight } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, input.id))
      .returning();
    if (!row) throw new InventoryError("This product no longer exists.");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateSku();
    throw error;
  }
}

export async function setProductArchived(tx: Transaction, id: string, archived: boolean) {
  const [row] = await tx
    .update(products)
    .set({ isArchived: archived, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning({ id: products.id, name: products.name });
  if (!row) throw new InventoryError("This product no longer exists.");
  return row;
}

/**
 * Links a marketplace SKU to a product. Linking it again to the same product changes its units;
 * a SKU already linked to another product is refused (unlink it there first).
 */
export async function linkSku(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    productId: string;
    channelId: string;
    sku: string;
    units: number;
    /** The listing is a bundle: link this product too, alongside the others already in it. */
    bundle?: boolean;
  },
) {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) throw new InventoryError("This product no longer exists.");
  const links = await tx
    .select({
      id: productSkus.id,
      productId: productSkus.productId,
      productName: products.name,
    })
    .from(productSkus)
    .innerJoin(products, eq(products.id, productSkus.productId))
    .where(and(eq(productSkus.channelId, input.channelId), eq(productSkus.sku, input.sku)));
  const existing = links.find((l) => l.productId === input.productId);
  const other = links.find((l) => l.productId !== input.productId);
  if (other && !input.bundle) {
    throw new InventoryError(
      `${input.sku} is already linked to ${other.productName}. Unlink it there first, or tick "It's a bundle" if the listing holds both.`,
      "linked",
    );
  }
  try {
    if (existing) {
      const [row] = await tx
        .update(productSkus)
        .set({ units: input.units })
        .where(eq(productSkus.id, existing.id))
        .returning();
      if (!row) throw new InventoryError("This link no longer exists.");
      return row;
    }
    const [row] = await tx
      .insert(productSkus)
      .values({
        organizationId: input.orgId,
        productId: input.productId,
        channelId: input.channelId,
        sku: input.sku,
        units: input.units,
        createdBy: input.userId,
      })
      .returning();
    if (!row) throw new InventoryError("The link couldn't be saved.");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InventoryError(`${input.sku} is already linked to this product.`, "linked");
    }
    throw error;
  }
}

/**
 * Makes a SKU a bundle: one listing unit holds each of `components` (product × units). Replaces
 * whatever the SKU was linked to.
 */
export async function linkBundle(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    channelId: string;
    sku: string;
    components: { productId: string; units: number }[];
  },
) {
  const ids = [...new Set(input.components.map((c) => c.productId))];
  if (ids.length < 2 || ids.length !== input.components.length) {
    throw new InventoryError("A bundle holds two or more different products.");
  }
  const found = await tx
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, ids));
  if (found.length !== ids.length)
    throw new InventoryError("One of the products no longer exists.");
  await tx
    .delete(productSkus)
    .where(and(eq(productSkus.channelId, input.channelId), eq(productSkus.sku, input.sku)));
  return tx
    .insert(productSkus)
    .values(
      input.components.map((c) => ({
        organizationId: input.orgId,
        productId: c.productId,
        channelId: input.channelId,
        sku: input.sku,
        units: c.units,
        createdBy: input.userId,
      })),
    )
    .returning();
}

export async function unlinkSku(tx: Transaction, id: string) {
  const [row] = await tx.delete(productSkus).where(eq(productSkus.id, id)).returning();
  if (!row) throw new InventoryError("This SKU is no longer linked.");
  return row;
}

export type UnlinkedSku = {
  channelId: string;
  channelName: string;
  sku: string;
  /** The product title on the most recent order, or the marketplace's listing title. */
  title: string | null;
  orders: number;
  /** Listing units ordered (cancelled orders left out). */
  units: number;
  /** Null for a SKU the marketplace lists that hasn't been ordered yet. */
  lastOrderedAt: Date | null;
  /** Units the marketplace holds that can be sold (FBA), when its SKUs were last brought in. */
  fulfillable: number | null;
};

/**
 * Seller SKUs that aren't linked to a product yet, on marketplaces still connected: every SKU
 * seen on orders, and every SKU the marketplace lists (its FBA inventory) even if never sold.
 * Most recently ordered first, then the never-ordered ones by title; with how many in all.
 */
export async function unlinkedSkus(
  tx: Transaction,
  options: { limit: number },
): Promise<{ rows: UnlinkedSku[]; total: number }> {
  const candidates = sql`
    with seen as (
      select o.channel_id, oi.sku,
        (array_agg(oi.title order by o.purchased_at desc) filter (where oi.title is not null))[1] as title,
        count(distinct o.id)::int as orders,
        coalesce(sum(oi.quantity_ordered) filter (where o.status not in (${cancelled})), 0)::int as units,
        max(o.purchased_at) as last_ordered_at
      from ${orderItems} oi
      join ${orders} o on o.id = oi.order_id
      where oi.sku is not null and length(trim(oi.sku)) > 0
      group by o.channel_id, oi.sku
    ),
    candidates as (
      select coalesce(s.channel_id, l.channel_id) as channel_id,
        coalesce(s.sku, l.sku) as sku,
        coalesce(s.title, l.title) as title,
        coalesce(s.orders, 0) as orders,
        coalesce(s.units, 0) as units,
        s.last_ordered_at,
        l.fulfillable
      from seen s
      full outer join ${channelSkus} l on l.channel_id = s.channel_id and l.sku = s.sku
    )
    select c.*, sc.name as channel_name
    from candidates c
    join ${salesChannels} sc on sc.id = c.channel_id
    where (
        sc.connection_id is null
        or exists (
          select 1 from ${connections} cn
          where cn.id = sc.connection_id and cn.status <> 'disconnected'
        )
      )
      and not exists (
        select 1 from ${productSkus} ps where ps.channel_id = c.channel_id and ps.sku = c.sku
      )`;
  const rows = await tx.execute<{
    channel_id: string;
    channel_name: string;
    sku: string;
    title: string | null;
    orders: number;
    units: number;
    last_ordered_at: string | Date | null;
    fulfillable: number | null;
  }>(sql`${candidates}
    order by c.last_ordered_at desc nulls last, lower(coalesce(c.title, c.sku)), c.sku
    limit ${options.limit}`);
  const count = await tx.execute<{ total: number }>(
    sql`select count(*)::int as total from (${candidates}) x`,
  );
  return {
    rows: rows.rows.map((r) => ({
      channelId: r.channel_id,
      channelName: r.channel_name,
      sku: r.sku,
      title: r.title,
      orders: Number(r.orders),
      units: Number(r.units),
      lastOrderedAt: r.last_ordered_at ? new Date(r.last_ordered_at) : null,
      fulfillable: r.fulfillable === null ? null : Number(r.fulfillable),
    })),
    total: Number(count.rows[0]?.total ?? 0),
  };
}

export type ListedSku = {
  sku: string;
  asin: string | null;
  title: string | null;
  fulfillable: number | null;
};

/** Saves the SKUs a marketplace lists (from its FBA inventory) and when they were brought in. */
export async function saveChannelSkus(
  tx: Transaction,
  input: { orgId: string; channelId: string; skus: ListedSku[]; at?: Date },
): Promise<number> {
  const at = input.at ?? new Date();
  const unique = new Map(input.skus.filter((s) => s.sku.trim()).map((s) => [s.sku, s] as const));
  for (const sku of unique.values()) {
    await tx
      .insert(channelSkus)
      .values({ organizationId: input.orgId, channelId: input.channelId, ...sku, seenAt: at })
      .onConflictDoUpdate({
        target: [channelSkus.channelId, channelSkus.sku],
        set: {
          asin: sku.asin,
          title: sku.title,
          fulfillable: sku.fulfillable,
          seenAt: at,
        },
      });
  }
  await tx
    .update(salesChannels)
    .set({ skusSyncedAt: at })
    .where(eq(salesChannels.id, input.channelId));
  return unique.size;
}

/**
 * Creates a product from a SKU seen on orders: named after the latest product title, with the
 * seller SKU as its own code (unless another product already uses it), and the SKU linked as
 * one unit.
 */
export async function createProductFromSku(
  tx: Transaction,
  input: { orgId: string; userId: string | null; channelId: string; sku: string },
) {
  const [seen] = await tx
    .select({ title: orderItems.title })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.channelId, input.channelId), eq(orderItems.sku, input.sku)))
    .orderBy(sql`(${orderItems.title} is null)`, sql`${orders.purchasedAt} desc`)
    .limit(1);
  const [listed] = await tx
    .select({ title: channelSkus.title })
    .from(channelSkus)
    .where(and(eq(channelSkus.channelId, input.channelId), eq(channelSkus.sku, input.sku)));
  if (!seen && !listed)
    throw new InventoryError("This SKU isn't on any order or listing any more.");
  const product = await createProduct(tx, {
    orgId: input.orgId,
    userId: input.userId,
    name: seen?.title?.trim() || listed?.title?.trim() || input.sku,
    sku: (await ownSkuTaken(tx, input.sku)) ? null : input.sku,
    notes: null,
  });
  const link = await linkSku(tx, {
    orgId: input.orgId,
    userId: input.userId,
    productId: product.id,
    channelId: input.channelId,
    sku: input.sku,
    units: 1,
  });
  return { product, link };
}

// Channels (with their connection) a SKU can be linked on: every channel the company has.
export async function inventoryChannels(tx: Transaction) {
  return tx
    .select({
      id: salesChannels.id,
      name: salesChannels.name,
      isActive: salesChannels.isActive,
    })
    .from(salesChannels)
    .leftJoin(connections, eq(connections.id, salesChannels.connectionId))
    .where(sql`${connections.status} is distinct from 'disconnected'`)
    .orderBy(asc(salesChannels.name));
}

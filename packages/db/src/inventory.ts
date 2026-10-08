import { ORDER_STATUS_GROUPS } from "@bookalyze/core";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import { orderItems, orders, salesChannels } from "./schema/commerce";
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
  const map = new Map<string, LinkedSku[]>();
  for (const { productId, ...sku } of rows) {
    const list = map.get(productId) ?? [];
    list.push(sku);
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
  },
) {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) throw new InventoryError("This product no longer exists.");
  const [existing] = await tx
    .select({
      id: productSkus.id,
      productId: productSkus.productId,
      productName: products.name,
    })
    .from(productSkus)
    .innerJoin(products, eq(products.id, productSkus.productId))
    .where(and(eq(productSkus.channelId, input.channelId), eq(productSkus.sku, input.sku)));
  if (existing && existing.productId !== input.productId) {
    throw new InventoryError(
      `${input.sku} is already linked to ${existing.productName}. Unlink it there first.`,
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
      throw new InventoryError(`${input.sku} is already linked to a product.`, "linked");
    }
    throw error;
  }
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
  /** The product title on the most recent order. */
  title: string | null;
  orders: number;
  /** Listing units ordered (cancelled orders left out). */
  units: number;
  lastOrderedAt: Date;
};

/** Orders of marketplaces still connected, as on the Orders screen. */
const connectedChannel = sql`exists (select 1 from connections c where c.id = ${salesChannels.connectionId} and c.status <> 'disconnected')`;

/**
 * Seller SKUs seen on orders that aren't linked to a product yet, most recently ordered first,
 * with how many there are in all.
 */
export async function unlinkedSkus(
  tx: Transaction,
  options: { limit: number },
): Promise<{ rows: UnlinkedSku[]; total: number }> {
  const where = and(
    sql`${orderItems.sku} is not null and length(trim(${orderItems.sku})) > 0`,
    connectedChannel,
    sql`not exists (select 1 from ${productSkus} ps where ps.channel_id = ${orders.channelId} and ps.sku = ${orderItems.sku})`,
  );
  const rows = await tx
    .select({
      channelId: orders.channelId,
      channelName: salesChannels.name,
      sku: sql<string>`${orderItems.sku}`,
      title: sql<
        string | null
      >`(array_agg(${orderItems.title} order by ${orders.purchasedAt} desc) filter (where ${orderItems.title} is not null))[1]`,
      orders: sql<number>`count(distinct ${orders.id})::int`,
      units: sql<number>`coalesce(sum(${orderItems.quantityOrdered}) filter (where ${orders.status} not in (${cancelled})), 0)::int`,
      lastOrderedAt: sql<Date>`max(${orders.purchasedAt})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(where)
    .groupBy(orders.channelId, salesChannels.name, orderItems.sku)
    .orderBy(sql`max(${orders.purchasedAt}) desc`, asc(orderItems.sku))
    .limit(options.limit);
  const [count] = await tx
    .select({
      total: sql<number>`count(distinct (${orders.channelId}, ${orderItems.sku}))::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(salesChannels, eq(salesChannels.id, orders.channelId))
    .where(where);
  return {
    rows: rows.map((r) => ({
      ...r,
      orders: Number(r.orders),
      units: Number(r.units),
      lastOrderedAt: new Date(r.lastOrderedAt),
    })),
    total: Number(count?.total ?? 0),
  };
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
  if (!seen) throw new InventoryError("No orders have this SKU any more.");
  const product = await createProduct(tx, {
    orgId: input.orgId,
    userId: input.userId,
    name: seen.title?.trim() || input.sku,
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

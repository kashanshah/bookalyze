import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { connections } from "./banking";
import { tenantIsolationPolicy } from "./tenancy";

export const CHANNEL_KINDS = ["amazon"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/**
 * Where the company sells: one row per Amazon marketplace of a connected seller account (later
 * the website and other marketplaces). Orders, review requests and settlements hang off it.
 */
export const salesChannels = pgTable(
  "sales_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    kind: text("kind", { enum: CHANNEL_KINDS }).notNull(),
    /** e.g. "Amazon.ca". */
    name: text("name").notNull(),
    /** Amazon's marketplace ID, e.g. A2EUQ1WTGCTBG2. */
    marketplaceId: text("marketplace_id"),
    country: char("country", { length: 2 }),
    currency: char("currency", { length: 3 }).notNull(),
    /** Switched off channels keep their history but aren't synced. */
    isActive: boolean("is_active").notNull().default(true),
    /** First day orders are brought in from; null until someone starts bringing them in. */
    ordersFrom: date("orders_from"),
    /** Orders updated up to here are in. */
    ordersSyncedThrough: timestamp("orders_synced_through", { withTimezone: true }),
    /** A query in progress across several runs: Amazon's page token and the window's end. */
    ordersNextToken: text("orders_next_token"),
    ordersWindowEnd: timestamp("orders_window_end", { withTimezone: true }),
    /** Refunds (Amazon's financial events) posted up to here are in; same idea as orders. */
    refundsSyncedThrough: timestamp("refunds_synced_through", { withTimezone: true }),
    refundsNextToken: text("refunds_next_token"),
    refundsWindowEnd: timestamp("refunds_window_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("sales_channels_org_id_key").on(t.organizationId, t.id),
    unique("sales_channels_connection_marketplace_key").on(t.connectionId, t.marketplaceId),
    index("sales_channels_org_idx").on(t.organizationId),
    foreignKey({
      name: "sales_channels_connection_fk",
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
    check("sales_channels_kind_valid", sql`${t.kind} in ('amazon')`),
    tenantIsolationPolicy("sales_channels", t.organizationId),
  ],
);

/**
 * An order on a sales channel, as the marketplace reports it (kept up to date by the sync).
 * Orders don't post to the books: settlements do. No buyer details are kept.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    /** The marketplace's order number, e.g. Amazon's 702-1234567-1234567. */
    externalId: text("external_id").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    /** When the marketplace last changed it. */
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull(),
    /** The marketplace's own status (Amazon: Pending, Unshipped, Shipped, Canceled…). */
    status: text("status").notNull(),
    fulfillment: text("fulfillment", { enum: ["amazon", "merchant"] }).notNull(),
    currency: char("currency", { length: 3 }),
    /** Null until the marketplace prices it. */
    total: numeric("total", { precision: 20, scale: 4 }),
    itemsShipped: integer("items_shipped").notNull().default(0),
    itemsUnshipped: integer("items_unshipped").notNull().default(0),
    shipCountry: char("ship_country", { length: 2 }),
    shipRegion: text("ship_region"),
    isBusiness: boolean("is_business").notNull().default(false),
    isPrime: boolean("is_prime").notNull().default(false),
    isReplacement: boolean("is_replacement").notNull().default(false),
    latestDelivery: date("latest_delivery"),
    /** When its items were last fetched; cleared when the order changes. */
    itemsSyncedAt: timestamp("items_synced_at", { withTimezone: true }),
    /** Given back to the buyer so far (the sum of its refunds); null when never refunded. */
    refunded: numeric("refunded", { precision: 20, scale: 4 }),
    lastRefundAt: timestamp("last_refund_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("orders_org_id_key").on(t.organizationId, t.id),
    unique("orders_channel_external_key").on(t.channelId, t.externalId),
    index("orders_org_purchased_idx").on(t.organizationId, t.purchasedAt),
    foreignKey({
      name: "orders_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    check("orders_fulfillment_valid", sql`${t.fulfillment} in ('amazon', 'merchant')`),
    tenantIsolationPolicy("orders", t.organizationId),
  ],
);

/** A line of an order: one product (SKU) and its quantity and prices. */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    externalId: text("external_id").notNull(),
    asin: text("asin"),
    sku: text("sku"),
    title: text("title"),
    quantityOrdered: integer("quantity_ordered").notNull().default(0),
    quantityShipped: integer("quantity_shipped").notNull().default(0),
    /** For the whole quantity, in the order's currency. */
    itemPrice: numeric("item_price", { precision: 20, scale: 4 }),
    itemTax: numeric("item_tax", { precision: 20, scale: 4 }),
    shippingPrice: numeric("shipping_price", { precision: 20, scale: 4 }),
    shippingTax: numeric("shipping_tax", { precision: 20, scale: 4 }),
    promotionDiscount: numeric("promotion_discount", { precision: 20, scale: 4 }),
  },
  (t) => [
    unique("order_items_order_external_key").on(t.orderId, t.externalId),
    index("order_items_org_sku_idx").on(t.organizationId, t.sku),
    foreignKey({
      name: "order_items_order_fk",
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("order_items", t.organizationId),
  ],
);

/** A refund on an order item, as the marketplace posted it. Amounts are positive. */
export const orderRefunds = pgTable(
  "order_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    /** Amazon's adjustment ID, so reading the same events again changes nothing. */
    externalId: text("external_id").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    sku: text("sku"),
    quantity: integer("quantity").notNull().default(0),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 }),
  },
  (t) => [
    unique("order_refunds_order_external_key").on(t.orderId, t.externalId),
    foreignKey({
      name: "order_refunds_order_fk",
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("order_refunds", t.organizationId),
  ],
);

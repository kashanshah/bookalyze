import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { salesChannels } from "./commerce";
import { tenantIsolationPolicy } from "./tenancy";

/**
 * Inventory (phase 5). A product is a thing the company sells, in its own words. Marketplace
 * listings (seller SKUs) link to it, each saying how many units of the product one listing unit
 * holds (a 2-pack is 2). Purchase orders, FIFO lots and cost of goods sold build on these later.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The seller's own code for it, if they use one (unique per company, any case). */
    sku: text("sku"),
    notes: text("notes"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("products_org_id_key").on(t.organizationId, t.id),
    uniqueIndex("products_org_sku_key")
      .on(t.organizationId, sql`lower(${t.sku})`)
      .where(sql`${t.sku} is not null`),
    check("products_name_present", sql`length(trim(${t.name})) > 0`),
    check("products_sku_present", sql`${t.sku} is null or length(trim(${t.sku})) > 0`),
    tenantIsolationPolicy("products", t.organizationId),
  ],
);

/** A marketplace seller SKU linked to a product: one listing unit is `units` of the product. */
export const productSkus = pgTable(
  "product_skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    /** The seller SKU exactly as the marketplace reports it on orders. */
    sku: text("sku").notNull(),
    units: integer("units").notNull().default(1),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("product_skus_org_id_key").on(t.organizationId, t.id),
    unique("product_skus_channel_sku_key").on(t.organizationId, t.channelId, t.sku),
    index("product_skus_product_idx").on(t.productId),
    foreignKey({
      name: "product_skus_product_fk",
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_skus_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    check("product_skus_units_valid", sql`${t.units} between 1 and 1000`),
    check("product_skus_sku_present", sql`length(trim(${t.sku})) > 0`),
    tenantIsolationPolicy("product_skus", t.organizationId),
  ],
);

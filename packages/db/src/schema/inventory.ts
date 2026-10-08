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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "./accounting";
import { organization, user } from "./auth";
import { salesChannels } from "./commerce";
import { currencies } from "./reference";
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
    /** Weight of one, in whatever unit the company uses for all products (to split freight). */
    unitWeight: numeric("unit_weight", { precision: 12, scale: 4 }),
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
    check("products_weight_positive", sql`${t.unitWeight} is null or ${t.unitWeight} > 0`),
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

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "ordered",
  "partial",
  "received",
  "cancelled",
] as const;

/**
 * A purchase order to a supplier (a vendor contact). Numbered PO-0001… per company. Draft until
 * it's sent ("ordered"); deliveries make it partly received, then received. Its amounts are in
 * the PO's currency; nothing posts to the books here (receiving lots and costs come in slice 3).
 */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    status: text("status", { enum: PURCHASE_ORDER_STATUSES }).notNull().default("draft"),
    currency: char("currency", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),
    /** The supplier's reference (their order or proforma number). */
    reference: text("reference"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("purchase_orders_org_id_key").on(t.organizationId, t.id),
    unique("purchase_orders_org_number_key").on(t.organizationId, t.number),
    index("purchase_orders_supplier_idx").on(t.organizationId, t.supplierId),
    foreignKey({
      name: "purchase_orders_supplier_fk",
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
    check(
      "purchase_orders_status_valid",
      sql`${t.status} in ('draft', 'ordered', 'partial', 'received', 'cancelled')`,
    ),
    check("purchase_orders_number_positive", sql`${t.number} > 0`),
    check(
      "purchase_orders_expected_after_order",
      sql`${t.expectedDate} is null or ${t.expectedDate} >= ${t.orderDate}`,
    ),
    tenantIsolationPolicy("purchase_orders", t.organizationId),
  ],
);

/** One product on a purchase order: how many, at what cost each (in the PO's currency). */
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitCost: numeric("unit_cost", { precision: 20, scale: 4 }).notNull(),
  },
  (t) => [
    unique("purchase_order_lines_org_id_key").on(t.organizationId, t.id),
    unique("purchase_order_lines_po_line_key").on(t.purchaseOrderId, t.lineNo),
    index("purchase_order_lines_product_idx").on(t.organizationId, t.productId),
    foreignKey({
      name: "purchase_order_lines_po_fk",
      columns: [t.organizationId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "purchase_order_lines_product_fk",
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    check("purchase_order_lines_quantity_valid", sql`${t.quantity} between 1 and 10000000`),
    check("purchase_order_lines_cost_valid", sql`${t.unitCost} >= 0`),
    tenantIsolationPolicy("purchase_order_lines", t.organizationId),
  ],
);

/** A delivery against a purchase order: what arrived, on which day. */
export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    receivedOn: date("received_on").notNull(),
    notes: text("notes"),
    /** Main-currency value of one unit of the PO's currency, for costing. Null if the same. */
    exchangeRate: numeric("exchange_rate", { precision: 20, scale: 10 }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("purchase_receipts_org_id_key").on(t.organizationId, t.id),
    index("purchase_receipts_po_idx").on(t.purchaseOrderId),
    foreignKey({
      name: "purchase_receipts_po_fk",
      columns: [t.organizationId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }).onDelete("cascade"),
    check(
      "purchase_receipts_rate_positive",
      sql`${t.exchangeRate} is null or ${t.exchangeRate} > 0`,
    ),
    tenantIsolationPolicy("purchase_receipts", t.organizationId),
  ],
);

/** How many of one PO line arrived in one delivery. */
export const purchaseReceiptLines = pgTable(
  "purchase_receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id").notNull(),
    purchaseOrderLineId: uuid("purchase_order_line_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    unique("purchase_receipt_lines_org_id_key").on(t.organizationId, t.id),
    unique("purchase_receipt_lines_receipt_line_key").on(t.receiptId, t.purchaseOrderLineId),
    index("purchase_receipt_lines_po_line_idx").on(t.purchaseOrderLineId),
    foreignKey({
      name: "purchase_receipt_lines_receipt_fk",
      columns: [t.organizationId, t.receiptId],
      foreignColumns: [purchaseReceipts.organizationId, purchaseReceipts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "purchase_receipt_lines_po_line_fk",
      columns: [t.organizationId, t.purchaseOrderLineId],
      foreignColumns: [purchaseOrderLines.organizationId, purchaseOrderLines.id],
    }).onDelete("cascade"),
    check("purchase_receipt_lines_quantity_positive", sql`${t.quantity} > 0`),
    tenantIsolationPolicy("purchase_receipt_lines", t.organizationId),
  ],
);

export const LANDED_COST_KINDS = ["freight", "duty", "brokerage", "prep", "other"] as const;
export const ALLOCATION_METHODS = ["units", "value", "weight"] as const;

/**
 * An extra cost of a delivery (freight, duty, brokerage, prep), in any currency, split across
 * the delivery's lines by units, value or weight. It feeds the landed cost of the lots.
 */
export const purchaseReceiptCosts = pgTable(
  "purchase_receipt_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id").notNull(),
    lineNo: integer("line_no").notNull(),
    kind: text("kind", { enum: LANDED_COST_KINDS }).notNull(),
    description: text("description"),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    /** Main-currency value of one unit of `currency`. Null when it is the main currency. */
    exchangeRate: numeric("exchange_rate", { precision: 20, scale: 10 }),
    allocation: text("allocation", { enum: ALLOCATION_METHODS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("purchase_receipt_costs_line_key").on(t.receiptId, t.lineNo),
    foreignKey({
      name: "purchase_receipt_costs_receipt_fk",
      columns: [t.organizationId, t.receiptId],
      foreignColumns: [purchaseReceipts.organizationId, purchaseReceipts.id],
    }).onDelete("cascade"),
    check(
      "purchase_receipt_costs_kind_valid",
      sql`${t.kind} in ('freight', 'duty', 'brokerage', 'prep', 'other')`,
    ),
    check(
      "purchase_receipt_costs_allocation_valid",
      sql`${t.allocation} in ('units', 'value', 'weight')`,
    ),
    check("purchase_receipt_costs_amount_positive", sql`${t.amount} > 0`),
    check(
      "purchase_receipt_costs_rate_positive",
      sql`${t.exchangeRate} is null or ${t.exchangeRate} > 0`,
    ),
    tenantIsolationPolicy("purchase_receipt_costs", t.organizationId),
  ],
);

/**
 * A FIFO cost layer: the units of one product that arrived in one delivery, at their landed
 * cost in the company's main currency. Rebuilt in place (same id) when the delivery's costs
 * change. Sales will draw on the oldest lots first once cost of goods sold is posted.
 */
export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    receiptLineId: uuid("receipt_line_id").notNull(),
    receivedOn: date("received_on").notNull(),
    quantity: integer("quantity").notNull(),
    currency: char("currency", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    productCost: numeric("product_cost", { precision: 20, scale: 4 }).notNull(),
    landedCost: numeric("landed_cost", { precision: 20, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("inventory_lots_org_id_key").on(t.organizationId, t.id),
    unique("inventory_lots_receipt_line_key").on(t.receiptLineId),
    index("inventory_lots_product_idx").on(t.organizationId, t.productId, t.receivedOn),
    foreignKey({
      name: "inventory_lots_product_fk",
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      name: "inventory_lots_receipt_line_fk",
      columns: [t.organizationId, t.receiptLineId],
      foreignColumns: [purchaseReceiptLines.organizationId, purchaseReceiptLines.id],
    }).onDelete("cascade"),
    check("inventory_lots_quantity_positive", sql`${t.quantity} > 0`),
    check("inventory_lots_costs_valid", sql`${t.productCost} >= 0 and ${t.landedCost} >= 0`),
    tenantIsolationPolicy("inventory_lots", t.organizationId),
  ],
);

import type { PaymentPlanPart } from "@bookalyze/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, contacts, journalEntries } from "./accounting";
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
    /** Reorder planner: days from ordering to stock that can be sold (else the company's). */
    leadTimeDays: smallint("lead_time_days"),
    /** Reorder planner: the supplier's smallest order, and the units in a carton. */
    minimumOrder: integer("minimum_order"),
    casePack: integer("case_pack"),
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
    check(
      "products_reorder_valid",
      sql`(${t.leadTimeDays} is null or ${t.leadTimeDays} between 0 and 730)
        and (${t.minimumOrder} is null or ${t.minimumOrder} > 0)
        and (${t.casePack} is null or ${t.casePack} > 0)`,
    ),
    tenantIsolationPolicy("products", t.organizationId),
  ],
);

/**
 * A marketplace seller SKU linked to a product: one listing unit is `units` of the product. A
 * bundle (one listing holding several products) is the same SKU linked to each of them.
 */
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
    // One product per SKU, or several when the listing is a bundle.
    unique("product_skus_channel_sku_product_key").on(
      t.organizationId,
      t.channelId,
      t.sku,
      t.productId,
    ),
    index("product_skus_channel_sku_idx").on(t.organizationId, t.channelId, t.sku),
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
    /** How the supplier is to be paid: parts, each a percentage or a fixed amount. */
    paymentPlan: jsonb("payment_plan").$type<PaymentPlanPart[]>().notNull().default([]),
    /** The entry that settled what was left on Supplier deposits once it was all in and paid. */
    settlementEntryId: uuid("settlement_entry_id"),
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
    /** Cost of one, to 10 places so a line total typed in comes back exactly. */
    unitCost: numeric("unit_cost", { precision: 24, scale: 10 }).notNull(),
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
    /** The entry that put it in stock (Dr Inventory / Cr Supplier deposits), when in the books. */
    journalEntryId: uuid("journal_entry_id"),
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
    /** Who it's paid to (a shipping company, a customs broker), when not the supplier. */
    contactId: uuid("contact_id"),
    /**
     * The payment on the order that paid it: its amount, currency and rate come from that
     * payment (what actually left the bank), so the two can't drift apart.
     */
    paymentId: uuid("payment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("purchase_receipt_costs_line_key").on(t.receiptId, t.lineNo),
    unique("purchase_receipt_costs_payment_key").on(t.paymentId),
    foreignKey({
      name: "purchase_receipt_costs_payment_fk",
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [purchasePayments.organizationId, purchasePayments.id],
    }),
    foreignKey({
      name: "purchase_receipt_costs_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
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
 * Purchase orders in the books (phase 5, slice 9): orders dated from `post_from` pay into
 * Supplier deposits and post each delivery's landed cost from it. Earlier orders stay as they
 * were (payments categorised to Inventory by hand).
 */
export const purchaseSettings = pgTable(
  "purchase_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    postFrom: date("post_from").notNull(),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [tenantIsolationPolicy("purchase_settings", t.organizationId)],
);

/**
 * The reorder planner's company defaults: days from ordering to stock that can be sold, and how
 * many days of sales each order should cover.
 */
export const reorderSettings = pgTable(
  "reorder_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadTimeDays: smallint("lead_time_days").notNull(),
    coverDays: smallint("cover_days").notNull(),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "reorder_settings_valid",
      sql`${t.leadTimeDays} between 0 and 730 and ${t.coverDays} between 1 and 730`,
    ),
    tenantIsolationPolicy("reorder_settings", t.organizationId),
  ],
);

/**
 * A payment toward a purchase order: a bank transaction (its journal entry) and how much of it
 * went to this order, in `currency`. Paid to the supplier, or to someone else for a delivery's
 * extra costs (freight, duty…). An entry corrected later carries its payments over; one removed
 * from the books (reversed) no longer counts.
 */
export const purchasePayments = pgTable(
  "purchase_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    /** The delivery whose extra costs it pays, when it isn't paid to the supplier. */
    receiptId: uuid("receipt_id"),
    /** Who was paid. */
    contactId: uuid("contact_id").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    /** "Upfront", "On completion"… */
    label: text("label"),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("purchase_payments_org_id_key").on(t.organizationId, t.id),
    index("purchase_payments_po_idx").on(t.purchaseOrderId),
    index("purchase_payments_entry_idx").on(t.journalEntryId),
    foreignKey({
      name: "purchase_payments_po_fk",
      columns: [t.organizationId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "purchase_payments_receipt_fk",
      columns: [t.organizationId, t.receiptId],
      foreignColumns: [purchaseReceipts.organizationId, purchaseReceipts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "purchase_payments_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }),
    foreignKey({
      name: "purchase_payments_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check("purchase_payments_amount_positive", sql`${t.amount} > 0`),
    tenantIsolationPolicy("purchase_payments", t.organizationId),
  ],
);

/**
 * A FIFO cost layer: the units of one product that arrived in one delivery, at their landed
 * cost in the company's main currency. Rebuilt in place (same id) when the delivery's costs
 * change. Sales will draw on the oldest lots first once cost of goods sold is posted.
 */
export const LOT_SOURCES = ["receipt", "opening", "return", "found", "moved"] as const;

export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    /**
     * "receipt": a delivery line; "opening": stock on hand before Bookalyze; "return" and
     * "found": units customers sent back or Amazon found, added when their month is posted;
     * "moved": units moved here from another product's lot (see `stock_removals`).
     */
    source: text("source", { enum: LOT_SOURCES }).notNull().default("receipt"),
    /** The delivery line it came from (receipt lots only). */
    receiptLineId: uuid("receipt_line_id"),
    /** The entry that put an opening lot in the books (Dr Inventory / Cr Opening balance equity). */
    journalEntryId: uuid("journal_entry_id"),
    /** The month whose posting added a return or found lot (undoing it removes the lot). */
    cogsPeriodId: uuid("cogs_period_id"),
    notes: text("notes"),
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
    check(
      "inventory_lots_source_valid",
      sql`(${t.source} = 'receipt') = (${t.receiptLineId} is not null) and (${t.source} in ('return', 'found')) = (${t.cogsPeriodId} is not null)`,
    ),
    foreignKey({
      name: "inventory_lots_cogs_period_fk",
      columns: [t.organizationId, t.cogsPeriodId],
      foreignColumns: [cogsPeriods.organizationId, cogsPeriods.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "inventory_lots_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check("inventory_lots_costs_valid", sql`${t.productCost} >= 0 and ${t.landedCost} >= 0`),
    tenantIsolationPolicy("inventory_lots", t.organizationId),
  ],
);

/**
 * A month's cost of goods sold on one marketplace: the units shipped that month, costed from the
 * oldest lots, and the entry that posted it (Dr Cost of goods sold / Cr Inventory). Undoing it
 * reverses the entry and deletes the row, which gives its units back to the lots.
 */
export const cogsPeriods = pgTable(
  "cogs_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    /** "2026-09". */
    month: char("month", { length: 7 }).notNull(),
    units: integer("units").notNull(),
    cost: numeric("cost", { precision: 20, scale: 4 }).notNull(),
    /** Customer returns that month (back into stock as return lots, out of cost of goods sold). */
    returnedUnits: integer("returned_units").notNull().default(0),
    returnedCost: numeric("returned_cost", { precision: 20, scale: 4 }).notNull().default("0"),
    /** Net adjustments: lost, damaged or disposed (written off), or found (back into stock). */
    lostUnits: integer("lost_units").notNull().default(0),
    lostCost: numeric("lost_cost", { precision: 20, scale: 4 }).notNull().default("0"),
    foundUnits: integer("found_units").notNull().default(0),
    foundCost: numeric("found_cost", { precision: 20, scale: 4 }).notNull().default("0"),
    currency: char("currency", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    journalEntryId: uuid("journal_entry_id"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("cogs_periods_org_id_key").on(t.organizationId, t.id),
    unique("cogs_periods_channel_month_key").on(t.organizationId, t.channelId, t.month),
    foreignKey({
      name: "cogs_periods_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }),
    foreignKey({
      name: "cogs_periods_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check("cogs_periods_month_valid", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      "cogs_periods_units_valid",
      sql`${t.units} >= 0 and ${t.cost} >= 0 and ${t.returnedUnits} >= 0 and ${t.returnedCost} >= 0 and ${t.lostUnits} >= 0 and ${t.lostCost} >= 0 and ${t.foundUnits} >= 0 and ${t.foundCost} >= 0`,
    ),
    tenantIsolationPolicy("cogs_periods", t.organizationId),
  ],
);

/**
 * Stock you counted yourself, outside the marketplaces' warehouses (with you, at a 3PL): a
 * product, how many, the day. The latest count per product is "at hand" on the Stock page; it
 * doesn't change the books (take units out or add opening stock for that).
 */
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    countedOn: date("counted_on").notNull(),
    quantity: integer("quantity").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_counts_product_idx").on(t.organizationId, t.productId, t.countedOn),
    foreignKey({
      name: "stock_counts_product_fk",
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }).onDelete("cascade"),
    check("stock_counts_quantity_valid", sql`${t.quantity} >= 0`),
    tenantIsolationPolicy("stock_counts", t.organizationId),
  ],
);

/**
 * Units taken out of a lot by hand, not through a marketplace: sold or used outside it, taken by
 * the owner, lost or thrown away. Posted on its day: Dr `account_id` (Owner drawings, Inventory
 * losses and write-offs…) / Cr Inventory at the lot's cost. Or moved to another product (they were
 * that product all along: a mix-up in labels or listings): a new lot there at the same cost
 * (`moved_to_lot_id`), nothing posted (Inventory stays Inventory). Its `lot_consumptions` row (kind
 * "removal") takes the units from the lot; putting it back removes both and reverses the entry.
 */
export const stockRemovals = pgTable(
  "stock_removals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    lotId: uuid("lot_id").notNull(),
    removedOn: date("removed_on").notNull(),
    quantity: integer("quantity").notNull(),
    cost: numeric("cost", { precision: 20, scale: 4 }).notNull(),
    /** Where the cost goes (null for a move to another product). */
    accountId: uuid("account_id"),
    /** A move to another product: the lot it made there, at the same cost. */
    movedToLotId: uuid("moved_to_lot_id"),
    journalEntryId: uuid("journal_entry_id"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("stock_removals_org_id_key").on(t.organizationId, t.id),
    index("stock_removals_lot_idx").on(t.organizationId, t.lotId),
    foreignKey({
      name: "stock_removals_lot_fk",
      columns: [t.organizationId, t.lotId],
      foreignColumns: [inventoryLots.organizationId, inventoryLots.id],
    }),
    foreignKey({
      name: "stock_removals_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    foreignKey({
      name: "stock_removals_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "stock_removals_moved_lot_fk",
      columns: [t.organizationId, t.movedToLotId],
      foreignColumns: [inventoryLots.organizationId, inventoryLots.id],
    }),
    check("stock_removals_quantity_positive", sql`${t.quantity} > 0 and ${t.cost} >= 0`),
    check(
      "stock_removals_target_valid",
      sql`(${t.accountId} is null) <> (${t.movedToLotId} is null)`,
    ),
    tenantIsolationPolicy("stock_removals", t.organizationId),
  ],
);

/**
 * Units taken from one lot, and what they cost: by a month's cost of goods sold (`cogs_period_id`;
 * a sale or a write-off), or by hand (`removal_id`; see `stock_removals`).
 */
export const lotConsumptions = pgTable(
  "lot_consumptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    cogsPeriodId: uuid("cogs_period_id"),
    removalId: uuid("removal_id"),
    lotId: uuid("lot_id").notNull(),
    /**
     * "sale": shipped to a customer; "write_off": lost, damaged or disposed (Amazon's ledger);
     * "removal": taken out by hand.
     */
    kind: text("kind", { enum: ["sale", "write_off", "removal"] })
      .notNull()
      .default("sale"),
    quantity: integer("quantity").notNull(),
    cost: numeric("cost", { precision: 20, scale: 4 }).notNull(),
  },
  (t) => [
    unique("lot_consumptions_period_lot_kind_key").on(t.cogsPeriodId, t.lotId, t.kind),
    check("lot_consumptions_kind_valid", sql`${t.kind} in ('sale', 'write_off', 'removal')`),
    check(
      "lot_consumptions_source_valid",
      sql`(${t.kind} = 'removal' and ${t.removalId} is not null and ${t.cogsPeriodId} is null) or (${t.kind} <> 'removal' and ${t.cogsPeriodId} is not null and ${t.removalId} is null)`,
    ),
    uniqueIndex("lot_consumptions_removal_key").on(t.removalId),
    index("lot_consumptions_lot_idx").on(t.lotId),
    foreignKey({
      name: "lot_consumptions_period_fk",
      columns: [t.organizationId, t.cogsPeriodId],
      foreignColumns: [cogsPeriods.organizationId, cogsPeriods.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "lot_consumptions_removal_fk",
      columns: [t.organizationId, t.removalId],
      foreignColumns: [stockRemovals.organizationId, stockRemovals.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "lot_consumptions_lot_fk",
      columns: [t.organizationId, t.lotId],
      foreignColumns: [inventoryLots.organizationId, inventoryLots.id],
    }),
    check("lot_consumptions_quantity_positive", sql`${t.quantity} > 0 and ${t.cost} >= 0`),
    tenantIsolationPolicy("lot_consumptions", t.organizationId),
  ],
);

/**
 * One row of Amazon's FBA inventory ledger (detailed view): units of a SKU moving in or out of
 * Amazon's stock. Brought in from the Reports API or an uploaded file; `key` keeps a row from
 * coming in twice.
 */
export const inventoryLedgerEvents = pgTable(
  "inventory_ledger_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    eventDate: date("event_date").notNull(),
    sku: text("sku").notNull(),
    fnsku: text("fnsku"),
    asin: text("asin"),
    eventType: text("event_type").notNull(),
    referenceId: text("reference_id"),
    quantity: integer("quantity").notNull(),
    fulfillmentCenter: text("fulfillment_center"),
    disposition: text("disposition"),
    reason: text("reason"),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_ledger_events_channel_key").on(t.organizationId, t.channelId, t.key),
    index("inventory_ledger_events_channel_date_idx").on(
      t.organizationId,
      t.channelId,
      t.eventDate,
    ),
    foreignKey({
      name: "inventory_ledger_events_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("inventory_ledger_events", t.organizationId),
  ],
);

/**
 * Noon's FBN inventory ledger, summary view: per day, warehouse (`location`), seller SKU and
 * condition, the units Noon held at the start and end of the day and each kind of movement. It
 * says what Noon holds now and checks the detailed ledger. A day brought in again replaces the
 * row. The warehouse finds its Noon channel through the detailed ledger's warehouse codes.
 */
export const noonStockDays = pgTable(
  "noon_stock_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The day, or a period report's last day. */
    date: date("date").notNull(),
    /** A period report's first day (opening is that morning's); null for a single day. */
    fromDate: date("from_date"),
    location: text("location").notNull(),
    sku: text("sku").notNull(),
    nfsku: text("nfsku"),
    condition: text("condition").notNull(),
    opening: integer("opening").notNull(),
    closing: integer("closing").notNull(),
    movements: jsonb("movements").$type<Record<string, number>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("noon_stock_days_key").on(t.organizationId, t.date, t.location, t.sku, t.condition),
    index("noon_stock_days_sku_idx").on(t.organizationId, t.sku, t.date),
    tenantIsolationPolicy("noon_stock_days", t.organizationId),
  ],
);

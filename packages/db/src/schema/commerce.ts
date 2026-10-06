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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, journalEntries } from "./accounting";
import { organization, user } from "./auth";
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
    /** Promised delivery dates: Amazon's review request window hangs off them. */
    earliestDelivery: date("earliest_delivery"),
    latestDelivery: date("latest_delivery"),
    /** When its items were last fetched; cleared when the order changes. */
    itemsSyncedAt: timestamp("items_synced_at", { withTimezone: true }),
    /** Given back to the buyer so far (the sum of its refunds); null when never refunded. */
    refunded: numeric("refunded", { precision: 20, scale: 4 }),
    lastRefundAt: timestamp("last_refund_at", { withTimezone: true }),
    /**
     * Whether Amazon offered "Request a Review" for the order when last asked (null: not asked
     * yet). Amazon is the judge of eligibility; FBA orders have no delivery dates to go by.
     */
    reviewEligible: boolean("review_eligible"),
    reviewCheckedAt: timestamp("review_checked_at", { withTimezone: true }),
    /** A replacement order's original (Amazon's ReplacedOrderId). */
    replacedOrderId: text("replaced_order_id"),
    /** An A-to-z claim or a chargeback on the order (core `BuyerClaim`), when one was found. */
    buyerClaim: text("buyer_claim"),
    /** When the order's own financial events (refunds, claims) were last read. */
    financeCheckedAt: timestamp("finance_checked_at", { withTimezone: true }),
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

/**
 * Automatic review requests: one row per company (see core `ReviewSettings`). No row means
 * they're off.
 */
export const reviewSettings = pgTable(
  "review_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    daysAfterDelivery: integer("days_after_delivery").notNull().default(7),
    sendHour: integer("send_hour").notNull().default(10),
    sendDays: integer("send_days").array().notNull().default(sql`'{0,1,2,3,4,5,6}'`),
    /** Only these marketplaces; null means all. */
    channelIds: uuid("channel_ids").array(),
    fulfillment: text("fulfillment", { enum: ["all", "amazon", "merchant"] })
      .notNull()
      .default("all"),
    skipRefunded: boolean("skip_refunded").notNull().default(true),
    skipReplacements: boolean("skip_replacements").notNull().default(true),
    skipBusiness: boolean("skip_business").notNull().default(false),
    skipPromotions: boolean("skip_promotions").notNull().default(false),
    excludedSkus: text("excluded_skus").array().notNull().default(sql`'{}'`),
    startsFrom: date("starts_from"),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("review_settings_days_valid", sql`${t.daysAfterDelivery} between 5 and 25`),
    check("review_settings_hour_valid", sql`${t.sendHour} between 0 and 23`),
    check(
      "review_settings_fulfillment_valid",
      sql`${t.fulfillment} in ('all', 'amazon', 'merchant')`,
    ),
    tenantIsolationPolicy("review_settings", t.organizationId),
  ],
);

/**
 * A review request for an order: scheduled, sent, skipped (refunded, or someone chose not to),
 * not eligible (Amazon said no) or failed. One per order, as Amazon allows one per order.
 */
export const reviewRequests = pgTable(
  "review_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    status: text("status", {
      enum: ["scheduled", "sent", "skipped", "not_eligible", "failed"],
    }).notNull(),
    source: text("source", { enum: ["auto", "manual", "bulk"] }).notNull(),
    /** When a scheduled request goes out. */
    dueAt: timestamp("due_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Why it was skipped, not eligible or failed, in plain words. */
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    requestedBy: uuid("requested_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("review_requests_order_key").on(t.orderId),
    index("review_requests_due_idx").on(t.status, t.dueAt),
    index("review_requests_org_status_idx").on(t.organizationId, t.status),
    foreignKey({
      name: "review_requests_order_fk",
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("cascade"),
    check(
      "review_requests_status_valid",
      sql`${t.status} in ('scheduled', 'sent', 'skipped', 'not_eligible', 'failed')`,
    ),
    check("review_requests_source_valid", sql`${t.source} in ('auto', 'manual', 'bulk')`),
    tenantIsolationPolicy("review_requests", t.organizationId),
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

/**
 * An Amazon settlement: one period's payout (sales, refunds, fees, reserve) as Amazon's
 * settlement report has it. Nothing here posts to the books yet.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    /** The marketplace it's for, when one of the company's channels matches. */
    channelId: uuid("channel_id"),
    /** Amazon's settlement ID. */
    externalId: text("external_id").notNull(),
    /** The report it came from (null when uploaded). */
    reportId: text("report_id"),
    source: text("source", { enum: ["amazon", "upload"] }).notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    depositDate: date("deposit_date"),
    total: numeric("total", { precision: 20, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    marketplace: text("marketplace"),
    orderCount: integer("order_count").notNull().default(0),
    /** The lines add up to the total. */
    balanced: boolean("balanced").notNull(),
    /** The journal entry it posted as (null: not in the books). */
    journalEntryId: uuid("journal_entry_id"),
    /**
     * The bank deposit of its payout, once matched: the deposit as it is now (moved to the
     * clearing account), and as it was before (put back on unmatch).
     */
    depositEntryId: uuid("deposit_entry_id"),
    depositOriginalEntryId: uuid("deposit_original_entry_id"),
    /**
     * Set when posted: the main-currency units per settlement unit it posted at ("1" in the
     * main currency), and the payout's main-currency value, which its deposit has to clear.
     */
    postedFxRate: numeric("posted_fx_rate", { precision: 20, scale: 10 }),
    payoutBaseAmount: numeric("payout_base_amount", { precision: 20, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("settlements_org_id_key").on(t.organizationId, t.id),
    foreignKey({
      name: "settlements_journal_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "settlements_deposit_entry_fk",
      columns: [t.organizationId, t.depositEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "settlements_deposit_original_entry_fk",
      columns: [t.organizationId, t.depositOriginalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    unique("settlements_org_external_key").on(t.organizationId, t.externalId),
    index("settlements_org_end_idx").on(t.organizationId, t.endAt),
    foreignKey({
      name: "settlements_connection_fk",
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [connections.organizationId, connections.id],
    }),
    foreignKey({
      name: "settlements_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }),
    check("settlements_source_valid", sql`${t.source} in ('amazon', 'upload')`),
    tenantIsolationPolicy("settlements", t.organizationId),
  ],
);

/** A settlement's amounts, summed by kind (transaction type, amount type, description). */
export const settlementLines = pgTable(
  "settlement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    settlementId: uuid("settlement_id").notNull(),
    transactionType: text("transaction_type").notNull(),
    amountType: text("amount_type").notNull(),
    amountDescription: text("amount_description").notNull(),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    unique("settlement_lines_kind_key").on(
      t.settlementId,
      t.transactionType,
      t.amountType,
      t.amountDescription,
    ),
    foreignKey({
      name: "settlement_lines_settlement_fk",
      columns: [t.organizationId, t.settlementId],
      foreignColumns: [settlements.organizationId, settlements.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("settlement_lines", t.organizationId),
  ],
);

/**
 * How settlements post: the account for each kind of line (core `SettlementAccountKey`: sales,
 * fees, …, and the clearing account the payout goes to), one row per kind.
 */
export const settlementAccounts = pgTable(
  "settlement_accounts",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    accountId: uuid("account_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.key] }),
    foreignKey({
      name: "settlement_accounts_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    tenantIsolationPolicy("settlement_accounts", t.organizationId),
  ],
);

/** When settlements start posting: those ending before stay out (the books have them already). */
export const settlementSettings = pgTable(
  "settlement_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    postFrom: date("post_from").notNull(),
    /** The daily job posts new settlements and matches deposits that fit exactly. */
    autoPost: boolean("auto_post").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [tenantIsolationPolicy("settlement_settings", t.organizationId)],
);

/** Bank deposits someone said aren't a settlement's payout, so they aren't suggested again. */
export const settlementDepositDismissals = pgTable(
  "settlement_deposit_dismissals",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    settlementId: uuid("settlement_id").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.settlementId, t.journalEntryId] }),
    foreignKey({
      name: "settlement_deposit_dismissals_settlement_fk",
      columns: [t.organizationId, t.settlementId],
      foreignColumns: [settlements.organizationId, settlements.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "settlement_deposit_dismissals_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("settlement_deposit_dismissals", t.organizationId),
  ],
);

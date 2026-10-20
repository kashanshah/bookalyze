import type { ListingObservation, OrderInvoice } from "@bookalyze/core";
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
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, journalEntries } from "./accounting";
import { organization, user } from "./auth";
import { connections } from "./banking";
import { tenantIsolationPolicy } from "./tenancy";

export const CHANNEL_KINDS = ["amazon", "noon", "ebay", "walmart"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Who ships a channel's orders: the marketplace (FBA, FBN), the seller (FBM, FBP), or both. */
export const CHANNEL_FULFILMENT = ["marketplace", "seller", "both"] as const;

/**
 * Where the company sells: one row per Amazon marketplace of a connected seller account, and
 * one per Noon country, eBay site or Walmart country the company adds (with no connection until that account's
 * API is connected). Orders, review requests and settlements hang off it.
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
    /** Amazon's marketplace ID (e.g. A2EUQ1WTGCTBG2), core's Noon key (e.g. noon-ae), eBay's
     * marketplace id (e.g. EBAY_US), or core's Walmart key (e.g. walmart-us). */
    marketplaceId: text("marketplace_id"),
    country: char("country", { length: 2 }),
    currency: char("currency", { length: 3 }).notNull(),
    /** Who ships its orders (Noon and Walmart channels; null: not said). */
    fulfilment: text("fulfilment", { enum: CHANNEL_FULFILMENT }),
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
    /** When the marketplace's SKUs (its FBA inventory) were last brought in. */
    skusSyncedAt: timestamp("skus_synced_at", { withTimezone: true }),
    /** Amazon's FBA inventory ledger is in through this day. */
    ledgerSyncedThrough: date("ledger_synced_through"),
    /** A ledger report asked of Amazon and not downloaded yet, with the days it covers. */
    ledgerReportId: text("ledger_report_id"),
    ledgerReportFrom: date("ledger_report_from"),
    ledgerReportTo: date("ledger_report_to"),
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
    // One channel per Noon country per company.
    uniqueIndex("sales_channels_noon_marketplace_key")
      .on(t.organizationId, t.marketplaceId)
      .where(sql`${t.kind} = 'noon'`),
    // One channel per eBay site per company.
    uniqueIndex("sales_channels_ebay_marketplace_key")
      .on(t.organizationId, t.marketplaceId)
      .where(sql`${t.kind} = 'ebay'`),
    // One channel per Walmart country per company.
    uniqueIndex("sales_channels_walmart_marketplace_key")
      .on(t.organizationId, t.marketplaceId)
      .where(sql`${t.kind} = 'walmart'`),
    check("sales_channels_kind_valid", sql`${t.kind} in ('amazon', 'noon', 'ebay', 'walmart')`),
    check(
      "sales_channels_fulfilment_valid",
      sql`${t.fulfilment} is null or ${t.fulfilment} in ('marketplace', 'seller', 'both')`,
    ),
    tenantIsolationPolicy("sales_channels", t.organizationId),
  ],
);

/**
 * A seller SKU the marketplace lists for the company (from its FBA inventory), sold or not, so
 * every variation can be linked to a product before its first order.
 */
export const channelSkus = pgTable(
  "channel_skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    title: text("title"),
    /** Units Amazon holds that can be sold, when last seen. */
    fulfillable: integer("fulfillable"),
    /** Reserved (customer orders, moves between warehouses, processing), when last seen. */
    reserved: integer("reserved"),
    /** On their way in (working, shipped, being received), when last seen. */
    inbound: integer("inbound"),
    /** Damaged, defective or expired, when last seen. */
    unfulfillable: integer("unfulfillable"),
    /** Being looked for (lost or misplaced), when last seen. */
    researching: integer("researching"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("channel_skus_channel_sku_key").on(t.channelId, t.sku),
    index("channel_skus_org_idx").on(t.organizationId),
    foreignKey({
      name: "channel_skus_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    check("channel_skus_sku_present", sql`length(trim(${t.sku})) > 0`),
    tenantIsolationPolicy("channel_skus", t.organizationId),
  ],
);

/**
 * An order on a sales channel, as the marketplace reports it (kept up to date by the sync).
 * Orders don't post to the books: settlements do. Buyer name and tax number are not kept here;
 * a customer invoice may store them for that document only.
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
    /** Free or reduced shipping (positive). Null on items synced before it was kept. */
    shippingDiscount: numeric("shipping_discount", { precision: 20, scale: 4 }),
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

/**
 * A product someone asked us to watch on one marketplace. The snapshot (`observed`) is the last
 * look Amazon gave us; changes hang off `listing_changes`. Nothing here posts to the books.
 */
export const listingWatches = pgTable(
  "listing_watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    /** Amazon's ASIN, upper case. */
    asin: text("asin").notNull(),
    title: text("title"),
    imageUrl: text("image_url"),
    /** Which signals to compare. See core `LISTING_CHECKS`. */
    checks: text("checks").array().notNull(),
    cadence: text("cadence", { enum: ["hourly", "daily", "weekly"] }).notNull(),
    /** Owners and admins get an email when a check finds a change. */
    notify: boolean("notify").notNull().default(true),
    /** Up to two more people emailed about this product's changes (lower case). */
    notifyEmails: text("notify_emails").array().notNull().default(sql`'{}'::text[]`),
    paused: boolean("paused").notNull().default(false),
    observed: jsonb("observed").$type<ListingObservation | null>(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    lastChangeSummary: text("last_change_summary"),
    lastChangeAt: timestamp("last_change_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("listing_watches_org_id_key").on(t.organizationId, t.id),
    unique("listing_watches_channel_asin_key").on(t.organizationId, t.channelId, t.asin),
    index("listing_watches_org_idx").on(t.organizationId),
    index("listing_watches_due_idx").on(t.paused, t.nextCheckAt),
    foreignKey({
      name: "listing_watches_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    check("listing_watches_cadence_valid", sql`${t.cadence} in ('hourly', 'daily', 'weekly')`),
    check("listing_watches_notify_emails_max", sql`cardinality(${t.notifyEmails}) <= 2`),
    check("listing_watches_asin_valid", sql`${t.asin} ~ '^[A-Z0-9]{10}$'`),
    check(
      "listing_watches_checks_valid",
      sql`cardinality(${t.checks}) > 0 and ${t.checks} <@ array['content','images','price','featured','offers','rank','reviews']::text[]`,
    ),
    check(
      "listing_watches_hourly_valid",
      sql`${t.cadence} <> 'hourly' or ${t.checks} <@ array['price','featured','offers']::text[]`,
    ),
    tenantIsolationPolicy("listing_watches", t.organizationId),
  ],
);

/** One thing that changed between two looks at a watched product. */
export const listingChanges = pgTable(
  "listing_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    watchId: uuid("watch_id").notNull(),
    field: text("field").notNull(),
    summary: text("summary").notNull(),
    before: text("before"),
    after: text("after"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    /** Set once the change has been included in an email, or immediately when email is off. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    index("listing_changes_watch_idx").on(t.watchId, t.checkedAt),
    index("listing_changes_unnotified_idx").on(t.organizationId, t.notifiedAt),
    foreignKey({
      name: "listing_changes_watch_fk",
      columns: [t.organizationId, t.watchId],
      foreignColumns: [listingWatches.organizationId, listingWatches.id],
    }).onDelete("cascade"),
    check(
      "listing_changes_field_valid",
      sql`${t.field} in ('content', 'images', 'price', 'featured', 'offers', 'rank', 'reviews')`,
    ),
    tenantIsolationPolicy("listing_changes", t.organizationId),
  ],
);

/**
 * A customer invoice for one order: the PDF a buyer asked for. It does not post to the books.
 * The snapshot is the document as issued (including the buyer's name and tax number). Email is
 * never stored. One current invoice per order; correcting it keeps the number.
 */
export const orderInvoices = pgTable(
  "order_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    /** Sequential per organization, shown as "INV-0001". */
    invoiceNumber: integer("invoice_number").notNull(),
    title: text("title").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    snapshot: jsonb("snapshot").$type<OrderInvoice>().notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    /** When it was last sent to the buyer through Amazon's invoice message. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: uuid("sent_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("order_invoices_org_id_key").on(t.organizationId, t.id),
    unique("order_invoices_org_number_key").on(t.organizationId, t.invoiceNumber),
    unique("order_invoices_order_key").on(t.organizationId, t.orderId),
    unique("order_invoices_storage_key_key").on(t.storageKey),
    index("order_invoices_order_idx").on(t.organizationId, t.orderId),
    foreignKey({
      name: "order_invoices_order_fk",
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("cascade"),
    check("order_invoices_number_positive", sql`${t.invoiceNumber} > 0`),
    check("order_invoices_title_valid", sql`${t.title} in ('Invoice', 'Tax invoice')`),
    tenantIsolationPolicy("order_invoices", t.organizationId),
  ],
);

/**
 * The company's private address for forwarded marketplace emails (invoice requests):
 * `invoices-<token>@<INBOUND_EMAIL_DOMAIN>`. The token is the only key the inbound webhook
 * has, so it's long and random. The latest email that wasn't an invoice request is kept by its
 * subject, so a mailbox's forwarding confirmation code can be read in the app.
 */
export const invoiceInboxes = pgTable(
  "invoice_inboxes",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    lastOtherSubject: text("last_other_subject"),
    lastOtherFrom: text("last_other_from"),
    lastOtherAt: timestamp("last_other_at", { withTimezone: true }),
    lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invoice_inboxes_token_key").on(t.token),
    check("invoice_inboxes_token_valid", sql`${t.token} ~ '^[a-z0-9]{20,64}$'`),
    tenantIsolationPolicy("invoice_inboxes", t.organizationId),
  ],
);

export const INVOICE_REQUEST_STATUSES = ["open", "done", "dismissed"] as const;

/**
 * A buyer asking for an invoice, learned from a forwarded marketplace email (or added by hand).
 * One row per order: a repeat request opens it again. The order is matched by its number when
 * it has synced; until then `order_id` is null and the number is shown. Removing the order
 * (with its channel) removes the request.
 */
export const invoiceRequests = pgTable(
  "invoice_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    externalOrderId: text("external_order_id").notNull(),
    orderId: uuid("order_id"),
    /** As the marketplace names them in the email (often a first name only). */
    buyerName: text("buyer_name"),
    source: text("source").notNull().default("email"),
    status: text("status").notNull().default("open"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("invoice_requests_order_key").on(t.organizationId, t.externalOrderId),
    index("invoice_requests_status_idx").on(t.organizationId, t.status),
    foreignKey({
      name: "invoice_requests_order_fk",
      columns: [t.organizationId, t.orderId],
      foreignColumns: [orders.organizationId, orders.id],
    }).onDelete("cascade"),
    check("invoice_requests_status_valid", sql`${t.status} in ('open', 'done', 'dismissed')`),
    check("invoice_requests_source_valid", sql`${t.source} in ('email', 'manual')`),
    tenantIsolationPolicy("invoice_requests", t.organizationId),
  ],
);

/**
 * A row of Noon's item-level transaction view: a sale, update, fee, refund or subsidy, on the
 * Noon channel of its currency. Amounts include VAT; `total` is what the row adds to (or takes
 * from) the payouts. Kept one by one (Noon gives no payout number) and keyed so bringing the same
 * rows in again changes nothing but their amounts.
 */
export const noonTransactions = pgTable(
  "noon_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    key: text("key").notNull(),
    contract: text("contract"),
    referenceNr: text("reference_nr").notNull(),
    orderNr: text("order_nr"),
    itemNr: text("item_nr"),
    orderDate: date("order_date"),
    transactionDate: date("transaction_date").notNull(),
    title: text("title"),
    sku: text("sku"),
    partnerSku: text("partner_sku"),
    transactionType: text("transaction_type").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    netProceeds: numeric("net_proceeds", { precision: 20, scale: 4 }).notNull(),
    referralFee: numeric("referral_fee", { precision: 20, scale: 4 }).notNull(),
    fulfilmentFee: numeric("fulfilment_fee", { precision: 20, scale: 4 }).notNull(),
    shippingCredits: numeric("shipping_credits", { precision: 20, scale: 4 }).notNull(),
    otherOrderFees: numeric("other_order_fees", { precision: 20, scale: 4 }).notNull(),
    orderSubsidies: numeric("order_subsidies", { precision: 20, scale: 4 }).notNull(),
    nonOrderFees: numeric("non_order_fees", { precision: 20, scale: 4 }).notNull(),
    nonOrderSubsidies: numeric("non_order_subsidies", { precision: 20, scale: 4 }).notNull(),
    others: numeric("others", { precision: 20, scale: 4 }).notNull(),
    total: numeric("total", { precision: 20, scale: 4 }).notNull(),
    /** The money columns add up to `total`. */
    balanced: boolean("balanced").notNull(),
    source: text("source", { enum: ["api", "upload"] }).notNull(),
    /**
     * A payment row's bank deposit, once matched: the deposit as it is now (moved to the Noon
     * balance account), and as it was before (put back on unmatch).
     */
    depositEntryId: uuid("deposit_entry_id"),
    depositOriginalEntryId: uuid("deposit_original_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("noon_transactions_org_id_key").on(t.organizationId, t.id),
    unique("noon_transactions_channel_key").on(t.organizationId, t.channelId, t.key),
    foreignKey({
      name: "noon_transactions_deposit_entry_fk",
      columns: [t.organizationId, t.depositEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "noon_transactions_deposit_original_entry_fk",
      columns: [t.organizationId, t.depositOriginalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    index("noon_transactions_channel_date_idx").on(
      t.organizationId,
      t.channelId,
      t.transactionDate,
    ),
    foreignKey({
      name: "noon_transactions_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    check("noon_transactions_source_valid", sql`${t.source} in ('api', 'upload')`),
    tenantIsolationPolicy("noon_transactions", t.organizationId),
  ],
);

/**
 * A Noon country's month in the books (phase 4c, slice 4): one entry, and what it held when
 * posted (`earned`, `rows`), so later changes to Noon's rows show as "changed since posted". It
 * counts as posted while its entry isn't reversed.
 */
export const noonPeriods = pgTable(
  "noon_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    /** "2026-09". */
    month: char("month", { length: 7 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    earned: numeric("earned", { precision: 20, scale: 4 }).notNull(),
    rows: integer("rows").notNull(),
    journalEntryId: uuid("journal_entry_id"),
    /** Main-currency units per one unit of the month's currency ("1" in the main currency). */
    postedFxRate: numeric("posted_fx_rate", { precision: 20, scale: 10 }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("noon_periods_channel_month_key").on(t.organizationId, t.channelId, t.month),
    foreignKey({
      name: "noon_periods_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "noon_periods_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check("noon_periods_month_valid", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    tenantIsolationPolicy("noon_periods", t.organizationId),
  ],
);

/** The account each kind of Noon amount posts to (core `NOON_ACCOUNT_KEYS`). */
export const noonAccounts = pgTable(
  "noon_accounts",
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
      name: "noon_accounts_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    tenantIsolationPolicy("noon_accounts", t.organizationId),
  ],
);

/** When Noon starts posting (the first day of a month): earlier months stay out of the books. */
export const noonSettings = pgTable(
  "noon_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    postFrom: date("post_from").notNull(),
    /** The daily job posts finished months and matches payouts that fit one deposit exactly. */
    autoPost: boolean("auto_post").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [tenantIsolationPolicy("noon_settings", t.organizationId)],
);

/** Bank deposits someone said aren't a Noon payout, so they aren't suggested for it again. */
export const noonDepositDismissals = pgTable(
  "noon_deposit_dismissals",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.journalEntryId] }),
    foreignKey({
      name: "noon_deposit_dismissals_transaction_fk",
      columns: [t.organizationId, t.transactionId],
      foreignColumns: [noonTransactions.organizationId, noonTransactions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "noon_deposit_dismissals_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("noon_deposit_dismissals", t.organizationId),
  ],
);

/**
 * A row of eBay's Finances API (phase 4d, slice 4): a sale, refund, fee, shipping label, credit
 * or transfer on the seller's eBay account, in the account's payout currency. `amount` is signed
 * (what the row added to or took from the eBay balance); `fees` is eBay's fees on it (positive).
 * Each row sits on the eBay site of its order when known, else the site in its currency. Kept
 * one by one, keyed by eBay's id and type, so bringing rows in again only updates them.
 */
export const ebayTransactions = pgTable(
  "ebay_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    transactionId: text("transaction_id").notNull(),
    transactionType: text("transaction_type").notNull(),
    status: text("status"),
    transactionAt: timestamp("transaction_at", { withTimezone: true }).notNull(),
    /** The UTC day of `transaction_at`, which months are counted by. */
    transactionDate: date("transaction_date").notNull(),
    orderId: text("order_id"),
    payoutId: text("payout_id"),
    feeType: text("fee_type"),
    currency: char("currency", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    fees: numeric("fees", { precision: 20, scale: 4 }).notNull(),
    ebayTax: numeric("ebay_tax", { precision: 20, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ebay_transactions_org_id_key").on(t.organizationId, t.id),
    unique("ebay_transactions_ebay_key").on(t.organizationId, t.transactionId, t.transactionType),
    index("ebay_transactions_channel_date_idx").on(
      t.organizationId,
      t.channelId,
      t.transactionDate,
    ),
    index("ebay_transactions_order_idx").on(t.organizationId, t.orderId),
    foreignKey({
      name: "ebay_transactions_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("ebay_transactions", t.organizationId),
  ],
);

/**
 * An eBay payout (phase 4d, slice 5): eBay sending the seller's balance to the bank. Matched to
 * its bank deposit, which then moves out of the eBay balance: the deposit as it is now and as it
 * was before (put back on unmatch).
 */
export const ebayPayouts = pgTable(
  "ebay_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    payoutId: text("payout_id").notNull(),
    /** INITIATED, SUCCEEDED, RETRYABLE_FAILED, TERMINAL_FAILED, REVERSED. */
    status: text("status").notNull(),
    payoutAt: timestamp("payout_at", { withTimezone: true }).notNull(),
    payoutDate: date("payout_date").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    accountLast4: text("account_last4"),
    depositEntryId: uuid("deposit_entry_id"),
    depositOriginalEntryId: uuid("deposit_original_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ebay_payouts_org_id_key").on(t.organizationId, t.id),
    unique("ebay_payouts_ebay_key").on(t.organizationId, t.payoutId),
    foreignKey({
      name: "ebay_payouts_deposit_entry_fk",
      columns: [t.organizationId, t.depositEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    foreignKey({
      name: "ebay_payouts_deposit_original_entry_fk",
      columns: [t.organizationId, t.depositOriginalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    tenantIsolationPolicy("ebay_payouts", t.organizationId),
  ],
);

/**
 * An eBay site's month in the books: one entry, and what it held when posted (`net`, `rows`), so
 * later changes to eBay's rows show as "changed since posted". Posted while its entry isn't
 * reversed.
 */
export const ebayPeriods = pgTable(
  "ebay_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    /** "2026-09". */
    month: char("month", { length: 7 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    net: numeric("net", { precision: 20, scale: 4 }).notNull(),
    rows: integer("rows").notNull(),
    journalEntryId: uuid("journal_entry_id"),
    /** Main-currency units per one unit of the month's currency ("1" in the main currency). */
    postedFxRate: numeric("posted_fx_rate", { precision: 20, scale: 10 }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ebay_periods_channel_month_key").on(t.organizationId, t.channelId, t.month),
    foreignKey({
      name: "ebay_periods_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ebay_periods_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }),
    check("ebay_periods_month_valid", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    tenantIsolationPolicy("ebay_periods", t.organizationId),
  ],
);

/** The account each kind of eBay amount posts to (core `EBAY_ACCOUNT_KEYS`). */
export const ebayAccounts = pgTable(
  "ebay_accounts",
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
      name: "ebay_accounts_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    tenantIsolationPolicy("ebay_accounts", t.organizationId),
  ],
);

/** When eBay starts posting (the first day of a month), and whether the daily job posts. */
export const ebaySettings = pgTable(
  "ebay_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    postFrom: date("post_from").notNull(),
    autoPost: boolean("auto_post").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [tenantIsolationPolicy("ebay_settings", t.organizationId)],
);

/** Bank deposits someone said aren't an eBay payout, so they aren't suggested for it again. */
export const ebayDepositDismissals = pgTable(
  "ebay_deposit_dismissals",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    payoutId: uuid("payout_id").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.payoutId, t.journalEntryId] }),
    foreignKey({
      name: "ebay_deposit_dismissals_payout_fk",
      columns: [t.organizationId, t.payoutId],
      foreignColumns: [ebayPayouts.organizationId, ebayPayouts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ebay_deposit_dismissals_entry_fk",
      columns: [t.organizationId, t.journalEntryId],
      foreignColumns: [journalEntries.organizationId, journalEntries.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("ebay_deposit_dismissals", t.organizationId),
  ],
);

/**
 * A marketplace SKU's price as Amazon last reported it (Inventory → Prices), with what a price
 * change needs: the listing's product type and its whole current offer.
 */
export const listingPrices = pgTable(
  "listing_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    sku: text("sku").notNull(),
    /** Null when the listing has no price (e.g. not set up for sale yet). */
    price: numeric("price", { precision: 20, scale: 4 }),
    currency: char("currency", { length: 3 }),
    productType: text("product_type"),
    /** Amazon's words for it, e.g. BUYABLE, DISCOVERABLE. */
    status: text("status").array().notNull().default(sql`'{}'::text[]`),
    /** The listing's offer for the marketplace, as Amazon holds it. */
    offer: jsonb("offer").$type<Record<string, unknown>>(),
    /** Amazon's error-level issues on the listing, in its words. */
    problems: text("problems").array().notNull().default(sql`'{}'::text[]`),
    /** False when Amazon didn't know the SKU when last asked. */
    found: boolean("found").notNull().default(true),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("listing_prices_org_id_key").on(t.organizationId, t.id),
    unique("listing_prices_channel_sku_key").on(t.organizationId, t.channelId, t.sku),
    foreignKey({
      name: "listing_prices_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("listing_prices", t.organizationId),
  ],
);

export const PRICE_CHANGE_STATUSES = ["sent", "applied", "refused"] as const;
export type PriceChangeStatus = (typeof PRICE_CHANGE_STATUSES)[number];

/**
 * A price change sent to Amazon from Bookalyze: "sent" (Amazon accepted it and applies it within
 * minutes), "applied" (the listing shows the new price) or "refused" (with Amazon's reason).
 */
export const priceChanges = pgTable(
  "price_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    sku: text("sku").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    oldPrice: numeric("old_price", { precision: 20, scale: 4 }),
    newPrice: numeric("new_price", { precision: 20, scale: 4 }).notNull(),
    status: text("status", { enum: PRICE_CHANGE_STATUSES }).notNull(),
    submissionId: text("submission_id"),
    /** Amazon's reason, when it refused. */
    message: text("message"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the listing was last read to see whether the change is live. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [
    unique("price_changes_org_id_key").on(t.organizationId, t.id),
    index("price_changes_channel_sku_idx").on(t.organizationId, t.channelId, t.sku),
    foreignKey({
      name: "price_changes_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    check("price_changes_status_valid", sql`${t.status} in ('sent', 'applied', 'refused')`),
    check("price_changes_price_positive", sql`${t.newPrice} > 0`),
    tenantIsolationPolicy("price_changes", t.organizationId),
  ],
);

/**
 * Channel profit's own costs: an expense category from the books counted against a sales
 * channel (`channelId`), or as shared (`channelId` null: under "All channels" only). Categories
 * not listed aren't in the report.
 */
export const channelCostAccounts = pgTable(
  "channel_cost_accounts",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    channelId: uuid("channel_id"),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.accountId] }),
    foreignKey({
      name: "channel_cost_accounts_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "channel_cost_accounts_channel_fk",
      columns: [t.organizationId, t.channelId],
      foreignColumns: [salesChannels.organizationId, salesChannels.id],
    }).onDelete("cascade"),
    tenantIsolationPolicy("channel_cost_accounts", t.organizationId),
  ],
);

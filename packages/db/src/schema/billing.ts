import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { currentOrgId } from "./tenancy";

/**
 * Billing (Stripe). A company's members may read these rows; only `withBillingWriter()` (the
 * Stripe webhook, and Checkout recording the customer) may write them, so nobody can give their
 * company a plan from inside the app.
 */

const billingWriter = sql`current_setting('app.billing_writer', true) = 'on'`;

function billingPolicies(name: string, orgColumn: AnyPgColumn) {
  const tenant: SQL = sql`${orgColumn} = ${currentOrgId}`;
  const writer: SQL = sql`${orgColumn} = ${currentOrgId} and ${billingWriter}`;
  return [
    pgPolicy(`${name}_read`, { as: "permissive", for: "select", using: tenant }),
    pgPolicy(`${name}_insert`, { as: "permissive", for: "insert", withCheck: writer }),
    pgPolicy(`${name}_update`, {
      as: "permissive",
      for: "update",
      using: writer,
      withCheck: writer,
    }),
    pgPolicy(`${name}_delete`, { as: "permissive", for: "delete", using: writer }),
  ];
}

export const SUBSCRIPTION_ITEM_KEYS = [
  "books",
  "seller",
  "seller_plus",
  "reviews_only",
  "stock",
  "reviews",
] as const;

/** One row per company that has started Checkout: its Stripe customer. */
export const billingAccounts = pgTable(
  "billing_accounts",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    /**
     * When billing starts for this company, if not the global BILLING_STARTS_ON (set by the
     * platform owner, e.g. for a company that wants to pay before everyone else).
     */
    startsOn: date("starts_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("billing_accounts_customer_key").on(t.stripeCustomerId),
    ...billingPolicies("billing_accounts", t.organizationId),
  ],
);

/** The company's Stripe subscription, as the webhook last reported it. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    /** Stripe's status: active, trialing, past_due, unpaid, canceled, incomplete… */
    status: text("status").notNull(),
    interval: text("interval").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** The last failed payment, cleared when one succeeds. */
    paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
    /** Stripe's event time of the last change applied, so an older event can't undo a newer one. */
    stripeUpdatedAt: timestamp("stripe_updated_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("subscriptions_stripe_key").on(t.stripeSubscriptionId),
    check("subscriptions_interval_valid", sql`${t.interval} in ('month', 'year')`),
    ...billingPolicies("subscriptions", t.organizationId),
  ],
);

/** What the subscription pays for: a package and any add-ons. */
export const subscriptionItems = pgTable(
  "subscription_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    itemKey: text("item_key").notNull(),
    stripeItemId: text("stripe_item_id").notNull(),
    stripePriceId: text("stripe_price_id").notNull(),
  },
  (t) => [
    foreignKey({
      name: "subscription_items_subscription_fk",
      columns: [t.organizationId],
      foreignColumns: [subscriptions.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("subscription_items_key").on(t.organizationId, t.itemKey),
    check(
      "subscription_items_key_valid",
      sql`${t.itemKey} in ('books', 'seller', 'seller_plus', 'reviews_only', 'stock', 'reviews')`,
    ),
    ...billingPolicies("subscription_items", t.organizationId),
  ],
);

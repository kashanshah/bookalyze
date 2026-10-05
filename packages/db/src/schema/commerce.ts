import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
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

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { tenantIsolationPolicy } from "./tenancy";

export const ATTACHMENT_STATUSES = ["pending", "ready"] as const;
export const ATTACHMENT_ENTITY_TYPES = ["journal_entry"] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

/**
 * Uploaded files (receipts, invoices, statements). The bytes live in object storage under
 * `storage_key`; this row is the metadata. An attachment with no links sits in the receipts inbox.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** "pending" until the browser's upload is confirmed, then "ready". */
    status: text("status", { enum: ATTACHMENT_STATUSES }).notNull().default("pending"),
    uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("attachments_org_id_key").on(t.organizationId, t.id),
    unique("attachments_storage_key_key").on(t.storageKey),
    index("attachments_org_created_idx").on(t.organizationId, t.createdAt),
    check("attachments_size_positive", sql`${t.sizeBytes} > 0`),
    check("attachments_status_valid", sql`${t.status} in ('pending', 'ready')`),
    tenantIsolationPolicy("attachments", t.organizationId),
  ],
);

/**
 * Which records a file is attached to. One file can be linked to several records (one invoice
 * covering two payments) and a record can have many files.
 */
export const attachmentLinks = pgTable(
  "attachment_links",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id").notNull(),
    entityType: text("entity_type", { enum: ATTACHMENT_ENTITY_TYPES }).notNull(),
    entityId: uuid("entity_id").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.attachmentId, t.entityType, t.entityId] }),
    foreignKey({
      name: "attachment_links_attachment_fk",
      columns: [t.organizationId, t.attachmentId],
      foreignColumns: [attachments.organizationId, attachments.id],
    }).onDelete("cascade"),
    index("attachment_links_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    check("attachment_links_entity_type_valid", sql`${t.entityType} in ('journal_entry')`),
    tenantIsolationPolicy("attachment_links", t.organizationId),
  ],
);

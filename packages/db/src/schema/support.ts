import { type SQL, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { currentOrgId } from "./tenancy";

/**
 * Help & support: tickets opened from the app (a company's) or from the website's contact form
 * (no company), and the messages on them. A company's members see its tickets; the support desk
 * (platform admins, the website intake and email replies) sees every ticket through
 * `withSupportDesk()`, which sets `app.support_desk`. Internal notes are the desk's only.
 */

export const SUPPORT_STATUSES = [
  "open",
  "waiting_on_you",
  "waiting_on_us",
  "solved",
  "closed",
] as const;
export const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const SUPPORT_TOPICS = ["question", "help", "billing", "bug", "coverage", "other"] as const;

/** True inside `withSupportDesk()`. */
const supportDesk = sql`current_setting('app.support_desk', true) = 'on'`;

/** Ticket numbers are one sequence for everyone (T-0001…), so they never repeat. */
export const supportTicketNumber = pgSequence("support_ticket_number_seq", { startWith: 1 });

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull().default(sql`nextval('support_ticket_number_seq')`),
    /** Null for a website enquiry. */
    organizationId: uuid("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    requesterUserId: uuid("requester_user_id").references(() => user.id, { onDelete: "set null" }),
    requesterEmail: text("requester_email").notNull(),
    requesterName: text("requester_name"),
    subject: text("subject").notNull(),
    topic: text("topic").notNull().default("question"),
    status: text("status").notNull().default("waiting_on_us"),
    priority: text("priority").notNull().default("normal"),
    assignedTo: uuid("assigned_to").references(() => user.id, { onDelete: "set null" }),
    /** Where it came from: "app" or "website". */
    source: text("source").notNull().default("app"),
    /** The app page the person was on, if any. */
    page: text("page"),
    /** Replies by email go to support-<token>@INBOUND_EMAIL_DOMAIN. */
    token: text("token").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => {
    const visible: SQL = sql`(${t.organizationId} = ${currentOrgId} or ${supportDesk})`;
    return [
      uniqueIndex("support_tickets_number_key").on(t.number),
      uniqueIndex("support_tickets_token_key").on(t.token),
      index("support_tickets_org_idx").on(t.organizationId, t.lastMessageAt),
      index("support_tickets_status_idx").on(t.status, t.lastMessageAt),
      check(
        "support_tickets_status_valid",
        sql`${t.status} in ('open', 'waiting_on_you', 'waiting_on_us', 'solved', 'closed')`,
      ),
      check(
        "support_tickets_priority_valid",
        sql`${t.priority} in ('low', 'normal', 'high', 'urgent')`,
      ),
      check(
        "support_tickets_topic_valid",
        sql`${t.topic} in ('question', 'help', 'billing', 'bug', 'coverage', 'other')`,
      ),
      check("support_tickets_source_valid", sql`${t.source} in ('app', 'website')`),
      check("support_tickets_token_valid", sql`${t.token} ~ '^[a-z0-9]{20,64}$'`),
      check("support_tickets_subject_length", sql`length(trim(${t.subject})) between 1 and 200`),
      pgPolicy("support_tickets_visibility", {
        as: "permissive",
        for: "all",
        using: visible,
        withCheck: visible,
      }),
    ];
  },
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    /** The ticket's company, copied so row-level security needs no join. */
    organizationId: uuid("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    authorUserId: uuid("author_user_id").references(() => user.id, { onDelete: "set null" }),
    authorEmail: text("author_email"),
    authorName: text("author_name"),
    /** Written by the support desk, not the customer. */
    fromSupport: boolean("from_support").notNull().default(false),
    /** A note for the desk only; never shown to the customer or emailed. */
    internal: boolean("internal").notNull().default(false),
    body: text("body").notNull(),
    /** "email" when it came in as an email reply. */
    via: text("via").notNull().default("app"),
    /** Resend's email id for one that came by email, so a repeated webhook adds nothing. */
    emailRef: text("email_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    const visible: SQL = sql`((${t.organizationId} = ${currentOrgId} and not ${t.internal}) or ${supportDesk})`;
    return [
      index("support_messages_ticket_idx").on(t.ticketId, t.createdAt),
      uniqueIndex("support_messages_email_ref_key").on(t.emailRef),
      check("support_messages_body_length", sql`length(trim(${t.body})) between 1 and 20000`),
      check("support_messages_via_valid", sql`${t.via} in ('app', 'email', 'website')`),
      check("support_messages_internal_from_support", sql`not ${t.internal} or ${t.fromSupport}`),
      pgPolicy("support_messages_visibility", {
        as: "permissive",
        for: "all",
        using: visible,
        withCheck: visible,
      }),
    ];
  },
);

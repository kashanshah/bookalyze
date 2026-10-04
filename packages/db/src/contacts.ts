import { MONEY_ACCOUNT_SUBTYPES } from "@bookalyze/core";
import { and, asc, eq, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import {
  accounts,
  type ContactType,
  contacts,
  journalEntries,
  journalLines,
} from "./schema/accounting";

/** Customers and vendors, with how much money moved with each. Run inside `withOrg()`. */

export type ContactRow = typeof contacts.$inferSelect;
export type ContactWithTotals = ContactRow & {
  /** Base-currency totals over current transactions: money in from them, money out to them. */
  received: string;
  paid: string;
  transactions: number;
};

const moneySubtypes = sql.raw(MONEY_ACCOUNT_SUBTYPES.map((s) => `'${s}'`).join(", "));

/** Per-contact totals over current (not reversed) entries, optionally within a date range. */
function totalsQuery(tx: Transaction, range: { from?: string | null; to?: string | null } = {}) {
  const conditions: SQL[] = [
    isNull(journalEntries.reversedByEntryId),
    isNull(journalEntries.reversesEntryId),
    sql`${accounts.subtype} in (${moneySubtypes})`,
  ];
  if (range.from) conditions.push(sql`${journalEntries.date} >= ${range.from}`);
  if (range.to) conditions.push(sql`${journalEntries.date} <= ${range.to}`);
  return tx
    .select({
      contactId: journalEntries.contactId,
      received:
        sql<string>`coalesce(sum(case when ${journalLines.baseAmount} > 0 then ${journalLines.baseAmount} end), 0)::numeric(20,4)::text`.as(
          "received",
        ),
      paid: sql<string>`coalesce(-sum(case when ${journalLines.baseAmount} < 0 then ${journalLines.baseAmount} end), 0)::numeric(20,4)::text`.as(
        "paid",
      ),
      transactions: sql<number>`count(distinct ${journalEntries.id})::int`.as("transactions"),
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(...conditions))
    .groupBy(journalEntries.contactId)
    .as("totals");
}

export async function listContacts(
  tx: Transaction,
  filters: { type?: "customer" | "vendor" | null; search?: string | null; archived?: boolean } = {},
): Promise<ContactWithTotals[]> {
  const totals = totalsQuery(tx);
  const conditions: SQL[] = [eq(contacts.isArchived, filters.archived ?? false)];
  if (filters.type) conditions.push(inArray(contacts.type, [filters.type, "both"]));
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const match = or(ilike(contacts.name, pattern), ilike(contacts.email, pattern));
    if (match) conditions.push(match);
  }
  const rows = await tx
    .select({
      contact: contacts,
      received: totals.received,
      paid: totals.paid,
      transactions: totals.transactions,
    })
    .from(contacts)
    .leftJoin(totals, eq(totals.contactId, contacts.id))
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${contacts.name})`));
  return rows.map((r) => ({
    ...r.contact,
    received: r.received ?? "0.0000",
    paid: r.paid ?? "0.0000",
    transactions: r.transactions ?? 0,
  }));
}

export async function getContact(tx: Transaction, id: string): Promise<ContactRow | null> {
  const [row] = await tx.select().from(contacts).where(eq(contacts.id, id));
  return row ?? null;
}

/** Money received from and paid to a contact, all time or within a date range. */
export async function contactTotals(
  tx: Transaction,
  contactId: string,
  range: { from?: string | null; to?: string | null } = {},
): Promise<{ received: string; paid: string; transactions: number }> {
  const totals = totalsQuery(tx, range);
  const [row] = await tx
    .select({ received: totals.received, paid: totals.paid, transactions: totals.transactions })
    .from(totals)
    .where(eq(totals.contactId, contactId));
  return row ?? { received: "0.0000", paid: "0.0000", transactions: 0 };
}

/** Contacts for pickers and name lookups. Archived ones only when asked (to show old names). */
export async function contactOptions(
  tx: Transaction,
  options: { includeArchived?: boolean } = {},
): Promise<{ id: string; name: string; type: ContactType; isArchived: boolean }[]> {
  return tx
    .select({
      id: contacts.id,
      name: contacts.name,
      type: contacts.type,
      isArchived: contacts.isArchived,
    })
    .from(contacts)
    .where(options.includeArchived ? undefined : eq(contacts.isArchived, false))
    .orderBy(asc(sql`lower(${contacts.name})`));
}

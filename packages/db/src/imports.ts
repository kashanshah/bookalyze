import { type AccountSubtype, getAccountSubtype, type PreparedEntry } from "@bookalyze/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { assertPeriodOpen, nextEntryNumber } from "./ledger";
import {
  accounts,
  type ContactType,
  contacts,
  journalEntries,
  journalLines,
} from "./schema/accounting";
import { importBatches } from "./schema/imports";

/**
 * Writes for importing history from other accounting software. The web app plans an import with
 * core's planImport(), then creates a batch, its accounts and contacts, and posts its entries in
 * chunks. Each entry keeps the other program's ID in `source_id`, so re-importing a file skips
 * what's already there. Run inside `withOrg()`.
 */

export async function createImportBatch(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; source: string; fileName: string },
) {
  const [row] = await tx
    .insert(importBatches)
    .values({
      organizationId: input.orgId,
      source: input.source,
      fileName: input.fileName,
      createdBy: input.userId ?? null,
    })
    .returning();
  if (!row) throw new Error("Could not start the import");
  return row;
}

export async function getImportBatch(tx: Transaction, id: string) {
  const [row] = await tx.select().from(importBatches).where(eq(importBatches.id, id));
  return row ?? null;
}

export type NewImportAccount = {
  key: string;
  name: string;
  code?: string | null;
  subtype: AccountSubtype;
  /** For bank and card accounts, which hold one currency. */
  currency?: string | null;
};

/** Creates the accounts an import needs. Returns their IDs by import key. */
export async function createImportAccounts(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    batchId: string;
    baseCurrency: string;
    accounts: NewImportAccount[];
  },
): Promise<Record<string, string>> {
  if (!input.accounts.length) return {};
  const taken = new Set(
    (await tx.select({ code: accounts.code }).from(accounts)).map((a) => a.code).filter(Boolean),
  );
  const rows = input.accounts.map((a) => {
    const info = getAccountSubtype(a.subtype);
    if (!info) throw new Error(`Unknown account subtype ${a.subtype}`);
    // Codes stay when free; a clash with an existing account would otherwise block the import.
    const code = a.code && !taken.has(a.code) ? a.code : null;
    if (code) taken.add(code);
    return {
      organizationId: input.orgId,
      name: a.name,
      code,
      type: info.type,
      subtype: a.subtype,
      currency: info.needsCurrency ? (a.currency ?? input.baseCurrency) : null,
      importBatchId: input.batchId,
      createdBy: input.userId ?? null,
    };
  });
  const created = await tx.insert(accounts).values(rows).returning({ id: accounts.id });
  return Object.fromEntries(input.accounts.map((a, i) => [a.key, created[i]?.id as string]));
}

export type ImportContactInput = {
  key: string;
  name: string;
  role: ContactType;
  email?: string | null;
  phone?: string | null;
  taxNumber?: string | null;
  address?: string | null;
  notes?: string | null;
};

const DETAIL_FIELDS = ["email", "phone", "taxNumber", "address", "notes"] as const;

/**
 * Finds or creates the customers and vendors an import names: an existing contact with the same
 * name (and a matching role) is reused, and details it's missing (email, phone…) are filled in
 * from the import without overwriting anything. Returns their IDs by import key.
 */
export async function createImportContacts(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    batchId: string;
    contacts: ImportContactInput[];
  },
): Promise<{ ids: Record<string, string>; created: number; updated: number }> {
  if (!input.contacts.length) return { ids: {}, created: 0, updated: 0 };
  const existing = await tx.select().from(contacts);
  const ids: Record<string, string> = {};
  const toCreate: typeof input.contacts = [];
  let updated = 0;
  for (const c of input.contacts) {
    const name = c.name.trim().toLowerCase();
    const match =
      existing.find((e) => e.name.toLowerCase() === name && e.type === c.role) ??
      existing.find(
        (e) => e.name.toLowerCase() === name && (e.type === "both" || c.role === "both"),
      );
    if (match) {
      ids[c.key] = match.id;
      const fill = Object.fromEntries(
        DETAIL_FIELDS.filter((f) => c[f] && !match[f]).map((f) => [f, c[f] as string]),
      );
      if (Object.keys(fill).length) {
        await tx.update(contacts).set(fill).where(eq(contacts.id, match.id));
        updated++;
      }
    } else toCreate.push(c);
  }
  if (toCreate.length) {
    const created = await tx
      .insert(contacts)
      .values(
        toCreate.map((c) => ({
          organizationId: input.orgId,
          type: c.role,
          name: c.name.trim(),
          email: c.email ?? null,
          phone: c.phone ?? null,
          taxNumber: c.taxNumber ?? null,
          address: c.address ?? null,
          notes: c.notes ?? null,
          importBatchId: input.batchId,
          createdBy: input.userId ?? null,
        })),
      )
      .returning({ id: contacts.id });
    toCreate.forEach((c, i) => {
      ids[c.key] = created[i]?.id as string;
    });
  }
  return { ids, created: toCreate.length, updated };
}

export type ImportedEntry = {
  /** The entry's ID in the other program (from planImport), unique per organization. */
  externalId: string;
  date: string;
  memo?: string | null;
  reference?: string | null;
  contactId?: string | null;
  entry: PreparedEntry;
};

const CHUNK = 500;

/**
 * Posts a chunk of imported entries in one go, skipping any already imported. Entry numbers
 * continue the organization's sequence, in date order.
 */
export async function postImportedEntries(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; batchId: string; entries: ImportedEntry[] },
): Promise<{ posted: number; skipped: number }> {
  if (!input.entries.length) return { posted: 0, skipped: 0 };
  const earliest = input.entries.reduce(
    (d, e) => (e.date < d ? e.date : d),
    input.entries[0]?.date as string,
  );
  await assertPeriodOpen(tx, earliest);
  const ids = input.entries.map((e) => e.externalId);
  const already = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const found = await tx
      .select({ sourceId: journalEntries.sourceId })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.source, "import"),
          inArray(journalEntries.sourceId, ids.slice(i, i + CHUNK)),
        ),
      );
    for (const f of found) if (f.sourceId) already.add(f.sourceId);
  }
  const seen = new Set<string>();
  const fresh = input.entries
    .filter((e) => {
      if (already.has(e.externalId) || seen.has(e.externalId)) return false;
      seen.add(e.externalId);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const skipped = input.entries.length - fresh.length;
  if (fresh.length) {
    let number = await nextEntryNumber(tx, input.orgId);
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const inserted = await tx
        .insert(journalEntries)
        .values(
          chunk.map((e) => ({
            organizationId: input.orgId,
            entryNumber: number++,
            date: e.date,
            reference: e.reference ?? null,
            memo: e.memo ?? null,
            currency: e.entry.currency,
            fxRate: e.entry.fxRate,
            source: "import" as const,
            sourceId: e.externalId,
            importBatchId: input.batchId,
            contactId: e.contactId ?? null,
            createdBy: input.userId ?? null,
          })),
        )
        .returning({ id: journalEntries.id });
      const lines = chunk.flatMap((e, j) =>
        e.entry.lines.map((line, k) => ({
          organizationId: input.orgId,
          journalEntryId: inserted[j]?.id as string,
          lineNo: k + 1,
          accountId: line.accountId,
          description: line.description,
          currency: line.currency,
          amount: line.amount,
          baseAmount: line.baseAmount,
        })),
      );
      for (let k = 0; k < lines.length; k += CHUNK * 2) {
        await tx.insert(journalLines).values(lines.slice(k, k + CHUNK * 2));
      }
    }
  }
  if (skipped) {
    await tx
      .update(importBatches)
      .set({ skippedCount: sql`${importBatches.skippedCount} + ${skipped}` })
      .where(eq(importBatches.id, input.batchId));
  }
  return { posted: fresh.length, skipped };
}

/** Marks an import finished and records what it brought in. */
export async function completeImportBatch(tx: Transaction, batchId: string) {
  const [stats] = await tx
    .select({
      entries: sql<number>`count(*)::int`,
      first: sql<string | null>`min(${journalEntries.date})`,
      last: sql<string | null>`max(${journalEntries.date})`,
    })
    .from(journalEntries)
    .where(eq(journalEntries.importBatchId, batchId));
  const [accountCount] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.importBatchId, batchId));
  const [contactCount] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.importBatchId, batchId));
  const [row] = await tx
    .update(importBatches)
    .set({
      status: "completed",
      completedAt: new Date(),
      entryCount: stats?.entries ?? 0,
      firstDate: stats?.first ?? null,
      lastDate: stats?.last ?? null,
      accountCount: accountCount?.n ?? 0,
      contactCount: contactCount?.n ?? 0,
    })
    .where(eq(importBatches.id, batchId))
    .returning();
  return row ?? null;
}

export async function listImportBatches(tx: Transaction) {
  return tx.select().from(importBatches).orderBy(desc(importBatches.createdAt));
}

/**
 * Removes everything an import created (see `undo_import_batch` in migration 0013). Throws a
 * database error with hint `import_changed` or `period_locked` when it can't.
 */
export async function undoImportBatch(tx: Transaction, batchId: string): Promise<number> {
  const result = await tx.execute(sql`select undo_import_batch(${batchId}::uuid) as removed`);
  const row = (result as unknown as { rows: { removed: number }[] }).rows[0];
  return Number(row?.removed ?? 0);
}

/**
 * Current transactions dated within [from, to], with the text a receipt's name is matched
 * against: the description, the customer or vendor, and line descriptions.
 */
export async function receiptCandidates(
  tx: Transaction,
  range: { from: string; to: string },
): Promise<{ id: string; date: string; text: string }[]> {
  const rows = await tx
    .select({
      id: journalEntries.id,
      date: journalEntries.date,
      memo: journalEntries.memo,
      contact: contacts.name,
      lines: sql<string>`(select string_agg(coalesce(l.description, ''), ' ') from ${journalLines} l where l.journal_entry_id = ${journalEntries.id})`,
    })
    .from(journalEntries)
    .leftJoin(contacts, eq(contacts.id, journalEntries.contactId))
    .where(
      and(
        sql`${journalEntries.date} between ${range.from} and ${range.to}`,
        sql`${journalEntries.reversedByEntryId} is null`,
        sql`${journalEntries.reversesEntryId} is null`,
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    text: [r.memo, r.contact, r.lines].filter(Boolean).join(" "),
  }));
}

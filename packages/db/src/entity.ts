import type { ComplianceInput, ComplianceRecurrence } from "@bookalyze/core";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Transaction } from "./client";
import {
  attachmentLinks,
  attachments,
  complianceCompletions,
  complianceItems,
  complianceReminders,
  entityDetails,
  entityDocuments,
  entityIdentifiers,
  entityPeople,
  taxRegistrations,
} from "./schema";

/**
 * Entity & compliance: company details, registration numbers, people, the document vault, items
 * added to the compliance calendar, "done" ticks and sent reminders. The calendar itself is
 * worked out in core (`complianceCalendar`) from what `complianceInput` loads here.
 */

export class EntityError extends Error {}

// --- details -------------------------------------------------------------------------------

export async function getEntityDetails(tx: Transaction) {
  const [row] = await tx.select().from(entityDetails);
  return {
    jurisdiction: row?.jurisdiction ?? null,
    registeredAddress: row?.registeredAddress ?? null,
  };
}

export async function saveEntityDetails(
  tx: Transaction,
  input: { orgId: string; jurisdiction: string | null; registeredAddress: string | null },
) {
  const values = { jurisdiction: input.jurisdiction, registeredAddress: input.registeredAddress };
  await tx
    .insert(entityDetails)
    .values({ organizationId: input.orgId, ...values })
    .onConflictDoUpdate({ target: entityDetails.organizationId, set: values });
}

// --- registration numbers ------------------------------------------------------------------

export type IdentifierInput = {
  kind: string;
  label: string | null;
  value: string;
  expiresOn: string | null;
  notes: string | null;
};

export async function listIdentifiers(tx: Transaction) {
  return tx.select().from(entityIdentifiers).orderBy(asc(entityIdentifiers.createdAt));
}

export async function saveIdentifier(
  tx: Transaction,
  input: IdentifierInput & { orgId: string; id?: string | null },
) {
  const { orgId, id, ...values } = input;
  if (id) {
    const [row] = await tx
      .update(entityIdentifiers)
      .set(values)
      .where(eq(entityIdentifiers.id, id))
      .returning();
    if (!row) throw new EntityError("This number no longer exists.");
    return row;
  }
  const [row] = await tx
    .insert(entityIdentifiers)
    .values({ organizationId: orgId, ...values })
    .returning();
  if (!row) throw new Error("Could not save the number");
  return row;
}

export async function deleteIdentifier(tx: Transaction, id: string) {
  await tx.delete(entityIdentifiers).where(eq(entityIdentifiers.id, id));
}

// --- people --------------------------------------------------------------------------------

export type PersonInput = {
  name: string;
  roles: string[];
  title: string | null;
  ownershipPercent: string | null;
  email: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
};

export async function listPeople(tx: Transaction) {
  return tx.select().from(entityPeople).orderBy(asc(entityPeople.endDate), asc(entityPeople.name));
}

export async function savePerson(
  tx: Transaction,
  input: PersonInput & { orgId: string; id?: string | null },
) {
  const { orgId, id, ...values } = input;
  if (id) {
    const [row] = await tx
      .update(entityPeople)
      .set(values)
      .where(eq(entityPeople.id, id))
      .returning();
    if (!row) throw new EntityError("This person is no longer listed.");
    return row;
  }
  const [row] = await tx
    .insert(entityPeople)
    .values({ organizationId: orgId, ...values })
    .returning();
  if (!row) throw new Error("Could not save the person");
  return row;
}

export async function deletePerson(tx: Transaction, id: string) {
  await tx.delete(entityPeople).where(eq(entityPeople.id, id));
}

// --- documents -----------------------------------------------------------------------------

export async function listEntityDocuments(tx: Transaction) {
  return tx
    .select({
      id: entityDocuments.id,
      title: entityDocuments.title,
      kind: entityDocuments.kind,
      expiresOn: entityDocuments.expiresOn,
      createdAt: entityDocuments.createdAt,
      attachmentId: attachments.id,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
      sizeBytes: attachments.sizeBytes,
    })
    .from(entityDocuments)
    .innerJoin(attachments, eq(attachments.id, entityDocuments.attachmentId))
    .orderBy(desc(entityDocuments.createdAt));
}

/**
 * Files an uploaded attachment in the vault. The attachment must be ready and not attached to
 * anything yet (it's linked to the document, so it never shows in the receipts inbox).
 */
export async function createEntityDocument(
  tx: Transaction,
  input: {
    orgId: string;
    userId?: string | null;
    attachmentId: string;
    title: string;
    kind: string;
    expiresOn: string | null;
  },
) {
  const [file] = await tx.select().from(attachments).where(eq(attachments.id, input.attachmentId));
  if (file?.status !== "ready")
    throw new EntityError("The file didn't finish uploading. Try again.");
  const [linked] = await tx
    .select({ id: attachmentLinks.attachmentId })
    .from(attachmentLinks)
    .where(eq(attachmentLinks.attachmentId, input.attachmentId))
    .limit(1);
  if (linked) throw new EntityError("This file is already attached to something else.");
  const [doc] = await tx
    .insert(entityDocuments)
    .values({
      organizationId: input.orgId,
      attachmentId: input.attachmentId,
      title: input.title,
      kind: input.kind,
      expiresOn: input.expiresOn,
      uploadedBy: input.userId ?? null,
    })
    .returning();
  if (!doc) throw new Error("Could not save the document");
  await tx.insert(attachmentLinks).values({
    organizationId: input.orgId,
    attachmentId: input.attachmentId,
    entityType: "entity_document",
    entityId: doc.id,
    createdBy: input.userId ?? null,
  });
  return doc;
}

export async function updateEntityDocument(
  tx: Transaction,
  id: string,
  input: { title: string; kind: string; expiresOn: string | null },
) {
  const [row] = await tx
    .update(entityDocuments)
    .set(input)
    .where(eq(entityDocuments.id, id))
    .returning();
  if (!row) throw new EntityError("This document no longer exists.");
  return row;
}

/** Deletes a document and its file; returns the storage key so the caller removes the bytes. */
export async function deleteEntityDocument(tx: Transaction, id: string): Promise<string | null> {
  const [doc] = await tx.delete(entityDocuments).where(eq(entityDocuments.id, id)).returning();
  if (!doc) return null;
  const [file] = await tx
    .delete(attachments)
    .where(eq(attachments.id, doc.attachmentId))
    .returning({ storageKey: attachments.storageKey });
  return file?.storageKey ?? null;
}

// --- calendar ------------------------------------------------------------------------------

export type ComplianceItemInput = {
  title: string;
  notes: string | null;
  firstDue: string;
  recurrence: ComplianceRecurrence;
};

export async function saveComplianceItem(
  tx: Transaction,
  input: ComplianceItemInput & { orgId: string; userId?: string | null; id?: string | null },
) {
  const { orgId, userId, id, ...values } = input;
  if (id) {
    const [row] = await tx
      .update(complianceItems)
      .set(values)
      .where(eq(complianceItems.id, id))
      .returning();
    if (!row) throw new EntityError("This item no longer exists.");
    return row;
  }
  const [row] = await tx
    .insert(complianceItems)
    .values({ organizationId: orgId, createdBy: userId ?? null, ...values })
    .returning();
  if (!row) throw new Error("Could not save the item");
  return row;
}

export async function deleteComplianceItem(tx: Transaction, id: string) {
  await tx.delete(complianceItems).where(eq(complianceItems.id, id));
}

/** Everything `complianceCalendar` needs besides the company profile. */
export async function complianceInput(
  tx: Transaction,
  profile: Pick<ComplianceInput, "country" | "entityType" | "incorporationDate" | "fiscal">,
): Promise<ComplianceInput> {
  const [details, identifiers, documents, custom, registrations] = await Promise.all([
    getEntityDetails(tx),
    listIdentifiers(tx),
    tx.select().from(entityDocuments),
    tx.select().from(complianceItems),
    tx.select().from(taxRegistrations),
  ]);
  return {
    ...profile,
    jurisdiction: details.jurisdiction,
    taxRegistrations: registrations.map((r) => ({
      id: r.id,
      authority: r.authority,
      filingFrequency: r.filingFrequency,
      effectiveFrom: r.effectiveFrom,
      isActive: r.isActive,
    })),
    identifiers: identifiers.map((i) => ({
      id: i.id,
      kind: i.kind,
      label: i.label ?? i.value,
      expiresOn: i.expiresOn,
    })),
    documents: documents.map((d) => ({ id: d.id, title: d.title, expiresOn: d.expiresOn })),
    custom: custom.map((c) => ({
      id: c.id,
      title: c.title,
      notes: c.notes,
      firstDue: c.firstDue,
      recurrence: c.recurrence,
    })),
  };
}

/** Occurrences ticked as done, as "item key|due date". */
export async function completedOccurrences(tx: Transaction): Promise<Set<string>> {
  const rows = await tx
    .select({ key: complianceCompletions.itemKey, due: complianceCompletions.dueDate })
    .from(complianceCompletions);
  return new Set(rows.map((r) => `${r.key}|${r.due}`));
}

export async function setOccurrenceDone(
  tx: Transaction,
  input: { orgId: string; userId?: string | null; itemKey: string; dueDate: string; done: boolean },
) {
  if (input.done) {
    await tx
      .insert(complianceCompletions)
      .values({
        organizationId: input.orgId,
        itemKey: input.itemKey,
        dueDate: input.dueDate,
        completedBy: input.userId ?? null,
      })
      .onConflictDoNothing();
  } else {
    await tx
      .delete(complianceCompletions)
      .where(
        and(
          eq(complianceCompletions.itemKey, input.itemKey),
          eq(complianceCompletions.dueDate, input.dueDate),
        ),
      );
  }
}

/** Lead times already sent for these occurrences, by "item key|due date". */
export async function sentReminders(
  tx: Transaction,
  itemKeys: readonly string[],
): Promise<Map<string, Set<number>>> {
  const map = new Map<string, Set<number>>();
  if (!itemKeys.length) return map;
  const rows = await tx
    .select()
    .from(complianceReminders)
    .where(inArray(complianceReminders.itemKey, [...itemKeys]));
  for (const r of rows) {
    const key = `${r.itemKey}|${r.dueDate}`;
    map.set(key, (map.get(key) ?? new Set()).add(r.leadDays));
  }
  return map;
}

export async function recordReminder(
  tx: Transaction,
  input: { orgId: string; itemKey: string; dueDate: string; leadDays: number },
) {
  await tx
    .insert(complianceReminders)
    .values({ organizationId: input.orgId, ...input })
    .onConflictDoNothing();
}

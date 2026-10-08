"use server";

import {
  COMPLIANCE_RECURRENCES,
  DOCUMENT_KINDS,
  IDENTIFIER_KINDS,
  JURISDICTIONS,
  PERSON_ROLES,
} from "@bookalyze/core";
import {
  createEntityDocument,
  deleteComplianceItem,
  deleteEntityDocument,
  deleteIdentifier,
  deletePerson,
  EntityError,
  saveComplianceItem,
  saveEntityDetails,
  saveIdentifier,
  savePerson,
  schema,
  setOccurrenceDone,
  updateEntityDocument,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getEntityContext } from "@/server/compliance";
import { isOrgAdmin } from "@/server/org";
import { removeStoredFile } from "@/server/storage";

export type EntityResult =
  | { ok: true }
  | { ok: false; message?: string; errors?: Record<string, string> };

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/company`, "layout");
  revalidatePath(`/o/${slug}`);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose a date.")
  .transform((v) => v || null);
const id = z.string().uuid();

function invalid(error: z.ZodError): EntityResult {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[issue.path.join(".") || "form"] ??= issue.message;
  return { ok: false, errors };
}

function failure(error: unknown): EntityResult {
  if (error instanceof EntityError) return { ok: false, message: error.message };
  throw error;
}

// --- details -------------------------------------------------------------------------------

const detailsSchema = z.object({
  jurisdiction: z
    .string()
    .refine((v) => v === "" || JURISDICTIONS.some((j) => j.code === v), "Choose a place.")
    .transform((v) => v || null),
  incorporationDate: optionalDate,
  registeredAddress: optionalText(500),
});

/** Where the company is incorporated, when, and its registered address. Owners and admins. */
export async function saveDetailsAction(
  slug: string,
  input: z.input<typeof detailsSchema>,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  if (!isOrgAdmin(ctx)) return { ok: false, message: "Only owners and admins can change this." };
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { incorporationDate, ...details } = parsed.data;
  await inOrg(ctx, async (tx) => {
    await saveEntityDetails(tx, { orgId: ctx.org.id, ...details });
    await tx.update(schema.organizationProfiles).set({ incorporationDate });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "entity.details_updated",
      entityType: "organization",
      entityId: ctx.org.id,
      after: parsed.data,
    });
  });
  revalidate(slug);
  return { ok: true };
}

// --- registration numbers ------------------------------------------------------------------

const identifierSchema = z
  .object({
    id: id.or(z.literal("")).transform((v) => v || null),
    kind: z
      .string()
      .refine((v) => IDENTIFIER_KINDS.some((k) => k.key === v), "Choose what kind of number."),
    label: optionalText(100),
    value: z.string().trim().min(1, "Enter the number.").max(100),
    expiresOn: optionalDate,
    notes: optionalText(500),
  })
  .refine((v) => v.kind !== "other" || v.label, {
    path: ["label"],
    message: "Say what this number is.",
  });

export async function saveIdentifierAction(
  slug: string,
  input: z.input<typeof identifierSchema>,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  const parsed = identifierSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await inOrg(ctx, async (tx) => {
      const row = await saveIdentifier(tx, { orgId: ctx.org.id, ...parsed.data });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: parsed.data.id ? "entity.identifier_updated" : "entity.identifier_added",
        entityType: "entity_identifier",
        entityId: row.id,
        after: { kind: row.kind },
      });
    });
  } catch (error) {
    return failure(error);
  }
  revalidate(slug);
  return { ok: true };
}

export async function deleteIdentifierAction(
  slug: string,
  identifierId: string,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  if (!id.safeParse(identifierId).success) return { ok: false, message: "Unknown number." };
  await inOrg(ctx, async (tx) => {
    await deleteIdentifier(tx, identifierId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "entity.identifier_removed",
      entityType: "entity_identifier",
      entityId: identifierId,
    });
  });
  revalidate(slug);
  return { ok: true };
}

// --- people --------------------------------------------------------------------------------

const personSchema = z
  .object({
    id: id.or(z.literal("")).transform((v) => v || null),
    name: z.string().trim().min(1, "Enter their name.").max(200),
    roles: z
      .array(z.enum(PERSON_ROLES.map((r) => r.key) as [string, ...string[]]))
      .max(PERSON_ROLES.length),
    title: optionalText(100),
    ownershipPercent: z
      .string()
      .trim()
      .transform((v) => v.replace(/%$/, "").trim())
      .refine(
        (v) => v === "" || (/^\d{1,3}(\.\d{1,4})?$/.test(v) && Number.parseFloat(v) <= 100),
        "Enter a percentage from 0 to 100.",
      )
      .transform((v) => v || null),
    email: z
      .string()
      .trim()
      .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email.")
      .transform((v) => v || null),
    startDate: optionalDate,
    endDate: optionalDate,
    notes: optionalText(500),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    path: ["endDate"],
    message: "Can't end before it started.",
  });

export async function savePersonAction(
  slug: string,
  input: z.input<typeof personSchema>,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await inOrg(ctx, async (tx) => {
      const row = await savePerson(tx, { orgId: ctx.org.id, ...parsed.data });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: parsed.data.id ? "entity.person_updated" : "entity.person_added",
        entityType: "entity_person",
        entityId: row.id,
        after: { roles: row.roles },
      });
    });
  } catch (error) {
    return failure(error);
  }
  revalidate(slug);
  return { ok: true };
}

export async function deletePersonAction(slug: string, personId: string): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  if (!id.safeParse(personId).success) return { ok: false, message: "Unknown person." };
  await inOrg(ctx, async (tx) => {
    await deletePerson(tx, personId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "entity.person_removed",
      entityType: "entity_person",
      entityId: personId,
    });
  });
  revalidate(slug);
  return { ok: true };
}

// --- documents -----------------------------------------------------------------------------

const documentFields = {
  title: z.string().trim().min(1, "Give it a name.").max(200),
  kind: z.enum(DOCUMENT_KINDS.map((k) => k.key) as [string, ...string[]]),
  expiresOn: optionalDate,
};
const newDocumentSchema = z.object({ attachmentId: id, ...documentFields });
const documentSchema = z.object({ id, ...documentFields });

/** Files an uploaded file in the vault. */
export async function createDocumentAction(
  slug: string,
  input: z.input<typeof newDocumentSchema>,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  const parsed = newDocumentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await inOrg(ctx, async (tx) => {
      const doc = await createEntityDocument(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        ...parsed.data,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "entity.document_added",
        entityType: "entity_document",
        entityId: doc.id,
        after: { title: doc.title, kind: doc.kind },
      });
    });
  } catch (error) {
    return failure(error);
  }
  revalidate(slug);
  return { ok: true };
}

export async function updateDocumentAction(
  slug: string,
  input: z.input<typeof documentSchema>,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id: documentId, ...values } = parsed.data;
  try {
    await inOrg(ctx, async (tx) => {
      await updateEntityDocument(tx, documentId, values);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "entity.document_updated",
        entityType: "entity_document",
        entityId: documentId,
        after: values,
      });
    });
  } catch (error) {
    return failure(error);
  }
  revalidate(slug);
  return { ok: true };
}

/** Deletes a document and its file. */
export async function deleteDocumentAction(
  slug: string,
  documentId: string,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  if (!id.safeParse(documentId).success) return { ok: false, message: "Unknown document." };
  const key = await inOrg(ctx, async (tx) => {
    const storageKey = await deleteEntityDocument(tx, documentId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "entity.document_deleted",
      entityType: "entity_document",
      entityId: documentId,
    });
    return storageKey;
  });
  if (key) await removeStoredFile(key);
  revalidate(slug);
  return { ok: true };
}

// --- calendar ------------------------------------------------------------------------------

const itemSchema = z.object({
  id: id.or(z.literal("")).transform((v) => v || null),
  title: z.string().trim().min(1, "Say what's due.").max(200),
  notes: optionalText(500),
  firstDue: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose when it's due."),
  recurrence: z.enum(
    COMPLIANCE_RECURRENCES.map((r) => r.key) as ["once", "monthly", "quarterly", "yearly"],
  ),
});

export async function saveComplianceItemAction(
  slug: string,
  input: z.input<typeof itemSchema>,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await inOrg(ctx, async (tx) => {
      const row = await saveComplianceItem(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        ...parsed.data,
      });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: parsed.data.id ? "compliance.item_updated" : "compliance.item_added",
        entityType: "compliance_item",
        entityId: row.id,
        after: { title: row.title, firstDue: row.firstDue, recurrence: row.recurrence },
      });
    });
  } catch (error) {
    return failure(error);
  }
  revalidate(slug);
  return { ok: true };
}

export async function deleteComplianceItemAction(
  slug: string,
  itemId: string,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  if (!id.safeParse(itemId).success) return { ok: false, message: "Unknown item." };
  await inOrg(ctx, async (tx) => {
    await deleteComplianceItem(tx, itemId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "compliance.item_removed",
      entityType: "compliance_item",
      entityId: itemId,
    });
  });
  revalidate(slug);
  return { ok: true };
}

const doneSchema = z.object({
  itemKey: z.string().min(3).max(200),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  done: z.boolean(),
});

/** Ticks one occurrence as done (or undoes it); done items get no more reminders. */
export async function setDoneAction(
  slug: string,
  input: z.input<typeof doneSchema>,
): Promise<EntityResult> {
  const ctx = await getEntityContext(slug);
  const parsed = doneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Unknown item." };
  await inOrg(ctx, async (tx) => {
    await setOccurrenceDone(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      ...parsed.data,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: parsed.data.done ? "compliance.done" : "compliance.undone",
      entityType: "compliance_item",
      after: parsed.data,
    });
  });
  revalidate(slug);
  return { ok: true };
}

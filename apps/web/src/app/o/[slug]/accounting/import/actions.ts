"use server";

import {
  can,
  matchReceipt,
  type PreparedEntry,
  parseReceiptFileName,
  prepareJournalEntry,
} from "@bookalyze/core";
import {
  completeImportBatch,
  createImportAccounts,
  createImportBatch,
  createImportContacts,
  getImportBatch,
  type ImportedEntry,
  LedgerError,
  postImportedEntries,
  receiptCandidates,
  schema,
  undoImportBatch,
} from "@bookalyze/db";
import { and, count, eq, gte, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatDate } from "@/lib/dates";
import {
  type ImportChunkInput,
  importChunkSchema,
  type StartImportInput,
  startImportSchema,
} from "@/lib/validation/accounting";
import {
  type AccountingContext,
  getAccountingContext,
  inOrg,
  listAccounts,
  toLedgerMap,
} from "@/server/accounting";
import { audit } from "@/server/audit";
import { isOrgAdmin } from "@/server/org";

type Failure = { ok: false; message: string };

async function importContext(slug: string): Promise<AccountingContext | Failure> {
  const ctx = await getAccountingContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "accounting.import")) {
    return { ok: false, message: "Importing isn't part of your plan." };
  }
  if (!isOrgAdmin(ctx)) {
    return { ok: false, message: "Only owners and admins can import data." };
  }
  return ctx;
}

function pgHint(error: unknown): string | undefined {
  return (error as { cause?: { hint?: string } })?.cause?.hint;
}

/** How many entries the books already have in a date range (to warn about double counting). */
export async function existingEntriesAction(
  slug: string,
  from: string,
  to: string,
): Promise<number> {
  const ctx = await getAccountingContext(slug);
  const [row] = await inOrg(ctx, (tx) =>
    tx
      .select({ n: count() })
      .from(schema.journalEntries)
      .where(and(gte(schema.journalEntries.date, from), lte(schema.journalEntries.date, to))),
  );
  return row?.n ?? 0;
}

export type StartImportResult =
  | {
      ok: true;
      batchId: string;
      accountIds: Record<string, string>;
      contactIds: Record<string, string>;
    }
  | Failure;

/** Starts an import: records it and creates the accounts and contacts it needs. */
export async function startImportAction(
  slug: string,
  input: StartImportInput,
): Promise<StartImportResult> {
  const ctx = await importContext(slug);
  if ("ok" in ctx) return ctx;
  const parsed = startImportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the import." };
  }
  const value = parsed.data;
  const result = await inOrg(ctx, async (tx) => {
    const batch = await createImportBatch(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      source: value.source,
      fileName: value.fileName,
    });
    const accountIds = await createImportAccounts(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      batchId: batch.id,
      baseCurrency: ctx.profile.baseCurrency,
      accounts: value.accounts.map((a) => ({
        key: a.key,
        name: a.name,
        code: a.code || null,
        subtype: a.subtype as Parameters<
          typeof createImportAccounts
        >[1]["accounts"][number]["subtype"],
      })),
    });
    const { ids: contactIds } = await createImportContacts(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      batchId: batch.id,
      contacts: value.contacts,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "import.started",
      entityType: "import_batch",
      entityId: batch.id,
      after: {
        source: value.source,
        fileName: value.fileName,
        accounts: value.accounts.length,
        contacts: value.contacts.length,
      },
    });
    return { batchId: batch.id, accountIds, contactIds };
  });
  return { ok: true, ...result };
}

export type ImportChunkResult =
  | { ok: true; posted: number; skipped: number; failed: { externalId: string; message: string }[] }
  | Failure;

/** Posts up to 300 entries of an import. Entries already imported are skipped. */
export async function importChunkAction(
  slug: string,
  batchId: string,
  input: ImportChunkInput,
): Promise<ImportChunkResult> {
  const ctx = await importContext(slug);
  if ("ok" in ctx) return ctx;
  const parsed = importChunkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the import." };
  }
  const batch = await inOrg(ctx, (tx) => getImportBatch(tx, batchId));
  if (batch?.status !== "in_progress") {
    return { ok: false, message: "This import has already finished. Start a new one." };
  }
  const base = ctx.profile.baseCurrency;
  const ledger = toLedgerMap(await listAccounts(ctx));
  const entries: ImportedEntry[] = [];
  const failed: { externalId: string; message: string }[] = [];
  for (const e of parsed.data) {
    const prepared = prepareJournalEntry(
      {
        currency: base,
        baseCurrency: base,
        lines: e.lines.map((l) => {
          const negative = l.amount.startsWith("-");
          const amount = negative ? l.amount.slice(1) : l.amount;
          return {
            accountId: l.accountId,
            description: l.description,
            ...(negative ? { credit: amount } : { debit: amount }),
          };
        }),
      },
      ledger,
    );
    if (!prepared.ok) {
      const message =
        prepared.errors.form ?? Object.values(prepared.errors.lines ?? {})[0] ?? "Invalid entry.";
      failed.push({ externalId: e.externalId, message });
      continue;
    }
    entries.push({
      externalId: e.externalId,
      date: e.date,
      memo: e.memo ?? null,
      reference: e.reference ?? null,
      contactId: e.contactId ?? null,
      entry: prepared.entry as PreparedEntry,
    });
  }
  try {
    const result = await inOrg(ctx, (tx) =>
      postImportedEntries(tx, {
        orgId: ctx.org.id,
        userId: ctx.session.user.id,
        batchId,
        entries,
      }),
    );
    return { ok: true, ...result, failed };
  } catch (error) {
    if (error instanceof LedgerError && error.lockedThrough) {
      return {
        ok: false,
        message: `Your books are closed through ${formatDate(error.lockedThrough, ctx.profile.locale, "long")}. Reopen that period in Settings to import older history.`,
      };
    }
    throw error;
  }
}

export async function finishImportAction(
  slug: string,
  batchId: string,
): Promise<{ ok: true; entries: number; skipped: number } | Failure> {
  const ctx = await importContext(slug);
  if ("ok" in ctx) return ctx;
  const batch = await inOrg(ctx, async (tx) => {
    const done = await completeImportBatch(tx, batchId);
    if (done) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "import.completed",
        entityType: "import_batch",
        entityId: batchId,
        after: done,
      });
    }
    return done;
  });
  if (!batch) return { ok: false, message: "This import no longer exists." };
  revalidatePath(`/o/${slug}/accounting`, "layout");
  return { ok: true, entries: batch.entryCount, skipped: batch.skippedCount };
}

export async function undoImportAction(
  slug: string,
  batchId: string,
): Promise<{ ok: true; removed: number } | Failure> {
  const ctx = await importContext(slug);
  if ("ok" in ctx) return ctx;
  try {
    const removed = await inOrg(ctx, async (tx) => {
      const n = await undoImportBatch(tx, batchId);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "import.undone",
        entityType: "import_batch",
        entityId: batchId,
        after: { removed: n },
      });
      return n;
    });
    revalidatePath(`/o/${slug}/accounting`, "layout");
    return { ok: true, removed };
  } catch (error) {
    const hint = pgHint(error);
    if (hint === "import_changed") {
      return {
        ok: false,
        message:
          "Some imported transactions were edited or removed since, so this import can't be undone in one go.",
      };
    }
    if (hint === "period_locked") {
      return {
        ok: false,
        message: "Part of this import is in a closed period. Reopen it in Settings first.",
      };
    }
    throw error;
  }
}

export type ReceiptMatch = {
  fileName: string;
  entryId: string | null;
  /** "Sizzler Kabab · Feb 1, 2025", for showing the match. */
  entryLabel: string | null;
  /** A file with this name is already attached there (or waiting in the inbox): skip it. */
  alreadyThere: boolean;
};

/**
 * Finds the transaction each receipt file belongs to, from the date and name in its file name
 * (see matchReceipt in core). Nothing is uploaded or changed here.
 */
export async function matchReceiptsAction(
  slug: string,
  fileNames: string[],
): Promise<{ ok: true; matches: ReceiptMatch[] } | Failure> {
  const ctx = await importContext(slug);
  if ("ok" in ctx) return ctx;
  const names = z.array(z.string().trim().min(1).max(255)).max(5000).safeParse(fileNames);
  if (!names.success) return { ok: false, message: "Choose up to 5,000 files at a time." };
  const parsed = names.data.map((fileName) => ({ fileName, info: parseReceiptFileName(fileName) }));
  const dates = parsed
    .map((p) => p.info.date)
    .filter((d): d is string => Boolean(d))
    .sort();
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const { candidates, existing } = await inOrg(ctx, async (tx) => {
    const candidates =
      dates.length > 0
        ? await receiptCandidates(tx, {
            from: shift(dates[0] as string, -3),
            to: shift(dates.at(-1) as string, 3),
          })
        : [];
    // Files already uploaded under the same name, linked or not, so a re-run doesn't duplicate.
    const existing = await tx
      .select({
        fileName: schema.attachments.fileName,
        entityId: schema.attachmentLinks.entityId,
      })
      .from(schema.attachments)
      .leftJoin(
        schema.attachmentLinks,
        eq(schema.attachmentLinks.attachmentId, schema.attachments.id),
      )
      .where(inArray(schema.attachments.fileName, names.data.slice(0, 5000)));
    return { candidates, existing };
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const matches = parsed.map(({ fileName, info }) => {
    const entryId = matchReceipt(info, candidates);
    const entry = entryId ? byId.get(entryId) : undefined;
    const alreadyThere = existing.some(
      (e) => e.fileName === fileName && (entryId ? e.entityId === entryId : e.entityId === null),
    );
    return {
      fileName,
      entryId,
      entryLabel: entry
        ? `${entry.text.split(" ").slice(0, 8).join(" ")} · ${formatDate(entry.date, ctx.profile.locale)}`
        : null,
      alreadyThere,
    };
  });
  return { ok: true, matches };
}

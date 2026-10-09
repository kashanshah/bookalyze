import {
  changeHeadline,
  type ListingCadence,
  type ListingChange,
  type ListingCheck,
  type ListingObservation,
  MAX_HOURLY_WATCHES,
  MAX_LISTING_WATCHES,
  mainImageUrl,
} from "@bookalyze/core";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { connections } from "./schema/banking";
import { listingChanges, listingWatches, salesChannels } from "./schema/commerce";

/**
 * Products a company is watching. Reads and writes run inside withOrg(); the hourly job finds
 * companies with `listing_watch_orgs()` first, then opens each one with withOrg().
 */

export class ListingWatchError extends Error {
  constructor(
    message: string,
    readonly code: "duplicate" | "limit" | "not_found" = "not_found",
  ) {
    super(message);
  }
}

export type ListingWatchInput = {
  channelId: string;
  asin: string;
  checks: ListingCheck[];
  cadence: ListingCadence;
  notify: boolean;
  /** Up to two more email addresses for this product's changes. */
  notifyEmails: string[];
};

const watchColumns = {
  id: listingWatches.id,
  channelId: listingWatches.channelId,
  channelName: salesChannels.name,
  asin: listingWatches.asin,
  title: listingWatches.title,
  imageUrl: listingWatches.imageUrl,
  checks: listingWatches.checks,
  cadence: listingWatches.cadence,
  notify: listingWatches.notify,
  notifyEmails: listingWatches.notifyEmails,
  paused: listingWatches.paused,
  observed: listingWatches.observed,
  lastCheckedAt: listingWatches.lastCheckedAt,
  nextCheckAt: listingWatches.nextCheckAt,
  lastError: listingWatches.lastError,
  lastChangeSummary: listingWatches.lastChangeSummary,
  lastChangeAt: listingWatches.lastChangeAt,
  createdAt: listingWatches.createdAt,
};

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === "23505" || (error as { code?: string }).code === "23505";
}

async function counts(tx: Transaction) {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      hourly: sql<number>`count(*) filter (where ${listingWatches.cadence} = 'hourly')::int`,
    })
    .from(listingWatches);
  return { total: row?.total ?? 0, hourly: row?.hourly ?? 0 };
}

function assertTotalRoom(total: number) {
  if (total >= MAX_LISTING_WATCHES) {
    throw new ListingWatchError(
      `You can watch up to ${MAX_LISTING_WATCHES} products. Stop watching one to add another.`,
      "limit",
    );
  }
}

function assertHourlyRoom(hourly: number) {
  if (hourly >= MAX_HOURLY_WATCHES) {
    throw new ListingWatchError(
      `Hourly checks are limited to ${MAX_HOURLY_WATCHES} products, so Amazon isn't asked too often. Daily or weekly still works.`,
      "limit",
    );
  }
}

/** Watches, newest changes first, then the ones added most recently. */
export async function listListingWatches(tx: Transaction, search?: string | null) {
  const term = search?.trim();
  return tx
    .select(watchColumns)
    .from(listingWatches)
    .innerJoin(salesChannels, eq(salesChannels.id, listingWatches.channelId))
    .where(
      term
        ? or(ilike(listingWatches.asin, `%${term}%`), ilike(listingWatches.title, `%${term}%`))
        : undefined,
    )
    .orderBy(
      sql`${listingWatches.lastChangeAt} desc nulls last`,
      desc(listingWatches.createdAt),
      asc(listingWatches.asin),
    );
}

export async function getListingWatch(tx: Transaction, id: string) {
  const [row] = await tx
    .select(watchColumns)
    .from(listingWatches)
    .innerJoin(salesChannels, eq(salesChannels.id, listingWatches.channelId))
    .where(eq(listingWatches.id, id));
  return row ?? null;
}

export async function listListingChanges(tx: Transaction, watchId: string, limit = 50) {
  return tx
    .select({
      id: listingChanges.id,
      field: listingChanges.field,
      summary: listingChanges.summary,
      before: listingChanges.before,
      after: listingChanges.after,
      checkedAt: listingChanges.checkedAt,
    })
    .from(listingChanges)
    .where(eq(listingChanges.watchId, watchId))
    .orderBy(desc(listingChanges.checkedAt), desc(listingChanges.id))
    .limit(limit);
}

/** The watch plus what the checker needs to call Amazon. */
export async function getListingWatchForCheck(tx: Transaction, id: string) {
  const [row] = await tx
    .select({
      watch: listingWatches,
      channelName: salesChannels.name,
      marketplaceId: salesChannels.marketplaceId,
      channelActive: salesChannels.isActive,
      connectionId: connections.id,
      secret: connections.secret,
      settings: connections.settings,
      provider: connections.provider,
      connectionStatus: connections.status,
    })
    .from(listingWatches)
    .innerJoin(salesChannels, eq(salesChannels.id, listingWatches.channelId))
    .leftJoin(connections, eq(connections.id, salesChannels.connectionId))
    .where(eq(listingWatches.id, id))
    .for("update", { of: listingWatches });
  return row ?? null;
}

export async function dueListingWatchIds(tx: Transaction, limit: number): Promise<string[]> {
  const rows = await tx
    .select({ id: listingWatches.id })
    .from(listingWatches)
    .where(and(eq(listingWatches.paused, false), sql`${listingWatches.nextCheckAt} <= now()`))
    .orderBy(asc(listingWatches.nextCheckAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function createListingWatch(
  tx: Transaction,
  input: ListingWatchInput & { orgId: string; userId: string | null },
) {
  const count = await counts(tx);
  assertTotalRoom(count.total);
  if (input.cadence === "hourly") assertHourlyRoom(count.hourly);
  try {
    const [row] = await tx
      .insert(listingWatches)
      .values({
        organizationId: input.orgId,
        channelId: input.channelId,
        asin: input.asin,
        checks: input.checks,
        cadence: input.cadence,
        notify: input.notify,
        notifyEmails: input.notifyEmails,
        createdBy: input.userId,
      })
      .returning({ id: listingWatches.id });
    if (!row) throw new ListingWatchError("The product couldn't be saved.");
    return row.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ListingWatchError(
        "You're already watching this product on this marketplace.",
        "duplicate",
      );
    }
    throw error;
  }
}

export async function updateListingWatch(
  tx: Transaction,
  input: ListingWatchInput & { id: string },
) {
  const current = await getListingWatch(tx, input.id);
  if (!current) throw new ListingWatchError("This product is no longer being watched.");
  if (input.cadence === "hourly" && current.cadence !== "hourly") {
    assertHourlyRoom((await counts(tx)).hourly);
  }
  // Another product, marketplace or set of checks: the last look isn't comparable, so the next
  // check takes a fresh baseline instead of reporting everything as changed.
  const sameChecks =
    current.checks.length === input.checks.length &&
    input.checks.every((c) => current.checks.includes(c));
  const rebaseline =
    current.asin !== input.asin || current.channelId !== input.channelId || !sameChecks;
  try {
    const [row] = await tx
      .update(listingWatches)
      .set({
        channelId: input.channelId,
        asin: input.asin,
        checks: input.checks,
        cadence: input.cadence,
        notify: input.notify,
        notifyEmails: input.notifyEmails,
        ...(rebaseline ? { observed: null } : {}),
        ...(input.cadence !== current.cadence ? { nextCheckAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(listingWatches.id, input.id))
      .returning({ id: listingWatches.id });
    if (!row) throw new ListingWatchError("This product is no longer being watched.");
    return row.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ListingWatchError(
        "You're already watching this product on this marketplace.",
        "duplicate",
      );
    }
    throw error;
  }
}

export async function setListingWatchPaused(tx: Transaction, id: string, paused: boolean) {
  const [row] = await tx
    .update(listingWatches)
    .set({
      paused,
      nextCheckAt: paused ? undefined : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(listingWatches.id, id))
    .returning({ id: listingWatches.id });
  if (!row) throw new ListingWatchError("This product is no longer being watched.");
}

export async function deleteListingWatch(tx: Transaction, id: string) {
  const removed = await tx
    .delete(listingWatches)
    .where(eq(listingWatches.id, id))
    .returning({ id: listingWatches.id });
  if (!removed.length) throw new ListingWatchError("This product is no longer being watched.");
}

/**
 * Saves a completed look. Changes are compared with the snapshot currently stored, so two checks
 * racing each other don't both report the same change.
 */
export async function saveListingCheck(
  tx: Transaction,
  input: {
    id: string;
    observed: ListingObservation;
    changes: ListingChange[];
    title: string | null;
    checkedAt: Date;
    nextCheckAt: Date;
    error: string | null;
  },
) {
  const headline = changeHeadline(input.changes);
  await tx
    .update(listingWatches)
    .set({
      observed: input.observed,
      title: input.title,
      imageUrl: mainImageUrl(input.observed),
      lastCheckedAt: input.checkedAt,
      nextCheckAt: input.nextCheckAt,
      lastError: input.error,
      ...(headline ? { lastChangeSummary: headline, lastChangeAt: input.checkedAt } : {}),
      updatedAt: input.checkedAt,
    })
    .where(eq(listingWatches.id, input.id));
  if (!input.changes.length) return;
  const [watch] = await tx
    .select({
      notify: listingWatches.notify,
      notifyEmails: listingWatches.notifyEmails,
      organizationId: listingWatches.organizationId,
    })
    .from(listingWatches)
    .where(eq(listingWatches.id, input.id));
  if (!watch) return;
  await tx.insert(listingChanges).values(
    input.changes.map((change) => ({
      organizationId: watch.organizationId,
      watchId: input.id,
      field: change.field,
      summary: change.summary,
      before: change.before,
      after: change.after,
      checkedAt: input.checkedAt,
      // Nobody to tell: no email will ever go out for it.
      notifiedAt: watch.notify || watch.notifyEmails.length ? null : input.checkedAt,
    })),
  );
}

/** A failed look. The next try is `nextCheckAt` (sooner than the normal cadence). */
export async function saveListingCheckError(
  tx: Transaction,
  input: { id: string; error: string; nextCheckAt: Date },
) {
  await tx
    .update(listingWatches)
    .set({ lastError: input.error, nextCheckAt: input.nextCheckAt, updatedAt: new Date() })
    .where(eq(listingWatches.id, input.id));
}

export type ListingChangeMail = {
  watchId: string;
  title: string | null;
  asin: string;
  channelName: string;
  imageUrl: string | null;
  /** The first changes in one line, for a subject or a preview. */
  summary: string;
  /** Each change on its own, newest first. */
  changes: { field: string; summary: string; before: string | null; after: string | null }[];
  changeIds: string[];
  /** Owners and admins are emailed about it. */
  notify: boolean;
  /** And these addresses too. */
  notifyEmails: string[];
};

/** Unsent changes, grouped so one product is one block in the email. */
export async function unnotifiedListingChanges(tx: Transaction): Promise<ListingChangeMail[]> {
  const rows = await tx
    .select({
      id: listingChanges.id,
      watchId: listingChanges.watchId,
      field: listingChanges.field,
      summary: listingChanges.summary,
      before: listingChanges.before,
      after: listingChanges.after,
      title: listingWatches.title,
      asin: listingWatches.asin,
      imageUrl: listingWatches.imageUrl,
      channelName: salesChannels.name,
      notify: listingWatches.notify,
      notifyEmails: listingWatches.notifyEmails,
    })
    .from(listingChanges)
    .innerJoin(listingWatches, eq(listingWatches.id, listingChanges.watchId))
    .innerJoin(salesChannels, eq(salesChannels.id, listingWatches.channelId))
    .where(
      and(
        sql`${listingChanges.notifiedAt} is null`,
        sql`(${listingWatches.notify} or cardinality(${listingWatches.notifyEmails}) > 0)`,
      ),
    )
    .orderBy(desc(listingChanges.checkedAt));
  const grouped = new Map<string, ListingChangeMail>();
  for (const row of rows) {
    const change = {
      field: row.field,
      summary: row.summary,
      before: row.before,
      after: row.after,
    };
    const current = grouped.get(row.watchId);
    if (!current) {
      grouped.set(row.watchId, {
        watchId: row.watchId,
        title: row.title,
        asin: row.asin,
        channelName: row.channelName,
        imageUrl: row.imageUrl,
        summary: row.summary,
        changes: [change],
        changeIds: [row.id],
        notify: row.notify,
        notifyEmails: row.notifyEmails,
      });
      continue;
    }
    current.changes.push(change);
    current.changeIds.push(row.id);
    if (current.changeIds.length === 2) current.summary = `${current.summary} ${row.summary}`;
    else if (current.changeIds.length === 3) current.summary = `${current.summary} And more.`;
  }
  return [...grouped.values()];
}

export async function markListingChangesNotified(tx: Transaction, ids: string[]) {
  if (!ids.length) return;
  await tx
    .update(listingChanges)
    .set({ notifiedAt: new Date() })
    .where(inArray(listingChanges.id, ids));
}

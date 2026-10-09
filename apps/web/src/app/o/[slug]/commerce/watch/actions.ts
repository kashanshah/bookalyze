"use server";

import { listingWatchIssue } from "@bookalyze/core";
import {
  createListingWatch,
  deleteListingWatch,
  getListingWatch,
  ListingWatchError,
  schema,
  setListingWatchPaused,
  updateListingWatch,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listingWatchSchema } from "@/lib/validation/listing-watch";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { checkListingWatch, emailListingChanges } from "@/server/listing-watch";
import { logError } from "@/server/log";

type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true } & T)
  | { ok: false; message: string; errors?: Record<string, string> };

const base = (slug: string) => `/o/${slug}/commerce/watch`;

function issues(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const [first, index] = issue.path;
    // Each extra email has its own error: "notifyEmails.0", "notifyEmails.1".
    const key =
      first === "notifyEmails" && typeof index === "number"
        ? `notifyEmails.${index}`
        : String(first ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

async function context(slug: string) {
  const ctx = await getCommerceContext(slug);
  return ctx;
}

export async function saveListingWatchAction(
  slug: string,
  input: unknown,
  id?: string,
): Promise<Result<{ id: string; checkError: string | null }>> {
  const ctx = await context(slug);
  if (id !== undefined && !z.uuid().safeParse(id).success) {
    return { ok: false, message: "This product is no longer being watched." };
  }
  const parsed = listingWatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", errors: issues(parsed.error) };
  }
  const issue = listingWatchIssue(parsed.data);
  if (issue) return { ok: false, message: issue, errors: { cadence: issue } };
  try {
    const watchId = await inOrg(ctx, async (tx) => {
      const [channel] = await tx
        .select({ id: schema.salesChannels.id, isActive: schema.salesChannels.isActive })
        .from(schema.salesChannels)
        .where(eq(schema.salesChannels.id, parsed.data.channelId));
      if (!channel?.isActive) {
        throw new ListingWatchError("Choose a marketplace that's switched on.", "not_found");
      }
      const saved = id
        ? await updateListingWatch(tx, { ...parsed.data, id })
        : await createListingWatch(tx, {
            ...parsed.data,
            orgId: ctx.org.id,
            userId: ctx.session.user.id,
          });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: id ? "listing_watch.update" : "listing_watch.create",
        entityType: "listing_watch",
        entityId: saved,
        after: {
          asin: parsed.data.asin,
          cadence: parsed.data.cadence,
          checks: parsed.data.checks,
          notify: parsed.data.notify,
          notifyEmails: parsed.data.notifyEmails.length,
        },
      });
      return saved;
    });
    const checked = await checkListingWatch(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      watchId,
      true,
    );
    if (
      checked.ok &&
      checked.changes.length &&
      (parsed.data.notify || parsed.data.notifyEmails.length)
    ) {
      // Saved either way; an email that fails goes out with the next hourly run.
      await emailListingChanges({ id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug }).catch(
        (error) => logError("listing_watch.email_failed", error, { orgId: ctx.org.id }),
      );
    }
    revalidatePath(base(slug));
    revalidatePath(`${base(slug)}/${watchId}`);
    return {
      ok: true,
      id: watchId,
      checkError: checked.ok ? null : checked.message,
    };
  } catch (error) {
    if (error instanceof ListingWatchError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function checkListingWatchAction(
  slug: string,
  id: string,
): Promise<Result<{ changed: number }>> {
  const ctx = await context(slug);
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, message: "This product is no longer being watched." };
  }
  const result = await checkListingWatch(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    id,
    true,
  );
  if (!result.ok) return { ok: false, message: result.message };
  const watch = await inOrg(ctx, (tx) => getListingWatch(tx, id));
  if (result.changes.length && (watch?.notify || watch?.notifyEmails.length)) {
    await emailListingChanges({ id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug });
  }
  revalidatePath(`${base(slug)}/${id}`);
  revalidatePath(base(slug));
  return { ok: true, changed: result.changes.length };
}

export async function pauseListingWatchAction(
  slug: string,
  id: string,
  paused: boolean,
): Promise<Result> {
  const ctx = await context(slug);
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, message: "This product is no longer being watched." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      await setListingWatchPaused(tx, id, paused);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: paused ? "listing_watch.pause" : "listing_watch.resume",
        entityType: "listing_watch",
        entityId: id,
      });
    });
  } catch (error) {
    if (error instanceof ListingWatchError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(base(slug));
  revalidatePath(`${base(slug)}/${id}`);
  return { ok: true };
}

export async function deleteListingWatchAction(slug: string, id: string): Promise<Result> {
  const ctx = await context(slug);
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, message: "This product is no longer being watched." };
  }
  try {
    await inOrg(ctx, async (tx) => {
      const watch = await getListingWatch(tx, id);
      await deleteListingWatch(tx, id);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "listing_watch.delete",
        entityType: "listing_watch",
        entityId: id,
        before: watch ? { asin: watch.asin, channel: watch.channelName } : undefined,
      });
    });
  } catch (error) {
    if (error instanceof ListingWatchError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(base(slug));
  return { ok: true };
}
